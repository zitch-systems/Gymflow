-- The coverage table is created by the preceding financial-integrity migration
-- because its refund RPC uses the row type. This migration adds the fulfillment
-- transaction and protects the immutable purchase identity/original period.
create index platform_payment_coverage_gym_period_idx
  on public.platform_payment_coverage (gym_id, coverage_start, coverage_end);

create or replace function private.protect_platform_payment_coverage()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.payment_id is distinct from old.payment_id
    or new.gym_id is distinct from old.gym_id
    or new.original_start is distinct from old.original_start
    or new.original_end is distinct from old.original_end
    or new.amount_kobo is distinct from old.amount_kobo
    or new.plan is distinct from old.plan
    or new.billing_cycle is distinct from old.billing_cycle
    or new.subscription_code is distinct from old.subscription_code
    or new.superseded_subscription_code is distinct from old.superseded_subscription_code
    or new.created_at is distinct from old.created_at then
    raise exception 'Platform payment coverage is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_platform_payment_coverage() from public, anon, authenticated;

create trigger platform_payment_coverage_immutable
before update on public.platform_payment_coverage
for each row execute function private.protect_platform_payment_coverage();

create or replace function public.settle_platform_charge(
  p_reference text,
  p_gym_id uuid,
  p_amount_kobo bigint,
  p_currency text,
  p_plan text,
  p_billing_cycle text,
  p_paid_at timestamptz,
  p_customer_code text default null,
  p_subscription_code text default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  existing_payment public.platform_payments%rowtype;
  existing_coverage public.platform_payment_coverage%rowtype;
  gym public.gyms%rowtype;
  payment_id uuid;
  months integer;
  original_end timestamptz;
  allocation_start timestamptz;
  allocation_end timestamptz;
  old_subscription text;
  refund_event public.payment_refund_events%rowtype;
  refund_result jsonb;
  fully_refunded boolean := false;
  actual_period_end timestamptz;
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  p_reference := nullif(trim(p_reference), '');
  p_currency := upper(trim(coalesce(p_currency, '')));
  p_plan := lower(trim(coalesce(p_plan, '')));
  p_billing_cycle := lower(trim(coalesce(p_billing_cycle, '')));
  p_customer_code := nullif(trim(p_customer_code), '');
  p_subscription_code := nullif(trim(p_subscription_code), '');
  if p_reference is null or length(p_reference) > 200 or p_gym_id is null
    or p_amount_kobo is null or p_amount_kobo <= 0 or p_currency <> 'NGN'
    or p_paid_at is null or p_plan not in ('starter', 'growth')
    or p_billing_cycle not in ('monthly', 'quarterly', 'annually') then
    raise exception 'Invalid platform charge' using errcode = '22023';
  end if;

  months := case p_billing_cycle when 'monthly' then 1 when 'quarterly' then 3 else 12 end;
  -- This duplicates the server catalogue deliberately: a compromised caller
  -- cannot turn arbitrary metadata/amount into paid platform access. The final
  -- value is the retired Scale monthly price, which maps to Growth.
  if not (
    (p_plan = 'starter' and p_billing_cycle = 'monthly' and p_amount_kobo = 1399900)
    or (p_plan = 'starter' and p_billing_cycle = 'quarterly' and p_amount_kobo = 3799900)
    or (p_plan = 'starter' and p_billing_cycle = 'annually' and p_amount_kobo = 12199900)
    or (p_plan = 'growth' and p_billing_cycle = 'monthly' and p_amount_kobo in (2399900, 11999900))
    or (p_plan = 'growth' and p_billing_cycle = 'quarterly' and p_amount_kobo = 6499900)
    or (p_plan = 'growth' and p_billing_cycle = 'annually' and p_amount_kobo = 20899900)
  ) then
    raise exception 'Platform charge amount does not match plan' using errcode = '22023';
  end if;

  -- Same order as apply_payment_refund, including when a pending refund is
  -- applied below in this transaction.
  perform pg_advisory_xact_lock(hashtextextended('member-charge:' || p_reference, 0));
  perform pg_advisory_xact_lock(hashtextextended('platform-charge:' || p_reference, 0));
  select * into existing_payment from public.platform_payments
    where paystack_reference = p_reference for update;
  if found then
    select c.* into existing_coverage from public.platform_payment_coverage c
      where c.payment_id = existing_payment.id;
    if not found then
      raise exception 'Existing platform payment has no coverage allocation' using errcode = '23514';
    end if;
    if existing_payment.gym_id is distinct from p_gym_id
      or existing_coverage.amount_kobo is distinct from p_amount_kobo
      or existing_coverage.plan is distinct from p_plan
      or existing_coverage.billing_cycle is distinct from p_billing_cycle then
      raise exception 'Platform charge reference was reused for different details' using errcode = '22023';
    end if;
    for refund_event in
      select * from public.payment_refund_events
      where reference = p_reference and applied_at is null order by received_at, event_key
    loop
      select public.apply_payment_refund(
        refund_event.event_key, refund_event.reference, refund_event.event_name,
        refund_event.amount_kobo, refund_event.currency, refund_event.is_full_dispute
      ) into refund_result;
      fully_refunded := fully_refunded or coalesce((refund_result ->> 'full')::boolean, false);
    end loop;
    select subscription_current_period_end into actual_period_end from public.gyms where id = p_gym_id;
    return jsonb_build_object(
      'created', false,
      'payment_id', existing_payment.id,
      'coverage_start', existing_coverage.coverage_start,
      'coverage_end', existing_coverage.coverage_end,
      'old_subscription_code', existing_coverage.superseded_subscription_code,
      'new_subscription_code', existing_coverage.subscription_code,
      'superseded_retired_at', existing_coverage.superseded_retired_at,
      'fully_refunded', fully_refunded or existing_payment.payment_status = 'refunded',
      'period_end', actual_period_end
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended('platform-term:' || p_gym_id::text, 0));
  select * into gym from public.gyms where id = p_gym_id for update;
  if not found then raise exception 'Unknown platform charge gym' using errcode = '23503'; end if;

  old_subscription := nullif(gym.paystack_subscription_code, '');
  if old_subscription is not distinct from p_subscription_code then old_subscription := null; end if;
  original_end := p_paid_at + make_interval(months => months);
  -- Every distinct successful charge buys one full period. A late older event
  -- appends after already-paid access rather than shortening or overlapping it.
  allocation_start := greatest(p_paid_at, coalesce(gym.subscription_current_period_end, p_paid_at));
  allocation_end := allocation_start + make_interval(months => months);

  insert into public.platform_payments(
    gym_id, amount, currency, payment_status, paystack_reference, plan,
    billing_period_start, billing_period_end
  ) values (
    p_gym_id, p_amount_kobo::numeric / 100, p_currency, 'successful', p_reference, p_plan,
    allocation_start::date, allocation_end::date
  ) returning id into payment_id;

  insert into public.platform_payment_coverage(
    payment_id, gym_id, coverage_start, coverage_end, original_start, original_end,
    amount_kobo, plan, billing_cycle, subscription_code, superseded_subscription_code
  ) values (
    payment_id, p_gym_id, allocation_start, allocation_end, p_paid_at, original_end,
    p_amount_kobo, p_plan, p_billing_cycle, p_subscription_code, old_subscription
  );

  update public.gyms set
    subscription_status = 'active', subscription_plan = p_plan,
    subscription_billing_cycle = p_billing_cycle,
    subscription_current_period_end = allocation_end,
    paystack_customer_code = coalesce(p_customer_code, paystack_customer_code),
    paystack_subscription_code = coalesce(p_subscription_code, paystack_subscription_code),
    updated_at = now()
  where id = p_gym_id;

  insert into public.audit_logs(action, gym_id, record_id, table_name, old_values, new_values)
  values (
    'platform_charge_committed', p_gym_id, payment_id, 'platform_payments',
    jsonb_build_object(
      'subscription_plan', gym.subscription_plan,
      'subscription_billing_cycle', gym.subscription_billing_cycle,
      'subscription_current_period_end', gym.subscription_current_period_end,
      'paystack_subscription_code', gym.paystack_subscription_code
    ),
    jsonb_build_object(
      'reference', p_reference, 'amount_kobo', p_amount_kobo, 'plan', p_plan,
      'billing_cycle', p_billing_cycle, 'coverage_start', allocation_start,
      'coverage_end', allocation_end, 'subscription_code', p_subscription_code
    )
  );

  -- Refund evidence may arrive before charge.success. Apply it before commit so
  -- a known-refunded charge can never transiently grant service or send a paid
  -- receipt. Any failure rolls back the ledger and entitlement with it.
  for refund_event in
    select * from public.payment_refund_events
    where reference = p_reference and applied_at is null order by received_at, event_key
  loop
    select public.apply_payment_refund(
      refund_event.event_key, refund_event.reference, refund_event.event_name,
      refund_event.amount_kobo, refund_event.currency, refund_event.is_full_dispute
    ) into refund_result;
    fully_refunded := fully_refunded or coalesce((refund_result ->> 'full')::boolean, false);
  end loop;
  select subscription_current_period_end into actual_period_end from public.gyms where id = p_gym_id;

  return jsonb_build_object(
    'created', true,
    'payment_id', payment_id,
    'coverage_start', allocation_start,
    'coverage_end', allocation_end,
    'old_subscription_code', old_subscription,
    'new_subscription_code', p_subscription_code,
    'superseded_retired_at', null,
    'fully_refunded', fully_refunded,
    'period_end', actual_period_end
  );
end;
$$;

revoke all on function public.settle_platform_charge(text,uuid,bigint,text,text,text,timestamptz,text,text)
  from public, anon, authenticated;
grant execute on function public.settle_platform_charge(text,uuid,bigint,text,text,text,timestamptz,text,text)
  to service_role;
