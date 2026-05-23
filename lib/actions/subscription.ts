'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/dal';
import { getGymBySlug, requireStaff } from '@/lib/auth/gym';

type Result = { ok: boolean; error?: string };

// ── Member-initiated ────────────────────────────────────────────────────

export async function requestPause(slug: string, reason: string): Promise<Result> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };
  const gym = await getGymBySlug(slug);
  if (!gym) return { ok: false, error: 'Gym not found' };

  const supabase = await createClient();
  const { data: sub } = await supabase
    .from('memberships')
    .select('id')
    .eq('member_id', user.id)
    .eq('gym_id', gym.id)
    .eq('status', 'active')
    .order('end_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub) return { ok: false, error: 'No active membership to pause' };

  const { error } = await supabase
    .from('memberships')
    .update({ status: 'pause_requested', updated_at: new Date().toISOString() })
    .eq('id', sub.id);
  if (error) return { ok: false, error: error.message };

  await supabase.from('audit_logs').insert({
    gym_id: gym.id,
    actor_id: user.id,
    user_id: user.id,
    action: 'member.pause_requested',
    table_name: 'memberships',
    record_id: sub.id,
    new_values: { reason },
  });

  revalidatePath('/dashboard');
  return { ok: true };
}

export async function cancelAtPeriodEnd(slug: string): Promise<Result> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };
  const gym = await getGymBySlug(slug);
  if (!gym) return { ok: false, error: 'Gym not found' };

  const supabase = await createClient();
  const { data: sub } = await supabase
    .from('memberships')
    .select('id')
    .eq('member_id', user.id)
    .eq('gym_id', gym.id)
    .eq('status', 'active')
    .order('end_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub) return { ok: false, error: 'No active membership' };

  const { error } = await supabase
    .from('memberships')
    .update({ auto_debit_enabled: false, auto_renew: false, updated_at: new Date().toISOString() })
    .eq('id', sub.id);
  if (error) return { ok: false, error: error.message };

  await supabase.from('audit_logs').insert({
    gym_id: gym.id,
    actor_id: user.id,
    user_id: user.id,
    action: 'member.cancel_at_period_end',
    table_name: 'memberships',
    record_id: sub.id,
  });

  revalidatePath('/dashboard');
  return { ok: true };
}

// ── Admin-initiated ─────────────────────────────────────────────────────

export async function approvePause(slug: string, membershipId: string): Promise<Result> {
  const { user, gym } = await requireStaffContext(slug);
  const supabase = await createClient();
  const { error } = await supabase
    .from('memberships')
    .update({ status: 'paused', updated_at: new Date().toISOString() })
    .eq('id', membershipId)
    .eq('gym_id', gym.id);
  if (error) return { ok: false, error: error.message };
  await supabase.from('audit_logs').insert({
    gym_id: gym.id,
    actor_id: user.id,
    action: 'admin.pause_approved',
    table_name: 'memberships',
    record_id: membershipId,
  });
  revalidatePath('/admin/members');
  return { ok: true };
}

export async function resumeMembership(slug: string, membershipId: string): Promise<Result> {
  const { user, gym } = await requireStaffContext(slug);
  const supabase = await createClient();
  const { error } = await supabase
    .from('memberships')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', membershipId)
    .eq('gym_id', gym.id);
  if (error) return { ok: false, error: error.message };
  await supabase.from('audit_logs').insert({
    gym_id: gym.id,
    actor_id: user.id,
    action: 'admin.resume',
    table_name: 'memberships',
    record_id: membershipId,
  });
  revalidatePath('/admin/members');
  return { ok: true };
}

export async function extendMembership(slug: string, membershipId: string, days: number): Promise<Result> {
  const { user, gym } = await requireStaffContext(slug);
  if (!Number.isFinite(days) || days <= 0 || days > 365) return { ok: false, error: 'Days must be 1-365' };
  const supabase = await createClient();
  const { data: m } = await supabase
    .from('memberships')
    .select('end_date')
    .eq('id', membershipId)
    .eq('gym_id', gym.id)
    .maybeSingle();
  if (!m) return { ok: false, error: 'Not found' };
  const base = new Date(m.end_date);
  base.setDate(base.getDate() + days);
  const newEnd = base.toISOString().split('T')[0];
  const { error } = await supabase
    .from('memberships')
    .update({ end_date: newEnd, updated_at: new Date().toISOString() })
    .eq('id', membershipId)
    .eq('gym_id', gym.id);
  if (error) return { ok: false, error: error.message };
  await supabase.from('audit_logs').insert({
    gym_id: gym.id,
    actor_id: user.id,
    action: 'admin.extend_membership',
    table_name: 'memberships',
    record_id: membershipId,
    new_values: { days, new_end_date: newEnd },
  });
  revalidatePath('/admin/members');
  return { ok: true };
}

export async function cancelMembership(slug: string, membershipId: string): Promise<Result> {
  const { user, gym } = await requireStaffContext(slug);
  const supabase = await createClient();
  const { error } = await supabase
    .from('memberships')
    .update({ status: 'cancelled', auto_debit_enabled: false, auto_renew: false, updated_at: new Date().toISOString() })
    .eq('id', membershipId)
    .eq('gym_id', gym.id);
  if (error) return { ok: false, error: error.message };
  await supabase.from('audit_logs').insert({
    gym_id: gym.id,
    actor_id: user.id,
    action: 'admin.cancel_membership',
    table_name: 'memberships',
    record_id: membershipId,
  });
  revalidatePath('/admin/members');
  return { ok: true };
}

async function requireStaffContext(slug: string) {
  const { gym } = await requireStaff(slug);
  const user = await getSessionUser();
  if (!user) throw new Error('Not signed in');
  return { user, gym };
}
