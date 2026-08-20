// Shared helpers for the native mobile app's public API (/api/app/*). These
// endpoints are called by the app over plain HTTP (no browser cookie jar), so
// they take credentials in the body and return JSON with permissive CORS.

import { createClient as createSupabaseClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { gymCanUse, memberLockedMessage } from '@/lib/entitlements';
import type { Database } from '@/lib/database.types';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
  });
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

// Shape returned to the app after auth: enough to render the gym and keep the
// Supabase session alive on the device.
export function sessionPayload(session: { access_token: string; refresh_token: string; expires_at?: number; expires_in?: number } | null) {
  if (!session) return null;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at ?? null,
    expires_in: session.expires_in ?? null,
    token_type: 'bearer',
  };
}

// ── Authenticated requests ─────────────────────────────────────────────────
// The app holds a Supabase session (minted by /api/app/signin) in the device
// keystore and sends the access token as `Authorization: Bearer <jwt>`. The
// browser surfaces get the same identity from a cookie; everything below is the
// header-shaped equivalent of lib/supabase/server.ts + lib/auth/dal.ts.

export type AppSupabase = SupabaseClient<Database>;
export type Gym = Database['public']['Tables']['gyms']['Row'];
export type MemberLink = Database['public']['Tables']['gym_member_links']['Row'];

export function bearerToken(req: Request): string | null {
  const raw = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? match[1].trim() : null;
}

/**
 * A Supabase client that carries the member's own JWT on every request, so
 * PostgREST evaluates RLS as that member — the same authority the web surfaces
 * rely on. The anon key is the apikey; the bearer token is the identity.
 */
export function createTokenClient(token: string): AppSupabase {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Supabase is not configured.');
  return createSupabaseClient<Database>(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export type MemberContext = { supabase: AppSupabase; user: User; gym: Gym; link: MemberLink };

/**
 * The refusal for a member surface the gym's plan doesn't include.
 *
 * Its own code on purpose: the 401s below mean "refresh the token or sign in
 * again" and the other 403s mean "wrong account", but this one is neither —
 * the member and their token are fine, the gym's plan is what's missing, and
 * nothing the member does on the phone changes it. The app has no wall to
 * render (that's app/(member)/layout.tsx's FeatureLockWall, web only); it turns
 * any non-2xx into an ApiError carrying `error` and shows that sentence
 * (mobile/src/api/client.ts), so the copy has to read like something a member
 * can act on — hence memberLockedMessage, not upgradeMessage.
 */
export function planLocked(gymName: string, surface: string): Response {
  return json({ error: memberLockedMessage(gymName, surface), code: 'plan_locked' }, 403);
}

/**
 * Resolve the member behind a request, or the response to return instead.
 *
 * Mirrors requireMember() in lib/auth/dal.ts — newest active membership link
 * with its gym — but a route handler has nowhere to redirect a native client
 * to, so the failures are status codes the app can act on: 401 means "refresh
 * the token or sign in again", 403 means "this account isn't a member here".
 */
export async function requireApiMember(
  req: Request,
): Promise<{ ok: true; ctx: MemberContext } | { ok: false; res: Response }> {
  const token = bearerToken(req);
  if (!token) return { ok: false, res: json({ error: 'Sign in to continue.', code: 'no_token' }, 401) };

  let supabase: AppSupabase;
  try {
    supabase = createTokenClient(token);
  } catch (e) {
    return { ok: false, res: json({ error: (e as Error).message }, 500) };
  }

  // getUser(token) verifies the JWT with the auth server rather than trusting
  // its claims — an expired or revoked token fails here, not three queries later.
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user) {
    return { ok: false, res: json({ error: 'Your session has expired. Please sign in again.', code: 'expired' }, 401) };
  }

  const { data: link } = await supabase
    .from('gym_member_links')
    .select('*, gyms(*)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('joined_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!link) {
    return { ok: false, res: json({ error: 'This account isn’t a member at any gym yet.', code: 'not_a_member' }, 403) };
  }

  const { gyms: embeddedGym, ...linkRow } = link as MemberLink & { gyms: Gym | null };
  let gym: Gym | null = embeddedGym ?? null;
  if (!gym && linkRow.gym_id) {
    const { data } = await supabase.from('gyms').select('*').eq('id', linkRow.gym_id).maybeSingle();
    gym = (data as Gym) ?? null;
  }
  if (!gym) return { ok: false, res: json({ error: 'Your gym could not be loaded.', code: 'no_gym' }, 403) };

  // Starter is the gym's own admin portal only — the member app is a Growth
  // surface (lib/entitlements.ts). app/(member)/layout.tsx walls the web PWA,
  // but a layout is chrome and chrome never runs for a route handler: without
  // this, every /api/app/* endpoint served the full member experience to a gym
  // whose own browser PWA shows the lock wall. Same member, same account,
  // opposite answers depending on the door. This is the one gate they share.
  //
  // gymCanUse, not gymHasFeature: gyms that existed before the repositioning
  // carry legacy_full_access and keep the app whatever tier they're on, so only
  // a gym that signed up as Starter after it is refused here. The link query
  // above embeds gyms(*) — and the fallback selects '*' — so that column is on
  // the row even though lib/database.types.ts hasn't been regenerated for it.
  if (!gymCanUse(gym, 'member_app')) return { ok: false, res: planLocked(gym.name, 'the member app') };

  return { ok: true, ctx: { supabase, user, gym, link: linkRow as MemberLink } };
}

// Body parsing that never throws — an empty or malformed body reads as {}.
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// The public shape of a gym as the app renders it (name, branding). Never
// includes payout, contact or billing columns — the app has no use for them and
// they'd end up cached on the device.
export function publicGym(gym: Gym) {
  return {
    id: gym.id,
    name: gym.name,
    slug: gym.slug,
    brand_color: (gym as { brand_color?: string | null }).brand_color ?? null,
    logo_url: (gym as { logo_url?: string | null }).logo_url ?? null,
    member_code: (gym as { member_code?: string | null }).member_code ?? null,
  };
}
