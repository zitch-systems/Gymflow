// The brains of the Supabase Send Email hook, kept out of the route handler so
// it is unit-testable and the handler stays a thin HTTP shell.
//
// Responsibilities:
//   1. Turn a Supabase hook payload into a safe, absolute action link that
//      always lands on our own /auth/confirm route (which owns token exchange).
//   2. Work out whose brand the mail should wear — the gym, for a member; or
//      GymFlow, for an owner/staff account — and resolve that gym's branding.
//   3. Pick the right template for the email_action_type.
//
// Link construction is the security-sensitive part. Supabase hands us
// `redirect_to`, which is ultimately caller-influenced; we never send the user
// there directly. We send them to `${base}/auth/confirm?...&next=<path>` where
// `next` is reduced to a same-origin PATH, so a poisoned redirect_to can at
// worst bounce the user to a different page on our own site, never off it.
//
// Deliberately NOT 'server-only': the pure link/template logic is exercised
// directly by the vitest suite. resolveAuthBrand does touch the database, but
// it receives the service-role client as an argument rather than creating one,
// so this module never imports a server-only client at runtime — the admin
// import below is type-only and fully erased.

import type { createAdminClient } from '@/lib/supabase/admin';
import { gymBrand, platformBrand, siteUrl, type EmailBrand } from './brand';
import { GYM_EMAIL_COLUMNS, type EmailGym } from './columns';
import {
  changeEmail, confirmSignup, genericAuthAction, inviteUser, magicLink,
  reauthentication, resetPassword, type AuthArgs,
} from './templates/auth';
import type { EmailContent } from './layout';

// The action types Supabase can emit through the hook.
export type AuthActionType =
  | 'signup'
  | 'recovery'
  | 'invite'
  | 'magiclink'
  | 'email_change'
  | 'email_change_current'
  | 'email_change_new'
  | 'reauthentication';

export type AuthHookPayload = {
  user: {
    id?: string;
    email?: string;
    new_email?: string | null;
    user_metadata?: Record<string, unknown> | null;
  };
  email_data: {
    token?: string;
    token_hash?: string;
    token_new?: string;
    token_hash_new?: string;
    redirect_to?: string;
    email_action_type?: string;
    site_url?: string;
  };
};

/** Absolute base for links. The payload's site_url is the Supabase project's
 *  configured Site URL and is the most reliable value; our own env is the
 *  fallback. A relative base is refused by the caller (the hook returns 500)
 *  rather than mailing a link that resolves nowhere. */
export function linkBase(payload: AuthHookPayload): string | null {
  const candidate = (payload.email_data.site_url || siteUrl()).trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+/i.test(candidate) ? candidate : null;
}

/** Reduce Supabase's redirect_to to a safe same-origin path to carry in `next`.
 *  Anything absolute/foreign collapses to a sensible default per action type,
 *  so the link can never be turned into an open redirect. */
export function nextPath(redirectTo: string | undefined, actionType: AuthActionType): string {
  const fallback = actionType === 'recovery' ? '/reset-password' : '/login?confirmed=1';
  if (!redirectTo) return fallback;
  try {
    // Resolve against an arbitrary base so a relative value parses; we then
    // keep only path + query, discarding any origin the caller tried to set.
    const u = new URL(redirectTo, 'https://placeholder.invalid');
    const path = `${u.pathname}${u.search}`;
    if (!path.startsWith('/') || path.startsWith('//')) return fallback;
    return path;
  } catch {
    return fallback;
  }
}

/** Build the confirmation link the email links to. */
export function buildActionUrl(base: string, tokenHash: string, type: AuthActionType, next: string): string {
  const p = new URLSearchParams({ token_hash: tokenHash, type, next });
  return `${base}/auth/confirm?${p.toString()}`;
}

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Whose brand does this auth mail wear?
 *
 * A member confirming their address should see their gym; a gym owner or staff
 * member should see GymFlow. We infer membership from the user's own records
 * (the service-role read a member's row is invisible to under RLS), falling
 * back to the signup metadata a fresh member carries before any row exists.
 */
export async function resolveAuthBrand(
  admin: Admin | null,
  user: AuthHookPayload['user'],
): Promise<{ brand: EmailBrand; senderName: string; isGymMember: boolean; gym: EmailGym | null }> {
  const platform = { brand: platformBrand(), senderName: 'GymFlow', isGymMember: false, gym: null };
  // Without a service-role client (preview envs) a member's rows are invisible,
  // so branding can't be resolved — platform branding is the safe default.
  if (!admin || !user.id) return platform;

  try {
    // Staff/owner? Then this is GymFlow's own account mail — platform brand,
    // even though they belong to a gym.
    const { data: staff } = await admin
      .from('gym_staff_links')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1);
    if (staff && staff.length > 0) return platform;

    // A member of a gym → that gym's brand. Prefer the active membership link.
    const { data: link } = await admin
      .from('gym_member_links')
      .select('gym_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    const gymId = (link as { gym_id: string | null } | null)?.gym_id
      ?? (await gymIdFromMetadata(admin, user.user_metadata));
    if (gymId) {
      const { data: gym } = await admin.from('gyms').select(GYM_EMAIL_COLUMNS).eq('id', gymId).maybeSingle();
      if (gym) {
        const g = gym as unknown as EmailGym;
        return { brand: gymBrand(g), senderName: g.name ?? 'your gym', isGymMember: true, gym: g };
      }
    }
  } catch {
    // Any lookup failure degrades to platform branding — a correctly delivered
    // but un-gym-branded email beats a failed send.
  }
  return platform;
}

async function gymIdFromMetadata(admin: Admin, meta: Record<string, unknown> | null | undefined): Promise<string | null> {
  const slug = metaString(meta, 'join_gym_slug');
  if (!slug) return null;
  const { data } = await admin.from('gyms').select('id').eq('slug', slug).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

function metaString(meta: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = meta?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function fullNameFromMeta(meta: Record<string, unknown> | null | undefined): string | null {
  return metaString(meta, 'full_name') ?? metaString(meta, 'name') ?? null;
}

/**
 * Choose and render the template for an action type. Returns null only when the
 * action needs a token the payload didn't include (a malformed hook call),
 * which the caller turns into a 400.
 */
export function renderAuthEmail(
  actionType: AuthActionType,
  payload: AuthHookPayload,
  ctx: { base: string; senderName: string; isGymMember: boolean },
): EmailContent | null {
  const { user, email_data: d } = payload;
  const email = (user.email ?? '').trim();
  const fullName = fullNameFromMeta(user.user_metadata);

  // Reauthentication is a code, not a link — handle before anything needs a URL.
  if (actionType === 'reauthentication') {
    if (!d.token) return null;
    return reauthentication({ email, fullName, token: d.token, senderName: ctx.senderName, isGymMember: ctx.isGymMember });
  }

  // Email-change confirmations to the NEW address use the *_new token; the hook
  // fires once per address with the matching action type.
  const toNewAddress = actionType === 'email_change_new';
  const tokenHash = toNewAddress ? (d.token_hash_new || d.token_hash) : d.token_hash;
  if (!tokenHash) return null;

  const next = nextPath(d.redirect_to, actionType);
  const actionUrl = buildActionUrl(ctx.base, tokenHash, actionType, next);
  const base: AuthArgs = { email, fullName, actionUrl, senderName: ctx.senderName, isGymMember: ctx.isGymMember };

  switch (actionType) {
    case 'signup':
      return confirmSignup(base);
    case 'recovery':
      return resetPassword(base);
    case 'invite':
      return inviteUser(base);
    case 'magiclink':
      return magicLink(base);
    case 'email_change':
    case 'email_change_current':
    case 'email_change_new':
      return changeEmail({ ...base, newEmail: (user.new_email ?? '').trim() || email, toNewAddress });
    default:
      return genericAuthAction(base);
  }
}

/** Normalise the payload's action type to our union, or null if unrecognised. */
export function parseActionType(raw: string | undefined): AuthActionType | null {
  const known: AuthActionType[] = [
    'signup', 'recovery', 'invite', 'magiclink',
    'email_change', 'email_change_current', 'email_change_new', 'reauthentication',
  ];
  return known.includes(raw as AuthActionType) ? (raw as AuthActionType) : null;
}
