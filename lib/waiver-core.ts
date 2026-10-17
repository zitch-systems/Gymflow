import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

type Client = Pick<SupabaseClient<Database>, 'from'>;
type Gym = { id: string; name?: string | null };
export type WaiverDocument = {
  id: string | null;
  title: string;
  content: string;
  version: string | null;
  revision: string;
};
export type WaiverState = { document: WaiverDocument; accepted: boolean; signedAt: string | null };

export class WaiverRequiredError extends Error {
  readonly code = 'waiver_required';
  constructor() { super('Please review and accept your gym waiver before continuing.'); }
}
export class WaiverChangedError extends Error {
  readonly code = 'waiver_changed';
  constructor() { super('The waiver has changed. Please review the current document before accepting.'); }
}
export class WaiverUnavailableError extends Error {
  readonly code = 'retryable';
  constructor() { super('Your waiver could not be loaded or saved. Please try again.'); }
}

// Preserve the existing fallback text verbatim. No configured waiver is
// invented or backfilled from this legacy profile acknowledgement.
function fallbackContent(gymName: string): string {
  return `Assumption of risk\nYou acknowledge that physical exercise carries inherent risks, including injury, and choose to participate voluntarily and at your own risk.\n\nHealth declaration\nYou confirm you are in suitable health to exercise and will stop and seek help if you feel unwell. You will disclose relevant conditions to gym staff.\n\nRelease\nTo the extent permitted by law, you release ${gymName} and its staff from liability for injury arising from ordinary use of the facilities, except in cases of gross negligence.`;
}

async function currentDocument(supabase: Client, gym: Gym): Promise<WaiverDocument> {
  const { data, error } = await supabase.from('waivers')
    .select('id, title, content, version')
    .eq('gym_id', gym.id).eq('is_active', true)
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .limit(1).maybeSingle();
  if (error) throw new WaiverUnavailableError();
  const document = data
    ? { id: data.id, title: data.title, content: data.content, version: data.version }
    : { id: null, title: 'Liability waiver', content: fallbackContent(gym.name || 'your gym'), version: null };
  // Editing content or version under the same ID also requires fresh consent.
  const revision = createHash('sha256')
    .update(JSON.stringify({ gymId: gym.id, ...document })).digest('hex');
  return { ...document, revision };
}

export async function getWaiverState(supabase: Client, memberId: string, gym: Gym): Promise<WaiverState> {
  const document = await currentDocument(supabase, gym);
  if (!document.id) {
    const { data, error } = await supabase.from('profiles').select('waiver_signed_at')
      .eq('id', memberId).maybeSingle();
    if (error) throw new WaiverUnavailableError();
    return { document, accepted: Boolean(data?.waiver_signed_at), signedAt: data?.waiver_signed_at ?? null };
  }
  const { data, error } = await supabase.from('waiver_signatures').select('signed_at')
    .eq('member_id', memberId).eq('gym_id', gym.id).eq('waiver_id', document.id)
    .eq('signature', document.revision)
    .order('signed_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new WaiverUnavailableError();
  return { document, accepted: Boolean(data?.signed_at), signedAt: data?.signed_at ?? null };
}

export async function requireWaiverAcceptance(supabase: Client, memberId: string, gym: Gym): Promise<void> {
  // Only a configured gym document adds a booking/check-in requirement. The
  // legacy generic acknowledgement remains available without newly locking
  // existing native members out of gyms that have not configured a waiver.
  const document = await currentDocument(supabase, gym);
  if (!document.id) return;
  const state = await getWaiverState(supabase, memberId, gym);
  if (state.document.id && !state.accepted) throw new WaiverRequiredError();
}

export async function acceptWaiver(
  supabase: Client, memberId: string, gym: Gym,
  expected: { gymId: string; revision: string },
): Promise<WaiverState> {
  const current = await getWaiverState(supabase, memberId, gym);
  if (expected.gymId !== gym.id || expected.revision !== current.document.revision) throw new WaiverChangedError();
  if (current.accepted) return current;
  const signedAt = new Date().toISOString();
  if (current.document.id) {
    const { error } = await supabase.from('waiver_signatures').insert({
      gym_id: gym.id, member_id: memberId, waiver_id: current.document.id,
      signed_at: signedAt, signature: current.document.revision,
      signature_data: JSON.stringify({ method: 'explicit_acceptance', gymId: gym.id, document: current.document }),
    });
    // Re-read after a parallel insert; an unrelated conflict cannot unlock.
    if (error && error.code !== '23505') throw new WaiverUnavailableError();
  } else {
    const { error } = await supabase.from('profiles').update({ waiver_signed_at: signedAt })
      .eq('id', memberId).select('waiver_signed_at').single();
    if (error) throw new WaiverUnavailableError();
  }
  const saved = await getWaiverState(supabase, memberId, gym);
  if (saved.document.revision !== current.document.revision) throw new WaiverChangedError();
  if (!saved.accepted) throw new WaiverUnavailableError();
  return saved;
}
