import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/database.types';

type Json = Database['public']['Tables']['audit_logs']['Insert']['new_values'];

// Best-effort audit trail for privileged actions — feeds the superadmin
// /superadmin/audit page (which reads action/table_name/actor_id/record_id).
// Service-role because audit_logs is RLS-locked to platform admins; writes are
// fire-and-forget: an audit failure must never break the action it describes.
export async function logAudit(entry: {
  action: string;          // e.g. 'payment_recorded', 'member_suspended'
  table: string;           // primary table touched
  actorId?: string | null; // staff/platform user who acted
  gymId?: string | null;
  recordId?: string | null;
  values?: Record<string, unknown> | null; // new/changed values (keep small)
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from('audit_logs').insert({
      action: entry.action,
      table_name: entry.table,
      actor_id: entry.actorId ?? null,
      gym_id: entry.gymId ?? null,
      record_id: entry.recordId ?? null,
      new_values: (entry.values ?? null) as Json,
    });
  } catch (e) {
    console.warn(`[audit] failed to record ${entry.action}: ${(e as Error).message}`);
  }
}
