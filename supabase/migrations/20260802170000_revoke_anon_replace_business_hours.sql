-- Revoke anon's EXECUTE on replace_business_hours explicitly.
--
-- 20260729_business_hours_split_sessions.sql does:
--   revoke execute on function public.replace_business_hours(uuid, jsonb) from public;
--   grant  execute on function public.replace_business_hours(uuid, jsonb) to authenticated, service_role;
--
-- Revoking from PUBLIC removes the implicit grant every role inherits, but it
-- does NOT remove a DIRECT grant previously made to a named role. The live
-- project had exactly that leftover: anon still held EXECUTE, so live and the
-- migrations disagreed while every name and body matched — invisible to the
-- drift gate until it grew a FUNCTIONGRANT layer.
--
-- Not exploitable as it stood (the function is SECURITY INVOKER, so its delete
-- and insert on business_hours still faced the owner-scoped RLS policies), but
-- an anon role holding EXECUTE on a function that rewrites a gym's opening
-- hours is one `security definer` away from being a real hole, and the repo is
-- supposed to be the schema.
--
-- Idempotent: revoking a privilege that isn't held is a no-op.

revoke execute on function public.replace_business_hours(uuid, jsonb) from anon;
grant execute on function public.replace_business_hours(uuid, jsonb) to authenticated, service_role;
