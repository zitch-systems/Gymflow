import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Best-effort audit log insert. Never throws — auditing must not block the
 * operation it's tracking. Use as fire-and-forget:
 *
 *   await audit({ gymId, actorId, action: 'admin.plan_created',
 *     table: 'membership_plans', recordId: plan.id, after: { name, price } });
 *
 * Uses its own admin (service-role) client because audit_logs.INSERT policy
 * is restricted to service_role — letting authenticated callers write would
 * let a malicious actor forge audit entries with someone else's actor_id.
 * The caller has already done its own authz before invoking this helper.
 */
export async function audit(args: {
  gymId: string | null;
  actorId: string | null;
  action: string;
  table: string;
  recordId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  userId?: string | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from('audit_logs').insert({
      gym_id: args.gymId,
      actor_id: args.actorId,
      user_id: args.userId ?? null,
      action: args.action,
      table_name: args.table,
      record_id: args.recordId ?? null,
      // before/after are typed as plain Record but the column is jsonb. The
      // values we pass come from our own server code (no user input is
      // serialised directly) so JSON.parse(JSON.stringify(...)) gives us a
      // canonical Json shape Supabase's typegen will accept.
      old_values: args.before ? JSON.parse(JSON.stringify(args.before)) : null,
      new_values: args.after ? JSON.parse(JSON.stringify(args.after)) : null,
    });
  } catch (e) {
    // Service-role-key misconfiguration or transient DB error. Never propagate
    // — auditing must not block the op it's tracking.
    console.warn('[GF audit] insert failed:', (e as Error).message);
  }
}
