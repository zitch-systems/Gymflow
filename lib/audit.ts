import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/database.types';

type Json = Database['public']['Tables']['audit_logs']['Insert']['new_values'];

// Best-effort audit trail for privileged actions — feeds the superadmin
// /superadmin/audit page (which reads action/table_name/actor_id/record_id).
// Service-role because audit_logs is RLS-locked to platform admins; writes are
// fire-and-forget: an audit failure must never break the action it describes.
//
// ip_address is captured automatically from the request context when one
// exists (server actions, route handlers); webhook/cron calls simply record
// null. Pass oldValues for the before-image on mutations where "what changed
// FROM" matters (role changes, plan edits, status flips).
export async function logAudit(entry: {
  action: string;          // e.g. 'payment_recorded', 'member_suspended'
  table: string;           // primary table touched
  actorId?: string | null; // staff/platform user who acted
  gymId?: string | null;
  recordId?: string | null;
  values?: Record<string, unknown> | null;    // new/changed values (keep small)
  oldValues?: Record<string, unknown> | null; // before-image (keep small)
}): Promise<void> {
  try {
    // headers() throws outside a request scope (e.g. a cron-spawned call) —
    // the audit row is still written, just without an IP.
    let ip: string | null = null;
    try {
      const h = await headers();
      ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null;
    } catch { /* no request context */ }

    const admin = createAdminClient();
    await admin.from('audit_logs').insert({
      action: entry.action,
      table_name: entry.table,
      actor_id: entry.actorId ?? null,
      gym_id: entry.gymId ?? null,
      record_id: entry.recordId ?? null,
      new_values: (entry.values ?? null) as Json,
      old_values: (entry.oldValues ?? null) as Json,
      ip_address: ip,
    });
  } catch (e) {
    console.warn(`[audit] failed to record ${entry.action}: ${(e as Error).message}`);
  }
}
