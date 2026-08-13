import 'server-only';
import { randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canonicalWaId } from '@/lib/whatsapp/phone';
import type { Database } from '@/lib/database.types';

type Admin = SupabaseClient<Database>;

// Server-side state for one run of a Flow.
//
// Meta gives every Flow message a `flow_token` and hands it back on each screen
// exchange. We mint it ourselves, which turns it into a capability: it is the
// ONLY thing tying an encrypted Flow submission to a WhatsApp number. The
// endpoint never trusts a phone number, email, or gym id that arrives in the
// Flow payload for identity — it looks them up from this row instead.
//
// So the token must be unguessable (32 random bytes) and short-lived: a Flow
// left open overnight should not still be a way in.

const TTL_MS = 60 * 60 * 1000;

export type FlowSession = {
  flow_token: string;
  wa_id: string;
  gym_id: string | null;
  kind: string;
  data: Record<string, unknown>;
  expires_at: string;
  consumed_at: string | null;
};

export function newFlowToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createFlowSession(
  admin: Admin,
  params: { waId: string; kind: string; gymId?: string | null; data?: Record<string, unknown> },
): Promise<string | null> {
  const waId = canonicalWaId(params.waId);
  if (!waId) return null;
  const token = newFlowToken();
  const { error } = await admin.from('whatsapp_flow_sessions').insert({
    flow_token: token,
    wa_id: waId,
    gym_id: params.gymId ?? null,
    kind: params.kind,
    data: (params.data ?? {}) as never,
    expires_at: new Date(Date.now() + TTL_MS).toISOString(),
  });
  return error ? null : token;
}

/** Load a live session. Expired and already-consumed tokens resolve to null. */
export async function loadFlowSession(admin: Admin, token: string): Promise<FlowSession | null> {
  if (!token) return null;
  const { data } = await admin
    .from('whatsapp_flow_sessions')
    .select('flow_token, wa_id, gym_id, kind, data, expires_at, consumed_at')
    .eq('flow_token', token)
    .maybeSingle();
  const session = data as FlowSession | null;
  if (!session) return null;
  if (session.consumed_at) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;
  return session;
}

/** Carry non-secret scratch (resolved gym, pending email) between screens. */
export async function patchFlowSession(
  admin: Admin,
  session: FlowSession,
  patch: { gymId?: string | null; data?: Record<string, unknown> },
): Promise<FlowSession> {
  const nextData = { ...(session.data ?? {}), ...(patch.data ?? {}) };
  const update: Record<string, unknown> = { data: nextData };
  if (patch.gymId !== undefined) update.gym_id = patch.gymId;
  await admin.from('whatsapp_flow_sessions').update(update as never).eq('flow_token', session.flow_token);
  return { ...session, data: nextData, gym_id: patch.gymId !== undefined ? patch.gymId : session.gym_id };
}

/** Burn the token once the Flow reaches its terminal screen. */
export async function consumeFlowSession(admin: Admin, token: string): Promise<void> {
  await admin
    .from('whatsapp_flow_sessions')
    .update({ consumed_at: new Date().toISOString() })
    .eq('flow_token', token);
}
