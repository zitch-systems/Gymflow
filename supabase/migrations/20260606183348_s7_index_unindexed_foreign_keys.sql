-- S7: Cover every foreign key that the Supabase performance linter flagged
-- as un-indexed (lint 0001). Without these, every parent UPDATE/DELETE has
-- to sequentially scan the child to enforce the FK. The cost is invisible
-- today (most tables sub-10 rows) but grows linearly with traffic.
-- Naming: idx_<table>_<column>. IF NOT EXISTS keeps the migration idempotent.

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id              ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_class_schedules_gym_id          ON public.class_schedules(gym_id);
CREATE INDEX IF NOT EXISTS idx_class_schedules_instructor_id   ON public.class_schedules(instructor_id);
CREATE INDEX IF NOT EXISTS idx_client_errors_gym_id            ON public.client_errors(gym_id);
CREATE INDEX IF NOT EXISTS idx_client_errors_user_id           ON public.client_errors(user_id);
CREATE INDEX IF NOT EXISTS idx_equipment_maintenance_equipment ON public.equipment_maintenance(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_maintenance_gym_id    ON public.equipment_maintenance(gym_id);
CREATE INDEX IF NOT EXISTS idx_expenses_created_by             ON public.expenses(created_by);
CREATE INDEX IF NOT EXISTS idx_gym_member_links_member_id      ON public.gym_member_links(member_id);
CREATE INDEX IF NOT EXISTS idx_gym_member_links_user_id        ON public.gym_member_links(user_id);
CREATE INDEX IF NOT EXISTS idx_instructor_payouts_processed_by ON public.instructor_payouts(processed_by);
CREATE INDEX IF NOT EXISTS idx_instructor_subscriptions_plan   ON public.instructor_subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_member_subs_gym_id              ON public.member_subscriptions(gym_id);
CREATE INDEX IF NOT EXISTS idx_member_subs_member_id           ON public.member_subscriptions(member_id);
CREATE INDEX IF NOT EXISTS idx_member_subs_plan_id             ON public.member_subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_membership_plans_gym_id         ON public.membership_plans(gym_id);
CREATE INDEX IF NOT EXISTS idx_memberships_plan_id             ON public.memberships(plan_id);
CREATE INDEX IF NOT EXISTS idx_notifications_gym_id            ON public.notifications(gym_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id           ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_plan_id                ON public.payments(plan_id);
CREATE INDEX IF NOT EXISTS idx_platform_admins_user_id         ON public.platform_admins(user_id);
CREATE INDEX IF NOT EXISTS idx_salary_payments_staff_id        ON public.salary_payments(staff_id);
CREATE INDEX IF NOT EXISTS idx_salary_payments_staff_link_id   ON public.salary_payments(staff_link_id);
CREATE INDEX IF NOT EXISTS idx_staff_profile_id                ON public.staff(profile_id);
CREATE INDEX IF NOT EXISTS idx_staff_user_id                   ON public.staff(user_id);
CREATE INDEX IF NOT EXISTS idx_waiver_signatures_gym_id        ON public.waiver_signatures(gym_id);
CREATE INDEX IF NOT EXISTS idx_waiver_signatures_member_id     ON public.waiver_signatures(member_id);
CREATE INDEX IF NOT EXISTS idx_waiver_signatures_waiver_id     ON public.waiver_signatures(waiver_id);
