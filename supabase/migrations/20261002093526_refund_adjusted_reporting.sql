-- Refund-adjusted reporting over immutable gross charges.
--
-- The financial-integrity migration adds refunded_amount after the original
-- reporting functions were installed. Partial refunds remain successful rows,
-- so every revenue aggregate must subtract refunded_amount explicitly. Gross
-- amount stays immutable for receipts and reconciliation. Commission is shown
-- as a proportional refund-adjusted estimate for both percentage and flat
-- arrangements; provider-side commission reversals are not independently
-- verified here.

create or replace function public.gym_reporting_summary(p_gym_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if (select auth.uid()) is null or not private.is_gym_staff(p_gym_id) then
    raise exception 'gym reporting is restricted to verified gym staff'
      using errcode = 'insufficient_privilege';
  end if;
  return (
  with params as (
    select (now() at time zone 'Africa/Lagos')::date as today
  ),
  active_links as (
    select coalesce(l.member_id, l.user_id) as member_id, l.joined_at
    from public.gym_member_links l
    where l.gym_id = p_gym_id and l.is_active is true
  ),
  current_members as (
    select
      l.member_id,
      l.joined_at,
      s.plan_id,
      s.status,
      s.start_date,
      s.end_date,
      case
        when s.status = 'paused' then 'frozen'
        when s.status = 'pause_requested' then 'freeze_pending'
        when s.status in ('active', 'past_due') and s.start_date > x.today then 'scheduled'
        when s.status in ('active', 'past_due') and s.start_date <= x.today and s.end_date >= x.today then 'active'
        else 'expired'
      end as display_state
    from active_links l
    cross join params x
    left join lateral (
      select ms.*
      from public.member_subscriptions ms
      where ms.gym_id = p_gym_id and ms.member_id = l.member_id
      order by
        (ms.status in ('active', 'past_due', 'paused', 'pause_requested')) desc,
        ms.end_date desc,
        ms.start_date desc,
        ms.updated_at desc nulls last,
        ms.id desc
      limit 1
    ) s on true
  ),
  member_counts as (
    select
      count(*) as roster,
      count(*) filter (where display_state = 'active') as active_access,
      count(*) filter (where display_state = 'active' and end_date < x.today + 7) as expiring,
      count(*) filter (where display_state = 'expired') as lapsed,
      count(*) filter (where display_state = 'scheduled') as scheduled,
      count(*) filter (where display_state = 'frozen') as frozen,
      count(*) filter (where display_state = 'freeze_pending') as freeze_pending,
      count(*) filter (where joined_at >= (x.today - 29)::timestamp at time zone 'Africa/Lagos') as fresh,
      count(*) filter (
        where display_state = 'expired'
          and end_date between x.today - 29 and x.today
      ) as churned_30d
    from current_members cross join params x
    group by x.today
  ),
  payment_daily as (
    select (p.payment_date at time zone 'Africa/Lagos')::date as day,
           coalesce(sum(greatest(p.amount - coalesce(p.refunded_amount, 0), 0)), 0) as total
    from public.payments p cross join params x
    where p.gym_id = p_gym_id
      and p.payment_status = 'successful'
      and p.payment_date >= ((x.today - 41)::timestamp at time zone 'Africa/Lagos')
    group by 1
  ),
  revenue_days as (
    select d::date as day, coalesce(p.total, 0) as total
    from params x
    cross join lateral generate_series(x.today - 41, x.today, interval '1 day') d
    left join payment_daily p on p.day = d::date
  ),
  checkin_daily as (
    select (c.checked_in_at at time zone 'Africa/Lagos')::date as day,
           count(*) as total
    from public.check_ins c cross join params x
    where c.gym_id = p_gym_id
      and c.checked_in_at >= ((x.today - 6)::timestamp at time zone 'Africa/Lagos')
    group by 1
  ),
  checkin_days as (
    select d::date as day, coalesce(c.total, 0) as total
    from params x
    cross join lateral generate_series(x.today - 6, x.today, interval '1 day') d
    left join checkin_daily c on c.day = d::date
  ),
  plan_mix as (
    select cm.plan_id, coalesce(mp.name, 'Other') as name, count(*) as total
    from current_members cm
    left join public.membership_plans mp on mp.id = cm.plan_id and mp.gym_id = p_gym_id
    where cm.display_state = 'active'
    group by cm.plan_id, mp.name
  )
  select jsonb_build_object(
    'roster', coalesce((select roster from member_counts), 0),
    'activeAccess', coalesce((select active_access from member_counts), 0),
    'expiring', coalesce((select expiring from member_counts), 0),
    'lapsed', coalesce((select lapsed from member_counts), 0),
    'scheduled', coalesce((select scheduled from member_counts), 0),
    'frozen', coalesce((select frozen from member_counts), 0),
    'freezePending', coalesce((select freeze_pending from member_counts), 0),
    'fresh', coalesce((select fresh from member_counts), 0),
    'churned30d', coalesce((select churned_30d from member_counts), 0),
    'revenue30d', coalesce((select sum(total) from revenue_days where day >= (select today - 29 from params)), 0),
    'revenueDaily', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'total', total) order by day) from revenue_days), '[]'::jsonb),
    'checkinsToday', coalesce((select total from checkin_days where day = (select today from params)), 0),
    'checkins7d', coalesce((select sum(total) from checkin_days), 0),
    'checkinDaily', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'total', total) order by day) from checkin_days), '[]'::jsonb),
    'planMix', coalesce((select jsonb_agg(jsonb_build_object('planId', plan_id, 'name', name, 'total', total) order by total desc, name) from plan_mix), '[]'::jsonb)
  )
  );
end;
$$;

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
           sum(greatest(p.amount - coalesce(p.refunded_amount, 0), 0)) as total
    from public.payments p, bounds b
    where p.status = any (array['success', 'successful', 'completed', 'paid'])
      and p.payment_date >= (b.first_month::timestamp at time zone 'Africa/Lagos')
    group by 1
  ),
  platform_paid as (
    select date_trunc('month', pp.billing_period_start)::date as month,
           sum(greatest(pp.amount - coalesce(pp.refunded_amount, 0), 0)) as total
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
      select coalesce(sum(greatest(pp.amount - coalesce(pp.refunded_amount, 0), 0)), 0) from public.platform_payments pp, bounds b
      where pp.payment_status = 'successful' and pp.billing_period_start >= b.this_month
    ),
    'platform_all_time', (
      select coalesce(sum(greatest(pp.amount - coalesce(pp.refunded_amount, 0), 0)), 0) from public.platform_payments pp
      where pp.payment_status = 'successful'
    ),
    'member_gmv', (
      select coalesce(sum(greatest(p.amount - coalesce(p.refunded_amount, 0), 0)), 0) from public.payments p
      where p.payment_status = 'successful'
    )
  );
$$;

-- Supabase's default privileges grant EXECUTE to anon by name, so PUBLIC alone
-- is not enough (see 20260826090000).
revoke all on function public.platform_revenue_summary(integer) from public, anon;
grant execute on function public.platform_revenue_summary(integer) to authenticated, service_role;

create or replace function public.platform_commission_by_gym(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  gym_id uuid,
  gym_name text,
  commission_mode text,
  commission_pct numeric,
  commission_fixed_amount numeric,
  commission_payments bigint,
  commission_total numeric,
  percentage_payments bigint,
  percentage_total numeric,
  flat_payments bigint,
  flat_total numeric,
  unclassified_payments bigint,
  unclassified_total numeric,
  unrecorded_payments bigint,
  held_payments bigint,
  held_total numeric
)
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
begin
  if not private.is_platform_admin() then
    raise exception 'platform commission reporting is restricted to platform admins'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  with paid as (
    select
      p.*,
      greatest(p.amount - coalesce(p.refunded_amount, 0), 0) as net_amount,
      case when p.platform_commission_amount is null or p.amount <= 0 then null
        else p.platform_commission_amount
          * greatest(p.amount - coalesce(p.refunded_amount, 0), 0)
          / p.amount
      end as adjusted_commission
    from public.payments p
    where lower(coalesce(nullif(p.status, ''), p.payment_status, ''))
            in ('success', 'successful', 'completed', 'paid')
      and lower(coalesce(p.status, '')) <> 'refunded'
      and lower(coalesce(p.payment_status, '')) <> 'refunded'
      and (p_from is null or coalesce(p.payment_date, p.created_at) >= p_from)
      and (p_to is null or coalesce(p.payment_date, p.created_at) < p_to)
  )
  select
    g.id,
    g.name,
    g.platform_commission_mode,
    g.platform_commission_pct,
    g.platform_commission_fixed_amount,

    count(*) filter (where p.platform_settlement = 'split'
                       and p.adjusted_commission is not null and p.net_amount > 0),
    coalesce(sum(p.adjusted_commission) filter (
      where p.platform_settlement = 'split'), 0),

    count(*) filter (where p.platform_settlement = 'split'
                       and p.adjusted_commission is not null and p.net_amount > 0
                       and (p.platform_commission_basis = 'percentage'
                            or (p.platform_commission_basis is null and p.platform_commission_pct is not null))),
    coalesce(sum(p.adjusted_commission) filter (
      where p.platform_settlement = 'split'
        and (p.platform_commission_basis = 'percentage'
             or (p.platform_commission_basis is null and p.platform_commission_pct is not null))), 0),

    count(*) filter (where p.platform_settlement = 'split'
                       and p.adjusted_commission is not null and p.net_amount > 0
                       and p.platform_commission_basis = 'flat'),
    coalesce(sum(p.adjusted_commission) filter (
      where p.platform_settlement = 'split' and p.platform_commission_basis = 'flat'), 0),

    count(*) filter (where p.platform_settlement = 'split'
                       and p.adjusted_commission is not null and p.net_amount > 0
                       and p.platform_commission_basis is null and p.platform_commission_pct is null),
    coalesce(sum(p.adjusted_commission) filter (
      where p.platform_settlement = 'split'
        and p.platform_commission_basis is null and p.platform_commission_pct is null), 0),

    count(*) filter (where p.platform_settlement is null and p.net_amount > 0),
    count(*) filter (where p.platform_settlement = 'platform_only' and p.net_amount > 0),
    coalesce(sum(p.net_amount) filter (where p.platform_settlement = 'platform_only'), 0)

  from paid p
  join public.gyms g on g.id = p.gym_id
  group by g.id, g.name, g.platform_commission_mode,
           g.platform_commission_pct, g.platform_commission_fixed_amount
  having count(*) filter (where p.platform_settlement = 'split'
                            and p.adjusted_commission is not null and p.net_amount > 0) > 0
      or count(*) filter (where p.platform_settlement = 'platform_only' and p.net_amount > 0) > 0
      or count(*) filter (where p.platform_settlement is null and p.net_amount > 0) > 0
  order by coalesce(sum(p.adjusted_commission) filter (
             where p.platform_settlement = 'split'), 0) desc,
           g.name asc;
end;
$function$;

revoke all on function public.platform_commission_by_gym(timestamptz, timestamptz) from public;
grant execute on function public.platform_commission_by_gym(timestamptz, timestamptz) to authenticated;

comment on function public.platform_commission_by_gym(timestamptz, timestamptz) is
  'Per-gym proportional refund-adjusted commission estimate over [p_from, p_to). Both percentage and flat recorded commission scale by net charge / gross charge; provider-side commission reversals are not independently verified. Platform admins only.';
