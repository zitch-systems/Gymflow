-- Close the remaining Supabase advisor findings that are real (2026-09-23).
--
-- (1) Covering indexes for four foreign keys. Without them a DELETE/UPDATE on
--     the parent (gyms, whatsapp_contacts) scans the child table, and every
--     per-gym read of these tables is a seq scan.
-- (2) Pin search_path on payments_reject_tenant_commission. It is a trigger on
--     payments (not SECURITY DEFINER), so a mutable search_path is low-risk,
--     but every other function in the schema pins it and the advisor flags it.
--
-- Idempotent.

create index if not exists idx_platform_payments_gym_id
  on public.platform_payments (gym_id);

create index if not exists idx_salary_payments_gym_id
  on public.salary_payments (gym_id);

create index if not exists idx_whatsapp_flow_sessions_gym_id
  on public.whatsapp_flow_sessions (gym_id);

create index if not exists idx_whatsapp_payment_intents_contact_id
  on public.whatsapp_payment_intents (contact_id);

alter function public.payments_reject_tenant_commission()
  set search_path = public, pg_temp;
