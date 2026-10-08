-- Cover recovery and financial foreign keys without changing access or money.
set lock_timeout = '3s';
set statement_timeout = '30s';
create index if not exists privileged_session_verifications_trusted_device_id_idx on private.privileged_session_verifications (trusted_device_id);
create index if not exists member_auto_renewal_intents_member_id_idx on public.member_auto_renewal_intents (member_id);
create index if not exists member_auto_renewal_intents_plan_id_idx on public.member_auto_renewal_intents (plan_id);
create index if not exists member_payment_checkouts_member_id_idx on public.member_payment_checkouts (member_id);
create index if not exists member_payment_checkouts_plan_id_idx on public.member_payment_checkouts (plan_id);
create index if not exists payment_coverage_allocations_member_id_idx on public.payment_coverage_allocations (member_id);
create index if not exists payment_coverage_allocations_subscription_id_idx on public.payment_coverage_allocations (subscription_id);
create index if not exists profile_health_note_audit_actor_id_idx on public.profile_health_note_audit (actor_id);
create index if not exists profile_health_note_audit_member_id_idx on public.profile_health_note_audit (member_id);
create index if not exists profile_health_notes_updated_by_idx on public.profile_health_notes (updated_by);
create index if not exists staff_financial_operations_member_id_idx on public.staff_financial_operations (member_id);
create index if not exists staff_financial_operations_payment_id_idx on public.staff_financial_operations (payment_id);
create index if not exists staff_financial_operations_plan_id_idx on public.staff_financial_operations (plan_id);

alter policy coverage_allocations_read on public.payment_coverage_allocations
using ((member_id = (select auth.uid())) or private.has_gym_role(gym_id,
  array['gym_owner','manager','front_desk','accountant']::public.user_role[]));
