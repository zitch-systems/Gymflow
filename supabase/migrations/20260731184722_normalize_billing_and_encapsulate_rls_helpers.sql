
-- Normalize legacy platform billing state without fabricating payment credentials.
update public.gyms g
set trial_ends_at = null
where g.subscription_status = 'active'
  and g.subscription_plan in ('starter', 'growth', 'scale')
  and g.subscription_current_period_end > now()
  and exists (
    select 1
    from public.platform_payments p
    where p.gym_id = g.id
      and p.payment_status::text in ('success', 'successful', 'paid')
      and p.billing_period_end >= current_date
  );

update public.gyms g
set subscription_plan = 'starter',
    subscription_status = 'trial'
where g.subscription_plan = 'monthly'
  and g.subscription_status = 'active'
  and g.trial_ends_at > now()
  and g.subscription_current_period_end is null
  and nullif(g.paystack_subscription_code, '') is null
  and nullif(g.paystack_customer_code, '') is null
  and not exists (
    select 1
    from public.platform_payments p
    where p.gym_id = g.id
      and p.payment_status::text in ('success', 'successful', 'paid')
  );

alter table public.gyms
  add constraint gyms_subscription_plan_valid
  check (subscription_plan is null or subscription_plan in ('starter', 'growth', 'scale'))
  not valid;

alter table public.gyms
  validate constraint gyms_subscription_plan_valid;

alter table public.gyms
  add constraint gyms_subscription_status_valid
  check (subscription_status is null or subscription_status in ('trial', 'active', 'past_due', 'cancelled'))
  not valid;

alter table public.gyms
  validate constraint gyms_subscription_status_valid;

-- pg_trgm is relocatable; its two GIN indexes retain their operator-class OIDs.
alter extension pg_trgm set schema extensions;

-- Keep SECURITY DEFINER helpers outside the Data API schema. ALTER ... SET SCHEMA
-- preserves the OIDs, so every dependent RLS policy follows the functions safely.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

alter function public.is_platform_admin() set schema private;
alter function public.has_gym_role(uuid, public.user_role[]) set schema private;
alter function public.is_gym_staff(uuid) set schema private;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    exists (
      select 1
      from public.profiles
      where id = (select auth.uid())
        and role = 'platform_admin'
        and coalesce(is_active, true) = true
    )
    or exists (
      select 1
      from public.platform_admins
      where user_id = (select auth.uid())
        and coalesce(is_active, true) = true
    );
$function$;

create or replace function private.has_gym_role(
  p_gym_id uuid,
  p_roles public.user_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.gym_staff_links
    where gym_id = p_gym_id
      and user_id = (select auth.uid())
      and role = any(p_roles)
      and is_active = true
  );
$function$;

create or replace function private.is_gym_staff(_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.gym_staff_links s
    where s.user_id = (select auth.uid())
      and s.gym_id = _gym_id
      and s.is_active is true
  ) or private.is_platform_admin();
$function$;

revoke all on function private.is_platform_admin() from public, anon;
revoke all on function private.has_gym_role(uuid, public.user_role[]) from public, anon;
revoke all on function private.is_gym_staff(uuid) from public, anon;
grant execute on function private.is_platform_admin() to authenticated, service_role;
grant execute on function private.has_gym_role(uuid, public.user_role[]) to authenticated, service_role;
grant execute on function private.is_gym_staff(uuid) to authenticated, service_role;
