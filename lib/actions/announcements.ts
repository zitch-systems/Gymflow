'use server';

import { after } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireManager } from '@/lib/auth/gym';
import { getSessionUser } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { audit } from '@/lib/audit';
import { sendAnnouncement } from '@/lib/email';
import { waAnnouncement } from '@/lib/whatsapp';
import { respectsEmail, respectsWhatsapp } from '@/lib/notification-prefs';
import { runWithConcurrency } from '@/lib/concurrency';

// How many announcement sends to keep in flight at once. Tuned to clear a
// few-hundred-member broadcast inside the after() runtime cap without
// hammering the email/WhatsApp providers' rate limits.
const ANNOUNCEMENT_SEND_CONCURRENCY = 8;

// PostgREST returns at most ~1000 rows per request; page the member fan-out
// in chunks of this size so large gyms aren't silently truncated.
const MEMBER_PAGE_SIZE = 1000;

type Result = { ok: boolean; error?: string; recipients?: number };

type Channel = 'email' | 'whatsapp' | 'both';

type MemberRow = {
  user_id: string | null;
  profiles: {
    email: string | null;
    phone: string | null;
    full_name: string | null;
    first_name: string | null;
    notification_email: boolean | null;
    notification_whatsapp: boolean | null;
  } | null;
};

// Tag input: 1-30 chars, letters/digits/space/_/- — same regex as
// addMemberTag in lib/actions/member-admin.ts so a tampered form can't
// inject an unsafe filter value into the member_tags query.
const TAG_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,29}$/;

/**
 * Broadcast an announcement to active members of a gym. Manager-only.
 *
 * If `tag` is set in the form, the fan-out is narrowed to members who carry
 * that tag at this gym (joined via member_tags). Useful for segments like
 * "VIP", "Trial", "PT" — multiplies the value of the existing tag + broadcast
 * features without adding new infra.
 *
 * Persists one in-app `notifications` row per recipient and fans out the
 * chosen channel(s) via email / WhatsApp — honouring each member's NDPR
 * opt-out flags. The actual sends run in after() so the admin's request
 * returns immediately rather than blocking on N provider calls.
 */
export async function sendGymAnnouncement(slug: string, formData: FormData): Promise<Result> {
  const { gym } = await requireManager(slug);
  const actor = await getSessionUser();

  const subject = String(formData.get('subject') ?? '').trim();
  const message = String(formData.get('message') ?? '').trim();
  const channelRaw = String(formData.get('channel') ?? 'email').trim();
  const channel: Channel = channelRaw === 'whatsapp' || channelRaw === 'both' ? channelRaw : 'email';
  const tagRaw = String(formData.get('tag') ?? '').trim();
  // Empty tag = broadcast to everyone. A non-empty tag must pass the regex —
  // an arbitrary string here would let a manager inject filter values that
  // address members in ways the UI doesn't show.
  const tag = tagRaw === '' ? null : tagRaw;
  if (tag !== null && !TAG_RE.test(tag)) return { ok: false, error: 'Invalid tag filter' };

  if (!subject) return { ok: false, error: 'Subject required' };
  if (!message) return { ok: false, error: 'Message required' };
  if (subject.length > 120) return { ok: false, error: 'Subject must be 120 characters or fewer' };
  if (message.length > 2000) return { ok: false, error: 'Message must be 2000 characters or fewer' };

  const admin = createAdminClient();

  // Resolve the recipient set. When `tag` is set, fetch the user_ids that
  // carry the tag at this gym and intersect with the active members. Two
  // queries (rather than a single PostgREST inner join) because member_tags
  // isn't in the generated types yet and Supabase's inner-join shorthand
  // requires the FK relationship to be exposed in the schema cache.
  let taggedUserIds: Set<string> | null = null;
  if (tag) {
    const { data: tagRows } = await admin
      .from('member_tags' as never)
      .select('user_id')
      .eq('gym_id' as never, gym.id)
      .eq('tag' as never, tag);
    taggedUserIds = new Set(((tagRows ?? []) as unknown as Array<{ user_id: string }>).map((r) => r.user_id));
    if (taggedUserIds.size === 0) {
      return { ok: false, error: `No members tagged "${tag}" yet` };
    }
  }

  // All active members of this gym, with the profile fields the fan-out needs.
  // Paginated: PostgREST caps a single response at ~1000 rows by default, so
  // a gym with more than that would silently broadcast to only the first
  // page. Page through with .range() until a short page signals the end.
  const rows: MemberRow[] = [];
  for (let from = 0; ; from += MEMBER_PAGE_SIZE) {
    const { data: page } = await admin
      .from('gym_member_links')
      .select('user_id, profiles:user_id(email, phone, full_name, first_name, notification_email, notification_whatsapp)' as never)
      .eq('gym_id', gym.id)
      .eq('is_active', true)
      .eq('status', 'active')
      .range(from, from + MEMBER_PAGE_SIZE - 1);
    const pageRows = (page ?? []) as unknown as MemberRow[];
    rows.push(...pageRows);
    if (pageRows.length < MEMBER_PAGE_SIZE) break;
  }

  const members = rows
    .filter((r) => r.user_id && r.profiles)
    .filter((r) => !taggedUserIds || taggedUserIds.has(r.user_id!));
  if (members.length === 0) {
    return { ok: false, error: tag ? `No active members tagged "${tag}"` : 'No active members to notify' };
  }

  // Persist an in-app notification per member (best-effort; the send is the
  // primary channel). type='announcement' so a future member inbox can filter.
  const notifRows = members.map((m) => ({
    gym_id: gym.id,
    user_id: m.user_id,
    title: subject,
    body: message,
    type: 'announcement',
    channel,
    sent_at: new Date().toISOString(),
  }));
  await admin.from('notifications').insert(notifRows as never);

  await audit({
    gymId: gym.id,
    actorId: actor?.id ?? null,
    action: 'admin.announcement_sent',
    table: 'notifications',
    after: { subject, channel, recipients: members.length, tag },
  });

  // Fan out the actual sends after the response. Announcements are
  // promotional, so honour the per-member opt-out flags. Bounded concurrency
  // (not a serial loop): a gym with a few hundred members on channel='both'
  // is 2N provider calls — serially that overruns the after() runtime cap and
  // the tail of the list silently never gets sent. Capped fan-out keeps the
  // whole batch inside the window without opening N connections at once.
  after(async () => {
    await runWithConcurrency(members, ANNOUNCEMENT_SEND_CONCURRENCY, async (m) => {
      const p = m.profiles!;
      const name = p.first_name ?? p.full_name ?? 'there';
      try {
        if ((channel === 'email' || channel === 'both') && p.email && respectsEmail(p)) {
          await sendAnnouncement(p.email, { name, gymName: gym.name, subject, message });
        }
        if ((channel === 'whatsapp' || channel === 'both') && p.phone && respectsWhatsapp(p)) {
          await waAnnouncement(p.phone, { gymName: gym.name, subject, message });
        }
      } catch (e) {
        // Best-effort: one bad recipient must not abort the rest of the batch.
        console.warn('[GF announcement] send failed for a member:', (e as Error).message);
      }
    });
  });

  revalidatePath(`/gym/${slug}/admin/announcements`);
  return { ok: true, recipients: members.length };
}
