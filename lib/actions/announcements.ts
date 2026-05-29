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

/**
 * Broadcast an announcement to all active members of a gym. Manager-only.
 *
 * Persists one in-app `notifications` row per member (so the dashboard can
 * surface unread announcements later) and fans out the chosen channel(s) via
 * email / WhatsApp — honouring each member's NDPR opt-out flags. The actual
 * sends run in after() so the admin's request returns immediately rather than
 * blocking on N provider calls.
 */
export async function sendGymAnnouncement(slug: string, formData: FormData): Promise<Result> {
  const { gym } = await requireManager(slug);
  const actor = await getSessionUser();

  const subject = String(formData.get('subject') ?? '').trim();
  const message = String(formData.get('message') ?? '').trim();
  const channelRaw = String(formData.get('channel') ?? 'email').trim();
  const channel: Channel = channelRaw === 'whatsapp' || channelRaw === 'both' ? channelRaw : 'email';

  if (!subject) return { ok: false, error: 'Subject required' };
  if (!message) return { ok: false, error: 'Message required' };
  if (subject.length > 120) return { ok: false, error: 'Subject must be 120 characters or fewer' };
  if (message.length > 2000) return { ok: false, error: 'Message must be 2000 characters or fewer' };

  const admin = createAdminClient();

  // All active members of this gym, with the profile fields the fan-out needs.
  const { data: links } = await admin
    .from('gym_member_links')
    .select('user_id, profiles:user_id(email, phone, full_name, first_name, notification_email, notification_whatsapp)' as never)
    .eq('gym_id', gym.id)
    .eq('is_active', true)
    .eq('status', 'active');

  const rows = (links ?? []) as unknown as MemberRow[];
  const members = rows.filter((r) => r.user_id && r.profiles);
  if (members.length === 0) return { ok: false, error: 'No active members to notify' };

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
    after: { subject, channel, recipients: members.length },
  });

  // Fan out the actual sends after the response. Announcements are
  // promotional, so honour the per-member opt-out flags.
  after(async () => {
    for (const m of members) {
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
        console.warn('[GF announcement] send failed for a member:', (e as Error).message);
      }
    }
  });

  revalidatePath(`/gym/${slug}/admin/announcements`);
  return { ok: true, recipients: members.length };
}
