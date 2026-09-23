-- Platform revenue totals, aggregated in Postgres.
--
-- /superadmin and /superadmin/revenue summed payment rows fetched over
-- PostgREST. PostgREST caps a response at max-rows (1000 on Supabase), so past
-- 1000 payments every all-time and 12-month figure silently stopped growing —
-- a plausible-looking wrong number rather than an error.
--
-- SECURITY INVOKER: RLS on payments / platform_payments still decides which
-- rows count, so a platform admin sees every gym and anyone else sees only
-- what their own policies already allow. No new read surface.
--
-- Month buckets are WAT calendar months, matching the rest of the console.
-- Status filters are the ones each page used before, unchanged:
--   · member revenue series:  payments.status in (success, successful, completed, paid)
--   · member GMV:             payments.payment_status = 'successful'
--   · platform collections:   platform_payments.payment_status = 'successful',
--                             bucketed on billing_period_start (the self-heal
--                             callback can insert a row days after the charge).

create or replace function public.platform_revenue_summary(p_months integer default 12)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with bounds as (
    select date_trunc('month', now() at time zone 'Africa/Lagos')::date as this_month,
           (date_trunc('month', now() at time zone 'Africa/Lagos')
             - make_interval(months => greatest(p_months, 1) - 1))::date as first_month
  ),
  months as (
    select generate_series(b.first_month, b.this_month, interval '1 month')::date as month
    from bounds b
  ),
  member_paid as (
    select date_trunc('month', p.payment_date at time zone 'Africa/Lagos')::date as month,
           sum(p.amount) as total
    from public.payments p, bounds b
    where p.status = any (array['success', 'successful', 'completed', 'paid'])
      and p.payment_date >= (b.first_month::timestamp at time zone 'Africa/Lagos')
    group by 1
  ),
  platform_paid as (
    select date_trunc('month', pp.billing_period_start)::date as month,
           sum(pp.amount) as total
    from public.platform_payments pp, bounds b
    where pp.payment_status = 'successful'
      and pp.billing_period_start >= b.first_month
    group by 1
  )
  select jsonb_build_object(
    'member_monthly', (
      select jsonb_agg(jsonb_build_object('month', to_char(m.month, 'YYYY-MM'), 'total', coalesce(mp.total, 0)) order by m.month)
      from months m left join member_paid mp using (month)
    ),
    'platform_monthly', (
      select jsonb_agg(jsonb_build_object('month', to_char(m.month, 'YYYY-MM'), 'total', coalesce(pp.total, 0)) order by m.month)
      from months m left join platform_paid pp using (month)
    ),
    'platform_this_month', (
      select coalesce(sum(pp.amount), 0) from public.platform_payments pp, bounds b
      where pp.payment_status = 'successful' and pp.billing_period_start >= b.this_month
    ),
    'platform_all_time', (
      select coalesce(sum(pp.amount), 0) from public.platform_payments pp
      where pp.payment_status = 'successful'
    ),
    'member_gmv', (
      select coalesce(sum(p.amount), 0) from public.payments p
      where p.payment_status = 'successful'
    )
  );
$$;

-- Supabase's default privileges grant EXECUTE to anon by name, so PUBLIC alone
-- is not enough (see 20260826090000).
revoke all on function public.platform_revenue_summary(integer) from public, anon;
grant execute on function public.platform_revenue_summary(integer) to authenticated, service_role;
