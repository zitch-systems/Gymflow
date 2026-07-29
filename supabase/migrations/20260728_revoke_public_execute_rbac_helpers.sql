-- Take the three live RBAC helpers off the anon-facing RPC surface.
--
-- has_gym_role / is_gym_staff / is_platform_admin are SECURITY DEFINER and
-- still carry the default PUBLIC execute grant, so PostgREST exposes them at
-- /rest/v1/rpc/<name> to unauthenticated callers (Supabase advisors 0028).
-- They answer "does the CALLER have this role", so anon only ever gets false —
-- but an unauthenticated caller has no business calling them at all, and the
-- repo already took this posture once for the unused helpers
-- (20260626_lock_down_unused_security_definer_fns.sql).
--
-- These three, unlike those, ARE used — by ~20 RLS policies. Policy
-- expressions are evaluated as the querying role, so `authenticated` MUST keep
-- EXECUTE or every policy that calls them starts failing with "permission
-- denied for function". Hence: revoke the blanket PUBLIC grant, then grant
-- back explicitly to the roles that need it. has_gym_role had no explicit
-- grant of its own (it inherited PUBLIC's), so the grant below is what keeps
-- signed-in users working.
--
-- Safe for anon: the only anon-readable tables are gyms, membership_plans,
-- classes and business_hours (20260714_public_landing_reads.sql), and none of
-- their policies reference these helpers. The policies that do — on
-- audit_logs, gym_member_links, gym_payout_accounts, gym_staff_links,
-- payout_change_requests and support_tickets — are never queried by anon.
--
-- Idempotent.

revoke execute on function public.has_gym_role(uuid, public.user_role[]) from public;
grant execute on function public.has_gym_role(uuid, public.user_role[]) to authenticated, service_role;

revoke execute on function public.is_gym_staff(uuid) from public;
grant execute on function public.is_gym_staff(uuid) to authenticated, service_role;

revoke execute on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated, service_role;
