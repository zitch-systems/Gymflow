-- Server-owned checkout snapshots and atomic money/access fulfillment.
-- Only service_role may reserve or settle a Paystack charge. Browser metadata
-- is not an authorization source; payment and the granted term share one commit.
-- Checkout offers Paystack's provider channels; the ledger must accept the
-- verified channel rather than strand a paid USSD/bank member at a CHECK.
alter table public.payments drop constraint if exists payments_payment_method_check;
alter table public.payments add constraint payments_payment_method_check check (
  payment_method in ('card', 'bank_transfer', 'cash', 'crypto', 'auto_debit',
    'bank', 'apple_pay', 'ussd', 'qr', 'mobile_money', 'eft', 'capitec_pay', 'payattitude', 'paystack')
);
create table public.member_payment_checkouts (
  reference text primary key,
  gym_id uuid not null references public.gyms(id) on delete restrict,
  member_id uuid not null references public.profiles(id) on delete restrict,
  plan_id uuid not null references public.membership_plans(id) on delete restrict,
  amount_kobo bigint not null check (amount_kobo > 0),
  currency text not null default 'NGN' check (currency = 'NGN'),
  duration_days integer,
  duration_months integer,
  trainer_addon boolean not null default false,
  provider_plan_code text,
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  check (coalesce((duration_days between 1 and 366) or
         (coalesce(duration_days, 0) = 0 and duration_months between 1 and 36), false))
);
alter table public.member_payment_checkouts enable row level security;
revoke all on public.member_payment_checkouts from public, anon, authenticated;
grant all on public.member_payment_checkouts to service_role;
create index member_payment_checkouts_member_idx on public.member_payment_checkouts (gym_id, member_id);

create or replace function public.settle_member_charge(
  p_reference text, p_gym_id uuid, p_member_id uuid, p_plan_id uuid,
  p_amount_kobo bigint, p_currency text, p_days integer, p_months integer,
  p_trainer_addon boolean, p_method text, p_commission jsonb,
  p_subscription_id uuid default null
)
returns jsonb language plpgsql security invoker
set search_path to 'public', 'pg_temp'
as $$
declare
  checkout public.member_payment_checkouts%rowtype;
  previous public.payments%rowtype;
  plan public.membership_plans%rowtype;
  sub public.member_subscriptions%rowtype;
  payment_id uuid;
  new_end date;
  today date := (now() at time zone 'Africa/Lagos')::date;
  term_days int := p_days;
  term_months int := p_months;
  trainer boolean := p_trainer_addon;
  expected_amount bigint;
begin
  if p_reference is null or length(p_reference) not between 1 and 200
     or p_currency is distinct from 'NGN' or p_amount_kobo is null or p_amount_kobo <= 0 then
    raise exception 'Invalid settled charge' using errcode = '22023';
  end if;
  -- Same reference waits for the first transaction to commit or roll back.
  perform pg_advisory_xact_lock(hashtextextended('member-charge:' || p_reference, 0));
  select * into previous from public.payments where paystack_reference = p_reference;
  if found then
    if previous.gym_id is distinct from p_gym_id or previous.member_id is distinct from p_member_id
       or previous.plan_id is distinct from p_plan_id or previous.amount * 100 <> p_amount_kobo
       or previous.currency is distinct from p_currency then
      raise exception 'Payment reference belongs to another charge' using errcode = '22023';
    end if;
    if previous.payment_status is distinct from 'successful' or previous.status is distinct from 'success' then
      raise exception 'Payment is not a successful settled charge' using errcode = '22023';
    end if;
    if previous.metadata ->> 'fulfillment_version' is distinct from '1' then
      raise exception 'Legacy payment requires entitlement reconciliation' using errcode = '22023';
    end if;
    return jsonb_build_object('created', false, 'payment_id', previous.id,
      'end_date', previous.metadata ->> 'fulfilled_end_date');
  end if;
  if not exists (select 1 from public.gym_member_links
                 where gym_id = p_gym_id and user_id = p_member_id and is_active is true) then
    raise exception 'Member is not active in this gym' using errcode = '42501';
  end if;
  select * into plan from public.membership_plans where id = p_plan_id and gym_id = p_gym_id;
  if not found then raise exception 'Plan does not belong to gym' using errcode = '22023'; end if;
  select * into checkout from public.member_payment_checkouts where reference = p_reference;
  if found then
    if checkout.gym_id is distinct from p_gym_id or checkout.member_id is distinct from p_member_id
       or checkout.plan_id is distinct from p_plan_id or checkout.amount_kobo <> p_amount_kobo
       or checkout.currency is distinct from p_currency then
      raise exception 'Charge does not match reserved checkout' using errcode = '22023';
    end if;
    term_days := checkout.duration_days;
    term_months := checkout.duration_months;
    trainer := checkout.trainer_addon;
  elsif p_subscription_id is null then
    -- Legacy one-off checkout: no server snapshot exists. Do not accept a
    -- user-authored expected_amount or duration as proof of what was sold.
    trainer := coalesce(trainer, false) and coalesce(plan.trainer_addon_enabled, false)
               and coalesce(plan.trainer_addon_price, 0) > 0;
    expected_amount := round((plan.price + case when trainer then plan.trainer_addon_price else 0 end) * 100);
    if p_amount_kobo <> expected_amount then
      raise exception 'Legacy checkout amount requires reconciliation' using errcode = '22023';
    end if;
    term_days := plan.duration_days;
    term_months := plan.duration_months;
  end if;
  if not coalesce((term_days between 1 and 366) or
          (coalesce(term_days, 0) = 0 and term_months between 1 and 36), false) then
    raise exception 'Invalid paid period' using errcode = '22023';
  end if;
  -- Distinct payments for one member serialize too, including the first row.
  perform pg_advisory_xact_lock(hashtextextended('member-term:' || p_gym_id::text || ':' || p_member_id::text, 0));
  if p_subscription_id is not null then
    select * into sub from public.member_subscriptions
      where id = p_subscription_id and gym_id = p_gym_id and member_id = p_member_id for update;
    if not found then raise exception 'Subscription does not belong to member' using errcode = '22023'; end if;
  end if;
  -- Prefer the live row if a superseded recurring mandate points elsewhere.
  if sub.id is null or sub.status not in ('active', 'past_due', 'paused', 'pause_requested') then
    select * into sub from public.member_subscriptions
      where gym_id = p_gym_id and member_id = p_member_id
        and status in ('active', 'past_due', 'paused', 'pause_requested')
      order by end_date desc limit 1 for update;
  end if;
  if sub.id is not null then
    update public.member_subscriptions
       set end_date = private.period_end(greatest(end_date, today), term_days, term_months),
           status = case when status in ('paused', 'pause_requested') then status else 'active' end,
           plan_id = p_plan_id, trainer_addon = coalesce(trainer, trainer_addon), updated_at = now()
     where id = sub.id returning end_date into new_end;
  else
    new_end := private.period_end(today, term_days, term_months);
    insert into public.member_subscriptions (gym_id, member_id, plan_id, start_date, end_date, status, trainer_addon)
      values (p_gym_id, p_member_id, p_plan_id, today, new_end, 'active', coalesce(trainer, false))
      returning id into sub.id;
  end if;
  insert into public.payments (
    gym_id, member_id, plan_id, amount, currency, status, payment_status,
    payment_method, paystack_reference, payment_date, metadata,
    platform_settlement, platform_commission_basis, platform_commission_pct, platform_commission_amount
  ) values (
    p_gym_id, p_member_id, p_plan_id, p_amount_kobo::numeric / 100, 'NGN', 'success', 'successful',
    p_method, p_reference, now(),
    jsonb_build_object('fulfillment_version', 1, 'subscription_id', sub.id,
      'fulfilled_end_date', new_end, 'duration_days', term_days, 'duration_months', term_months),
    p_commission ->> 'platform_settlement', p_commission ->> 'platform_commission_basis',
    (p_commission ->> 'platform_commission_pct')::numeric,
    (p_commission ->> 'platform_commission_amount')::numeric
  ) returning id into payment_id;
  update public.member_payment_checkouts set fulfilled_at = now() where reference = p_reference;
  return jsonb_build_object('created', true, 'payment_id', payment_id, 'end_date', new_end);
end;
$$;
revoke all on function public.settle_member_charge(text, uuid, uuid, uuid, bigint, text, int, int, boolean, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.settle_member_charge(text, uuid, uuid, uuid, bigint, text, int, int, boolean, text, jsonb, uuid)
  to service_role;

-- A renewal after WAT midnight must start from the gym's calendar day.
create or replace function public.extend_member_sub(
  p_id uuid, p_days int, p_months int, p_plan_id uuid default null, p_trainer_addon boolean default null
)
returns date language sql security invoker set search_path to 'public', 'pg_temp'
as $$
  update public.member_subscriptions
     set end_date = private.period_end(greatest(end_date, (now() at time zone 'Africa/Lagos')::date), p_days, p_months),
         status = case when status in ('paused', 'pause_requested') then status else 'active' end,
         plan_id = coalesce(p_plan_id, plan_id), trainer_addon = coalesce(p_trainer_addon, trainer_addon), updated_at = now()
   where id = p_id returning end_date;
$$;
revoke execute on function public.extend_member_sub(uuid, int, int, uuid, boolean) from public, anon;
grant execute on function public.extend_member_sub(uuid, int, int, uuid, boolean) to authenticated, service_role;
