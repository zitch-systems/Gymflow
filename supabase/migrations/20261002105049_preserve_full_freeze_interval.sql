-- A freeze protects calendar time, not merely the number of paid days that
-- happened to remain when it began. The locked subscription window is the
-- aggregate entitlement authority for legacy and allocation-backed terms.
create or replace function public.resume_member_freeze(
  p_gym_id uuid,
  p_subscription_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare
  sub public.member_subscriptions%rowtype;
  before_state jsonb;
  after_state jsonb;
  resume_day date := (now() at time zone 'Africa/Lagos')::date;
  frozen_from date;
  eligible_from date;
  frozen_until date;
  credit_days integer := 0;
  new_end date;
  new_status text;
  service_caller boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
  if p_gym_id is null or p_subscription_id is null then
    raise exception 'Gym and subscription are required' using errcode = '22023';
  end if;
  if not service_caller and (
    auth.uid() is null
    or not private.privileged_session_verified()
    or not private.has_gym_role(
      p_gym_id,
      array['gym_owner','manager','front_desk','accountant']::public.user_role[]
    )
  ) then
    raise exception 'Verified gym administrator required' using errcode = '42501';
  end if;

  -- Read only the immutable member identity needed for the shared lock, then
  -- lock the same member-term key used by payments and refunds before FOR UPDATE.
  perform pg_advisory_xact_lock(hashtextextended(
    'member-term:' || p_gym_id::text || ':' || coalesce(
      (select member_id::text from public.member_subscriptions
       where id = p_subscription_id and gym_id = p_gym_id),
      p_subscription_id::text
    ), 0
  ));
  select * into sub from public.member_subscriptions
    where id = p_subscription_id and gym_id = p_gym_id for update;
  if not found then raise exception 'Subscription not found in this gym' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'member-term:' || p_gym_id::text || ':' || sub.member_id::text, 0
  ));

  if sub.status <> 'paused' then
    return jsonb_build_object(
      'created', false, 'member_id', sub.member_id, 'end_date', sub.end_date,
      'days_credited', 0, 'status', sub.status
    );
  end if;

  frozen_from := greatest(
    coalesce(sub.pause_start, '-infinity'::date),
    coalesce((sub.paused_at at time zone 'Africa/Lagos')::date, sub.pause_start, resume_day)
  );
  eligible_from := greatest(frozen_from, sub.start_date);
  frozen_until := least(resume_day, coalesce(sub.pause_end, resume_day));

  -- One remaining paid calendar day at the effective freeze start proves that
  -- the approved pause interrupted a live term. Restore the whole elapsed
  -- approved interval so a long freeze preserves those remaining days. A full
  -- refund moves end_date before this boundary and therefore restores zero.
  if sub.end_date >= eligible_from then
    credit_days := greatest(0, frozen_until - eligible_from);
  end if;

  if credit_days > 0 then
    update public.payment_coverage_allocations a set
      coverage_start = case when a.coverage_start > eligible_from
        then a.coverage_start + credit_days else a.coverage_start end,
      coverage_end = a.coverage_end + credit_days
    where a.subscription_id = sub.id
      and a.revoked_at is null
      and a.coverage_end >= eligible_from;
  end if;

  new_end := sub.end_date + credit_days;
  new_status := case when new_end < resume_day then 'expired' else 'active' end;
  before_state := jsonb_build_object(
    'status', sub.status, 'end_date', sub.end_date, 'paused_at', sub.paused_at,
    'pause_start', sub.pause_start, 'pause_end', sub.pause_end
  );
  perform set_config('gymflow.staff_receipt', 'freeze-resume:' || sub.id::text, true);
  perform set_config(
    'gymflow.staff_reason',
    'Previously purchased days restored after approved freeze',
    true
  );
  update public.member_subscriptions set
    status = new_status,
    end_date = new_end,
    paused_at = null,
    pause_reason = null,
    pause_start = null,
    pause_end = null,
    updated_at = now()
  where id = sub.id
  returning jsonb_build_object(
    'status', status, 'end_date', end_date, 'paused_at', paused_at,
    'pause_start', pause_start, 'pause_end', pause_end
  ) into after_state;

  insert into public.audit_logs(
    action, actor_id, gym_id, record_id, table_name, old_values, new_values
  ) values (
    'membership_freeze_resumed', auth.uid(), p_gym_id, sub.id,
    'member_subscriptions', before_state,
    after_state || jsonb_build_object(
      'days_credited', credit_days,
      'reason', 'Previously purchased days restored after approved freeze',
      'receipt', 'freeze-resume:' || sub.id::text
    )
  );

  return jsonb_build_object(
    'created', true, 'member_id', sub.member_id, 'end_date', new_end,
    'days_credited', credit_days, 'status', new_status
  );
end;
$$;

revoke all on function public.resume_member_freeze(uuid,uuid) from public, anon;
grant execute on function public.resume_member_freeze(uuid,uuid) to authenticated, service_role;
