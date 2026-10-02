-- Scale-safe staff and platform reporting.
--
-- The console previously fetched raw rows and summed them in JavaScript. A
-- PostgREST response is capped (1000 rows by default), so revenue, attendance,
-- plan mix, churn and roster search could all look plausible while omitting
-- records. These functions aggregate and paginate in Postgres after an explicit
-- verified-staff/platform-admin check. That single gate also avoids evaluating
-- the same RLS staff predicate once per result row on large rosters.

create index if not exists idx_member_subscriptions_gym_member_history
  on public.member_subscriptions
  (gym_id, member_id, end_date desc, start_date desc, updated_at desc, id desc);

create or replace function public.gym_member_roster(
  p_gym_id uuid,
  p_search text default null,
  p_filter text default 'all',
  p_offset integer default 0,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if (select auth.uid()) is null or not private.is_gym_staff(p_gym_id) then
    raise exception 'gym roster reporting is restricted to verified gym staff'
      using errcode = 'insufficient_privilege';
  end if;
  return (
  with params as (
    select
      (now() at time zone 'Africa/Lagos')::date as today,
      lower(left(trim(coalesce(p_search, '')), 120)) as needle,
      case when p_filter = any (array['all', 'active', 'expiring', 'expired', 'scheduled', 'frozen', 'freeze'])
        then p_filter else 'all' end as filter,
      greatest(coalesce(p_offset, 0), 0) as row_offset,
      least(greatest(coalesce(p_limit, 50), 1), 100) as row_limit
  ),
  roster as (
    select
      coalesce(l.member_id, l.user_id) as member_id,
      l.joined_at,
      p.full_name,
      p.first_name,
      p.last_name,
      p.email,
      s.id as subscription_id,
      s.plan_id,
      s.status as subscription_status,
      s.start_date,
      s.end_date,
      mp.name as plan_name,
      mp.price as plan_price,
      case
        when s.status = 'paused' then 'frozen'
        when s.status = 'pause_requested' then 'freeze_pending'
        when s.status in ('active', 'past_due') and s.start_date > x.today then 'scheduled'
        when s.status in ('active', 'past_due') and s.start_date <= x.today and s.end_date >= x.today then 'active'
        else 'expired'
      end as display_state,
      x.today
    from public.gym_member_links l
    cross join params x
    join public.profiles p on p.id = coalesce(l.member_id, l.user_id)
    left join lateral (
      select ms.*
      from public.member_subscriptions ms
      where ms.gym_id = p_gym_id
        and ms.member_id = coalesce(l.member_id, l.user_id)
      order by
        (ms.status in ('active', 'past_due', 'paused', 'pause_requested')) desc,
        ms.end_date desc,
        ms.start_date desc,
        ms.updated_at desc nulls last,
        ms.id desc
      limit 1
    ) s on true
    left join public.membership_plans mp on mp.id = s.plan_id and mp.gym_id = p_gym_id
    where l.gym_id = p_gym_id
      and l.is_active is true
      and (
        x.needle = ''
        or strpos(lower(coalesce(p.full_name, '')), x.needle) > 0
        or strpos(lower(concat_ws(' ', p.first_name, p.last_name)), x.needle) > 0
        or strpos(lower(coalesce(p.email, '')), x.needle) > 0
      )
  ),
  filtered as (
    select r.*
    from roster r cross join params x
    where x.filter = 'all'
       or (x.filter = 'active' and r.display_state = 'active' and r.end_date >= r.today + 7)
       or (x.filter = 'expiring' and r.display_state = 'active' and r.end_date < r.today + 7)
       or (x.filter = 'expired' and r.display_state = 'expired')
       or (x.filter = 'scheduled' and r.display_state = 'scheduled')
       or (x.filter = 'frozen' and r.display_state = 'frozen')
       or (x.filter = 'freeze' and r.display_state = 'freeze_pending')
  ),
  page as (
    select f.*
    from filtered f
    order by f.joined_at desc nulls last, f.member_id
    offset (select row_offset from params)
    limit (select row_limit from params)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'memberId', p.member_id,
        'joinedAt', p.joined_at,
        'fullName', p.full_name,
        'firstName', p.first_name,
        'lastName', p.last_name,
        'email', p.email,
        'subscriptionId', p.subscription_id,
        'planId', p.plan_id,
        'subscriptionStatus', p.subscription_status,
        'startDate', p.start_date,
        'endDate', p.end_date,
        'planName', p.plan_name,
        'planPrice', p.plan_price,
        'displayState', p.display_state
      ) order by p.joined_at desc nulls last, p.member_id)
      from page p
    ), '[]'::jsonb)
  )
  );
end;
$$;

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
           coalesce(sum(p.amount), 0) as total
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

create or replace function public.platform_gym_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if (select auth.uid()) is null or not private.is_platform_admin() then
    raise exception 'platform reporting is restricted to verified platform admins'
      using errcode = 'insufficient_privilege';
  end if;
  return (
  with params as (
    select (now() at time zone 'Africa/Lagos')::date as today
  ),
  visible_gyms as (
    select g.id, coalesce(g.subscription_status, 'trial') as subscription_status,
           g.subscription_plan, g.subscription_billing_cycle
    from public.gyms g
  ),
  active_links as (
    select l.gym_id, coalesce(l.member_id, l.user_id) as member_id
    from public.gym_member_links l
    join visible_gyms g on g.id = l.gym_id
    where l.is_active is true
  ),
  entitled as (
    select l.gym_id, l.member_id
    from active_links l cross join params x
    join lateral (
      select ms.status, ms.start_date, ms.end_date
      from public.member_subscriptions ms
      where ms.gym_id = l.gym_id and ms.member_id = l.member_id
      order by
        (ms.status in ('active', 'past_due', 'paused', 'pause_requested')) desc,
        ms.end_date desc,
        ms.start_date desc,
        ms.updated_at desc nulls last,
        ms.id desc
      limit 1
    ) s on true
    where s.status in ('active', 'past_due')
      and s.start_date <= x.today
      and s.end_date >= x.today
  ),
  plan_mix as (
    select subscription_plan, subscription_billing_cycle, count(*) as total
    from visible_gyms
    where subscription_status = 'active'
    group by subscription_plan, subscription_billing_cycle
  )
  select jsonb_build_object(
    'gyms', (select count(*) from visible_gyms),
    'activeGyms', (select count(*) from visible_gyms where subscription_status = 'active'),
    'trialGyms', (select count(*) from visible_gyms where subscription_status = 'trial'),
    'pastDueGyms', (select count(*) from visible_gyms where subscription_status = 'past_due'),
    'members', (select count(*) from active_links),
    'activeSubscriptions', (select count(*) from entitled),
    'activePlanMix', coalesce((select jsonb_agg(jsonb_build_object(
      'tier', subscription_plan,
      'cycle', subscription_billing_cycle,
      'total', total
    ) order by subscription_plan, subscription_billing_cycle) from plan_mix), '[]'::jsonb)
  )
  );
end;
$$;

create or replace function public.platform_gym_member_counts(p_gym_ids uuid[])
returns table (gym_id uuid, member_count bigint)
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if (select auth.uid()) is null or not private.is_platform_admin() then
    raise exception 'platform reporting is restricted to verified platform admins'
      using errcode = 'insufficient_privilege';
  end if;
  return query
    select l.gym_id, count(*)::bigint as member_count
    from public.gym_member_links l
    where l.gym_id = any (coalesce(p_gym_ids, array[]::uuid[]))
      and l.is_active is true
    group by l.gym_id;
end;
$$;

-- platform_commission_by_gym correctly aggregates every payment, but returns
-- one row per gym. That result can itself exceed PostgREST's response cap. Roll
-- the complete set into one JSON value and include only the explicitly bounded
-- display rows alongside exact totals for the omitted gyms.
create or replace function public.platform_commission_summary(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with params as (
    select least(greatest(coalesce(p_limit, 50), 1), 100) as row_limit
  ),
  all_rows as materialized (
    select * from public.platform_commission_by_gym(p_from, p_to)
  ),
  shown as (
    select r.*
    from all_rows r
    order by r.commission_total desc, r.gym_name, r.gym_id
    limit (select row_limit from params)
  )
  select jsonb_build_object(
    'total', coalesce(sum(r.commission_total), 0),
    'fromPercentage', coalesce(sum(r.percentage_total), 0),
    'fromFlat', coalesce(sum(r.flat_total), 0),
    'unclassified', coalesce(sum(r.unclassified_total), 0),
    'payments', coalesce(sum(r.commission_payments), 0),
    'earningGyms', count(*) filter (where r.commission_total > 0),
    'held', coalesce(sum(r.held_total), 0),
    'heldPayments', coalesce(sum(r.held_payments), 0),
    'unrecordedPayments', coalesce(sum(r.unrecorded_payments), 0),
    'rows', coalesce((select jsonb_agg(to_jsonb(s) order by s.commission_total desc, s.gym_name, s.gym_id) from shown s), '[]'::jsonb),
    'hiddenGyms', greatest(count(*) - (select row_limit from params), 0),
    'hiddenCommission', greatest(
      coalesce(sum(r.commission_total), 0)
        - coalesce((select sum(s.commission_total) from shown s), 0),
      0
    )
  )
  from all_rows r;
$$;

revoke all on function public.gym_member_roster(uuid, text, text, integer, integer) from public, anon, service_role;
revoke all on function public.gym_reporting_summary(uuid) from public, anon, service_role;
revoke all on function public.platform_gym_summary() from public, anon, service_role;
revoke all on function public.platform_gym_member_counts(uuid[]) from public, anon, service_role;
revoke all on function public.platform_commission_summary(timestamptz, timestamptz, integer) from public, anon, service_role;
grant execute on function public.gym_member_roster(uuid, text, text, integer, integer) to authenticated;
grant execute on function public.gym_reporting_summary(uuid) to authenticated;
grant execute on function public.platform_gym_summary() to authenticated;
grant execute on function public.platform_gym_member_counts(uuid[]) to authenticated;
grant execute on function public.platform_commission_summary(timestamptz, timestamptz, integer) to authenticated;
