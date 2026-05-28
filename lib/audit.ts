import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

type DB = SupabaseClient<Database>;

/**
 * Best-effort audit log insert. Never throws — auditing must not block the
 * operation it's tracking. Use as fire-and-forget:
 *
 *   await audit(supabase, { gymId, actorId, action: 'admin.plan_created',
 *     table: 'membership_plans', recordId: plan.id, after: { name, price } });
 *
 * Skipped silently if any required field is missing so callers don't need
 * to defensively guard every site.
 */
export async function audit(
  supabase: DB,
  args: {
    gymId: string | null;
    actorId: string | null;
    action: string;
    table: string;
    recordId?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    userId?: string | null;
  },
): Promise<void> {
  try {
    await supabase.from('audit_logs').insert({
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
    // audit_logs has its own INSERT policy that may not match every caller
    // (e.g. member-initiated paths). Never propagate.
    console.warn('[GF audit] insert failed:', (e as Error).message);
  }
}
