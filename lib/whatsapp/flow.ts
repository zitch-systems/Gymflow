import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'crypto';
import { daysLeft, normalizeNgPhone, watDateISO, watDayStartUtc } from '@/lib/format';
import { isOfflineGym } from '@/lib/gym-status';
import type { Database } from '@/lib/database.types';

type Admin = SupabaseClient<Database>;
type Json = Record<string, unknown>;

export type IncomingWhatsAppMessage = {
  from: string;
  text: string;
  phoneNumberId: string;
  messageId: string | null;
};

type Gym = {
  id: string;
  name: string;
  slug: string;
  member_code: string;
  status: string | null;
};

type Profile = {
  id: string;
  full_name: string | null;
  first_name: string | null;
  phone: string | null;
};

const STATUS_WORDS = new Set(['1', 'status', 'membership', 'member', 'plan']);
const CHECKIN_WORDS = new Set(['2', 'checkin', 'check-in', 'check in', 'enter']);
const RENEW_WORDS = new Set(['3', 'renew', 'pay', 'payment', 'subscribe']);
const HELP_WORDS = new Set(['hi', 'hello', 'help', 'menu', 'start']);

export function verifyMetaSignature(raw: string, header: string | null, appSecret: string | undefined): boolean {
  if (!appSecret) return true;
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(raw).digest('hex');
  const actual = header.slice('sha256='.length);
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function extractMessages(payload: Json): IncomingWhatsAppMessage[] {
  const messages: IncomingWhatsAppMessage[] = [];
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray((entry as Json).changes) ? (entry as Json).changes as Json[] : [];
    for (const change of changes) {
      const value = ((change.value as Json | undefined) ?? {});
      const phoneNumberId = str((value.metadata as Json | undefined)?.phone_number_id);
      const inbound = Array.isArray(value.messages) ? value.messages as Json[] : [];
      if (!phoneNumberId) continue;
      for (const msg of inbound) {
        const from = str(msg.from);
        const type = str(msg.type);
        const text = type === 'text' ? str((msg.text as Json | undefined)?.body) : null;
        if (!from || !text) continue;
        messages.push({ from, text, phoneNumberId, messageId: str(msg.id) });
      }
    }
  }
  return messages;
}

export async function replyForWhatsAppMessage(admin: Admin, msg: IncomingWhatsAppMessage): Promise<string> {
  const text = msg.text.trim();
  const command = text.toLowerCase();
  const localPhone = normalizeWaId(msg.from);
  if (!localPhone) return 'Please send a message from a Nigerian WhatsApp number registered with your gym.';

  const member = await findMemberByPhone(admin, localPhone);
  if (!member) return unknownMemberReply(admin, text);
  if (member.gyms.length === 0) return 'Your number is on GymFlow, but it is not linked to an active gym membership yet. Please contact your gym front desk.';
  if (member.gyms.length > 1 && !looksLikeGymCode(text)) {
    return `Your number is linked to more than one gym. Reply with the gym code for the gym you want to use:\n\n${member.gyms.map((g) => `${g.name}: ${g.member_code}`).join('\n')}`;
  }

  const selectedGym = selectGym(member.gyms, text) ?? member.gyms[0];
  if (isOfflineGym(selectedGym)) return `${selectedGym.name} is not active on GymFlow right now. Please contact the front desk.`;

  if (STATUS_WORDS.has(command)) return membershipStatusReply(admin, member.profile, selectedGym);
  if (CHECKIN_WORDS.has(command)) return checkInReply(admin, member.profile, selectedGym);
  if (RENEW_WORDS.has(command)) return renewReply(selectedGym);
  if (HELP_WORDS.has(command) || looksLikeGymCode(text)) return menuReply(member.profile, selectedGym);

  return menuReply(member.profile, selectedGym);
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

function normalizeWaId(waId: string): string | null {
  return normalizeNgPhone(waId.startsWith('234') ? `+${waId}` : waId);
}

function phoneVariants(local: string): string[] {
  const intl = `234${local.slice(1)}`;
  return [local, `+${intl}`, intl, local.replace(/^0/, '')];
}

function looksLikeGymCode(text: string): boolean {
  return /^[a-z0-9_-]{3,24}$/i.test(text.trim());
}

async function findMemberByPhone(admin: Admin, localPhone: string): Promise<{ profile: Profile; gyms: Gym[] } | null> {
  const variants = phoneVariants(localPhone);
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name, first_name, phone')
    .in('phone', variants)
    .limit(5);

  const profile = (profiles as Profile[] | null)?.[0];
  if (!profile) return null;

  const { data: links } = await admin
    .from('gym_member_links')
    .select('gym_id')
    .or(`member_id.eq.${profile.id},user_id.eq.${profile.id}`)
    .eq('is_active', true);

  const gymIds = Array.from(new Set(((links as { gym_id: string | null }[] | null) ?? []).map((l) => l.gym_id).filter((id): id is string => Boolean(id))));
  if (gymIds.length === 0) return { profile, gyms: [] };

  const { data: gyms } = await admin
    .from('gyms')
    .select('id, name, slug, member_code, status')
    .in('id', gymIds);

  return { profile, gyms: (gyms as Gym[] | null) ?? [] };
}

function selectGym(gyms: Gym[], text: string): Gym | null {
  const code = text.trim().toLowerCase();
  return gyms.find((g) => g.member_code.toLowerCase() === code || g.slug.toLowerCase() === code) ?? null;
}

function firstName(profile: Profile): string {
  return (profile.first_name ?? profile.full_name ?? 'there').trim().split(/\s+/)[0] || 'there';
}

function appUrl(gym: Gym, path = ''): string {
  const root = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gymflow.ng').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return `https://${gym.slug}.${root}${path}`;
}

function menuReply(profile: Profile, gym: Gym): string {
  return `Hi ${firstName(profile)}, welcome to ${gym.name} on GymFlow.\n\nReply:\n1 - Membership status\n2 - Check in\n3 - Renew membership`;
}

async function membershipStatusReply(admin: Admin, profile: Profile, gym: Gym): Promise<string> {
  const today = watDateISO();
  const { data: sub } = await admin
    .from('member_subscriptions')
    .select('status, end_date')
    .eq('member_id', profile.id)
    .eq('gym_id', gym.id)
    .in('status', ['active', 'past_due', 'paused'])
    .order('end_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sub || (sub.end_date ?? '') < today) {
    return `Your ${gym.name} membership is not active. Renew here: ${appUrl(gym, '/dashboard/renew')}`;
  }

  return `Your ${gym.name} membership is ${sub.status ?? 'active'} and valid until ${sub.end_date}. ${daysLeft(sub.end_date)} day(s) left.`;
}

async function checkInReply(admin: Admin, profile: Profile, gym: Gym): Promise<string> {
  const today = watDateISO();
  const { data: link } = await admin
    .from('gym_member_links')
    .select('is_active')
    .eq('gym_id', gym.id)
    .or(`member_id.eq.${profile.id},user_id.eq.${profile.id}`)
    .maybeSingle();
  if (link && link.is_active === false) return 'Your membership is suspended. Please see the front desk.';

  const { data: sub } = await admin
    .from('member_subscriptions')
    .select('end_date')
    .eq('member_id', profile.id)
    .eq('gym_id', gym.id)
    .in('status', ['active', 'past_due'])
    .order('end_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub || (sub.end_date ?? '') < today) return `Your membership is not active. Renew here: ${appUrl(gym, '/dashboard/renew')}`;

  const { data: open } = await admin
    .from('check_ins')
    .select('id')
    .eq('member_id', profile.id)
    .eq('gym_id', gym.id)
    .eq('status', 'active')
    .is('checked_out_at', null)
    .gte('checked_in_at', watDayStartUtc(today))
    .order('checked_in_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (open) return `You are already checked in at ${gym.name}.`;

  const { error } = await admin.from('check_ins').insert({
    member_id: profile.id,
    gym_id: gym.id,
    check_in_method: 'whatsapp',
    checked_in_at: new Date().toISOString(),
    status: 'active',
  });
  if (error) return 'Check-in could not be completed. Please see the front desk.';

  return `Checked in successfully at ${gym.name}. Enjoy your workout.`;
}

function renewReply(gym: Gym): string {
  return `Renew your ${gym.name} membership here: ${appUrl(gym, '/dashboard/renew')}`;
}

async function unknownMemberReply(admin: Admin, text: string): Promise<string> {
  if (looksLikeGymCode(text)) {
    const { data: gym } = await admin
      .from('gyms')
      .select('name, slug')
      .eq('member_code', text.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))
      .maybeSingle();
    if (gym) {
      const g = gym as { name: string; slug: string };
      const root = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gymflow.ng').replace(/^https?:\/\//, '').replace(/\/+$/, '');
      return `I could not find your membership by this WhatsApp number. Join ${g.name} here: https://${g.slug}.${root}/join/${encodeURIComponent(g.slug)}, or contact the front desk to link your phone number.`;
    }
  }
  return 'Welcome to GymFlow. I could not find your membership by this WhatsApp number. Reply with your gym code, or contact your gym front desk to link your phone number.';
}
