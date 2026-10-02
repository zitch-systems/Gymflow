-- Exact inclusive paid dates, immutable allocations and idempotent desk receipts.
-- Previously purchased end dates are not rewritten. The explicit new-sale rule
-- is [start, calendar anniversary), with month-end clamped to the target month.
create or replace function private.period_end(p_from date, p_days int, p_months int)
returns date language sql immutable set search_path = public, pg_temp as $$
  select case when coalesce(p_days, 0) > 0 then p_from + p_days
    else (p_from + make_interval(months => greatest(1, coalesce(p_months, 1))))::date end;
$$;
create or replace function private.coverage_end(p_start date, p_days int, p_months int)
returns date language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if not coalesce((p_days between 1 and 366) or
      (coalesce(p_days, 0) = 0 and p_months between 1 and 36), false) then
    raise exception 'Invalid membership duration' using errcode = '22023';
  end if;
  return private.period_end(p_start, p_days, p_months) - 1;
end;
$$;
revoke all on function private.coverage_end(date,int,int) from public, anon;
grant execute on function private.coverage_end(date,int,int) to authenticated, service_role;

create table public.payment_coverage_allocations (
  payment_id uuid primary key references public.payments(id) on delete restrict,
  gym_id uuid not null references public.gyms(id) on delete restrict,
  member_id uuid not null references public.profiles(id) on delete restrict,
  subscription_id uuid not null references public.member_subscriptions(id) on delete restrict,
  coverage_start date not null,
  coverage_end date not null check (coverage_end >= coverage_start),
  amount_kobo bigint not null check (amount_kobo > 0),
  original_start date not null,
  original_end date not null,
  revoked_at timestamptz,
  revoked_days int not null default 0 check (revoked_days >= 0),
  created_at timestamptz not null default now()
);
create or replace function private.protect_member_payment_coverage()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if TG_OP='INSERT' then
  new.original_start := coalesce(new.original_start,new.coverage_start);
  new.original_end := coalesce(new.original_end,new.coverage_end);
 elsif new.payment_id is distinct from old.payment_id or new.gym_id is distinct from old.gym_id
   or new.member_id is distinct from old.member_id or new.subscription_id is distinct from old.subscription_id
   or new.amount_kobo is distinct from old.amount_kobo or new.original_start is distinct from old.original_start
   or new.original_end is distinct from old.original_end or new.created_at is distinct from old.created_at then
  raise exception 'Original purchased coverage is immutable' using errcode='42501';
 end if;
 return new;
end;
$$;
revoke all on function private.protect_member_payment_coverage() from public,anon,authenticated;
create trigger protect_member_payment_coverage before insert or update on public.payment_coverage_allocations
 for each row execute function private.protect_member_payment_coverage();
create index coverage_allocations_member_idx on public.payment_coverage_allocations(gym_id,member_id,coverage_start);
alter table public.payment_coverage_allocations enable row level security;
revoke all on public.payment_coverage_allocations from public,anon,authenticated;
grant select on public.payment_coverage_allocations to authenticated;
grant all on public.payment_coverage_allocations to service_role;
create policy coverage_allocations_read on public.payment_coverage_allocations for select to authenticated
  using (member_id = auth.uid() or private.has_gym_role(gym_id,array['gym_owner','manager','front_desk','accountant']::public.user_role[]));

create table public.staff_financial_operations (
  operation_id uuid primary key,
  gym_id uuid not null references public.gyms(id) on delete restrict,
  member_id uuid not null references public.profiles(id) on delete restrict,
  actor_id uuid not null,
  receipt_number text not null check(length(receipt_number) between 1 and 120),
  amount_kobo bigint not null check(amount_kobo > 0),
  method text not null,
  plan_id uuid references public.membership_plans(id) on delete restrict,
  extend_membership boolean not null,
  reason text not null check(length(reason) between 3 and 500),
  payment_id uuid not null references public.payments(id) on delete restrict,
  old_values jsonb,
  new_values jsonb not null,
  created_at timestamptz not null default now(),
  unique(gym_id,receipt_number)
);
alter table public.staff_financial_operations enable row level security;
revoke all on public.staff_financial_operations from public,anon,authenticated,service_role;
grant select on public.staff_financial_operations to authenticated,service_role;
create policy staff_financial_operations_read on public.staff_financial_operations for select to authenticated
  using (private.has_gym_role(gym_id,array['gym_owner','manager','front_desk','accountant']::public.user_role[]));

-- Unknown references are retained so refund-before-charge never disappears.
create table public.payment_refund_events (
  event_key text primary key,
  reference text not null,
  event_name text not null,
  amount_kobo bigint check(amount_kobo > 0),
  currency text not null check(currency='NGN'),
  is_full_dispute boolean not null default false,
  received_at timestamptz not null default now(),
  applied_at timestamptz,
  policy text not null default 'partial-retain_full-revoke-unused',
  result jsonb
);
create index payment_refund_events_reference_idx on public.payment_refund_events(reference);
alter table public.payment_refund_events enable row level security;
revoke all on public.payment_refund_events from public,anon,authenticated;
grant all on public.payment_refund_events to service_role;

create or replace function public.record_staff_payment(
  p_operation_id uuid,p_gym_id uuid,p_member_id uuid,p_receipt text,p_amount_kobo bigint,
  p_method text,p_plan_id uuid,p_extend boolean,p_reason text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  previous public.staff_financial_operations%rowtype;
  plan public.membership_plans%rowtype;
  sub public.member_subscriptions%rowtype;
  old_sub jsonb;
  new_sub jsonb;
  payment_id uuid;
  start_day date;
  end_day date;
  today date := (now() at time zone 'Africa/Lagos')::date;
  amount bigint := p_amount_kobo;
  receipt text := lower(trim(p_receipt));
begin
  if auth.uid() is null or not private.has_gym_role(p_gym_id,
    array['gym_owner','manager','front_desk','accountant']::public.user_role[]) then
    raise exception 'Verified gym staff required' using errcode='42501';
  end if;
  if p_operation_id is null or p_member_id is null or p_extend is null
    or p_method is null or p_method not in ('cash','card','bank_transfer','crypto')
    or receipt is null or length(receipt) not between 1 and 120
    or p_reason is null or length(trim(p_reason)) not between 3 and 500 then
    raise exception 'A receipt reference and payment reason are required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('staff-operation:'||p_operation_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('staff-receipt:'||p_gym_id::text||':'||receipt,0));
  select * into previous from public.staff_financial_operations
    where operation_id=p_operation_id or (gym_id=p_gym_id and receipt_number=receipt) for update;
  if found then
    if previous.gym_id is distinct from p_gym_id or previous.member_id is distinct from p_member_id
      or previous.plan_id is distinct from p_plan_id or previous.method is distinct from p_method
      or previous.extend_membership is distinct from p_extend
      or previous.receipt_number is distinct from receipt
      or (amount is not null and previous.amount_kobo <> amount) then
      raise exception 'This receipt was already used for a different payment' using errcode='22023';
    end if;
    return jsonb_build_object('created',false,'payment_id',previous.payment_id,
      'end_date',previous.new_values->>'end_date','amount_kobo',previous.amount_kobo);
  end if;
  if not exists(select 1 from public.gym_member_links where gym_id=p_gym_id
    and user_id=p_member_id and (not p_extend or is_active is true)) then
    raise exception 'Member is not eligible in this gym' using errcode='42501';
  end if;
  if p_plan_id is not null then
    select * into plan from public.membership_plans where id=p_plan_id and gym_id=p_gym_id and is_active is true;
    if not found then raise exception 'Plan not available in this gym' using errcode='22023'; end if;
  end if;
  perform set_config('gymflow.staff_receipt',receipt,true);
  perform set_config('gymflow.staff_reason',trim(p_reason),true);
  if p_extend then
    if plan.id is null then raise exception 'Choose a membership plan' using errcode='22023'; end if;
    amount := coalesce(amount,round(plan.price*100)::bigint);
    if amount <> round(plan.price*100)::bigint then
      raise exception 'Payment must match the chosen plan price; record partial payments without extending' using errcode='22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('member-term:'||p_gym_id::text||':'||p_member_id::text,0));
    select * into sub from public.member_subscriptions where gym_id=p_gym_id and member_id=p_member_id
      and status in ('active','past_due','paused','pause_requested') order by end_date desc limit 1 for update;
    old_sub := case when sub.id is not null then to_jsonb(sub) else null end;
    start_day := greatest(coalesce(sub.end_date,today-1)+1,today);
    end_day := private.coverage_end(start_day,plan.duration_days,plan.duration_months);
    if sub.id is not null then
      update public.member_subscriptions set end_date=end_day,plan_id=plan.id,
        status=case when status in ('paused','pause_requested') then status else 'active' end,
        updated_at=now() where id=sub.id returning to_jsonb(member_subscriptions.*) into new_sub;
    else
      insert into public.member_subscriptions(gym_id,member_id,plan_id,start_date,end_date,status)
        values(p_gym_id,p_member_id,plan.id,today,end_day,'active') returning id,to_jsonb(member_subscriptions.*) into sub.id,new_sub;
    end if;
  end if;
  if amount is null or amount <= 0 then raise exception 'Invalid payment amount' using errcode='22023'; end if;
  insert into public.payments(gym_id,member_id,plan_id,amount,currency,status,payment_status,
    payment_method,paystack_reference,payment_date,platform_settlement,metadata)
  values(p_gym_id,p_member_id,p_plan_id,amount::numeric/100,'NGN','success','successful',p_method,
    'MANUAL-'||p_operation_id::text,now(),'offline',jsonb_build_object('operation_id',p_operation_id,
    'receipt',receipt,'actor_id',auth.uid(),'reason',trim(p_reason),'subscription_id',sub.id,
    'fulfilled_end_date',end_day,'coverage_start',start_day,'fulfillment_version',1)) returning id into payment_id;
  if p_extend then
    insert into public.payment_coverage_allocations(payment_id,gym_id,member_id,subscription_id,coverage_start,coverage_end,amount_kobo)
      values(payment_id,p_gym_id,p_member_id,sub.id,start_day,end_day,amount);
  end if;
  insert into public.staff_financial_operations(operation_id,gym_id,member_id,actor_id,receipt_number,
    amount_kobo,method,plan_id,extend_membership,reason,payment_id,old_values,new_values)
  values(p_operation_id,p_gym_id,p_member_id,auth.uid(),receipt,amount,p_method,p_plan_id,p_extend,trim(p_reason),
    payment_id,old_sub,coalesce(new_sub,'{}'::jsonb));
  insert into public.audit_logs(action,actor_id,gym_id,record_id,table_name,old_values,new_values)
    values('staff_payment_committed',auth.uid(),p_gym_id,payment_id,'payments',old_sub,
      jsonb_build_object('operation_id',p_operation_id,'receipt',receipt,'reason',trim(p_reason),
        'amount_kobo',amount,'membership',new_sub));
  return jsonb_build_object('created',true,'payment_id',payment_id,'end_date',end_day,'amount_kobo',amount);
end;
$$;
revoke all on function public.record_staff_payment(uuid,uuid,uuid,text,bigint,text,uuid,boolean,text) from public,anon,service_role;
grant execute on function public.record_staff_payment(uuid,uuid,uuid,text,bigint,text,uuid,boolean,text) to authenticated;

-- Staff cannot bypass receipt identity and atomic coverage through raw REST.
revoke insert on public.payments from authenticated;
do $$
declare cols text;
begin
 select string_agg(quote_ident(attname),',') into cols from pg_attribute
 where attrelid='public.payments'::regclass and attnum>0 and not attisdropped;
 execute 'revoke insert ('||cols||') on public.payments from authenticated';
end;
$$;

create or replace function public.extend_member_sub(
  p_id uuid,p_days int,p_months int,p_plan_id uuid default null,p_trainer_addon boolean default null
) returns date language sql security invoker set search_path=public,pg_temp as $$
  update public.member_subscriptions set
    end_date=private.coverage_end(greatest(end_date+1,(now() at time zone 'Africa/Lagos')::date),p_days,p_months),
    status=case when status in ('paused','pause_requested') then status else 'active' end,
    plan_id=coalesce(p_plan_id,plan_id),trainer_addon=coalesce(p_trainer_addon,trainer_addon),updated_at=now()
  where id=p_id returning end_date;
$$;
revoke execute on function public.extend_member_sub(uuid,int,int,uuid,boolean) from public,anon;
grant execute on function public.extend_member_sub(uuid,int,int,uuid,boolean) to authenticated,service_role;

-- Every privileged membership change has a durable, transaction-bound audit.
-- Only the atomic receipt RPC can grant paid dates through a staff session.
create or replace function private.audit_staff_membership_change()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare before_state jsonb; after_state jsonb;
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'role','') <> 'authenticated' then return new; end if;
 before_state := case when TG_OP='UPDATE' then jsonb_build_object('start_date',old.start_date,'end_date',old.end_date,
   'status',old.status,'plan_id',old.plan_id,'trainer_addon',old.trainer_addon) else null end;
 after_state := jsonb_build_object('start_date',new.start_date,'end_date',new.end_date,'status',new.status,
   'plan_id',new.plan_id,'trainer_addon',new.trainer_addon);
 if (TG_OP='INSERT' or old.end_date is distinct from new.end_date or old.start_date is distinct from new.start_date)
   and nullif(current_setting('gymflow.staff_receipt',true),'') is null then
   raise exception 'Record the payment with a receipt to grant membership dates' using errcode='42501';
 end if;
 if before_state is distinct from after_state then
  insert into public.audit_logs(action,actor_id,gym_id,record_id,table_name,old_values,new_values)
  values('staff_membership_change',auth.uid(),new.gym_id,new.id,'member_subscriptions',before_state,
    after_state||jsonb_build_object('reason',coalesce(nullif(current_setting('gymflow.staff_reason',true),''),'Staff status change'),
      'receipt',nullif(current_setting('gymflow.staff_receipt',true),'')));
 end if;
 return new;
end;
$$;
revoke all on function private.audit_staff_membership_change() from public,anon,authenticated;
create trigger audit_staff_membership_change before insert or update on public.member_subscriptions
 for each row execute function private.audit_staff_membership_change();

alter table public.payments add column refunded_amount numeric not null default 0
  check (refunded_amount >= 0 and refunded_amount <= amount);
alter table public.platform_payments add column refunded_amount numeric not null default 0
  check (refunded_amount >= 0 and refunded_amount <= amount);
-- Existing already-refunded ledger rows retain their original gross amount.
update public.payments set refunded_amount=amount where payment_status='refunded';
update public.platform_payments set refunded_amount=amount where payment_status='refunded';
revoke update(refunded_amount) on public.payments,public.platform_payments from authenticated;

create table public.platform_payment_coverage (
  payment_id uuid primary key references public.platform_payments(id) on delete restrict,
  gym_id uuid not null references public.gyms(id) on delete restrict,
  coverage_start timestamptz not null,
  coverage_end timestamptz not null check (coverage_end > coverage_start),
  original_start timestamptz not null,
  original_end timestamptz not null check (original_end > original_start),
  amount_kobo bigint not null check (amount_kobo > 0),
  plan text not null check (plan in ('starter', 'growth')),
  billing_cycle text not null check (billing_cycle in ('monthly', 'quarterly', 'annually')),
  subscription_code text,
  superseded_subscription_code text,
  superseded_retired_at timestamptz,
  revoked_at timestamptz,
  revoked_seconds bigint not null default 0 check (revoked_seconds>=0),
  revoked_days integer not null default 0 check (revoked_days >= 0),
  created_at timestamptz not null default now()
);

alter table public.platform_payment_coverage enable row level security;
revoke all on public.platform_payment_coverage from public,anon,authenticated;
grant all on public.platform_payment_coverage to service_role;

-- This service-only RPC is called only after verified provider authentication.
-- Pending refund evidence is durable even when it precedes charge.success.
create or replace function public.apply_payment_refund(
 p_event_key text,p_reference text,p_event_name text,p_amount_kobo bigint,p_currency text,p_full_dispute boolean
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 ev public.payment_refund_events%rowtype;
 pay public.payments%rowtype;
 plat public.platform_payments%rowtype;
 allocation public.payment_coverage_allocations%rowtype;
 platform_allocation public.platform_payment_coverage%rowtype;
 sub public.member_subscriptions%rowtype;
 total_kobo bigint;
 full_refund boolean;
 removed_days int := 0;
 removed_seconds bigint := 0;
 today date := (now() at time zone 'Africa/Lagos')::date;
 unused_from date;
 decision jsonb;
begin
 if p_event_key is null or length(p_event_key) not between 1 and 240
   or p_reference is null or length(p_reference) not between 1 and 200
   or p_event_name not in ('charge.refund','refund.processed','charge.dispute.resolve')
   or p_currency is distinct from 'NGN' or p_full_dispute is null
   or (p_amount_kobo is null and not p_full_dispute) or coalesce(p_amount_kobo,1)<=0 then
  raise exception 'Invalid verified refund evidence' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('member-charge:'||p_reference,0));
 perform pg_advisory_xact_lock(hashtextextended('platform-charge:'||p_reference,0));
 insert into public.payment_refund_events(event_key,reference,event_name,amount_kobo,currency,is_full_dispute)
 values(p_event_key,p_reference,p_event_name,p_amount_kobo,p_currency,p_full_dispute)
 on conflict(event_key) do nothing;
 select * into ev from public.payment_refund_events where event_key=p_event_key for update;
 if ev.reference is distinct from p_reference or ev.amount_kobo is distinct from p_amount_kobo
   or ev.currency is distinct from p_currency or ev.is_full_dispute is distinct from p_full_dispute then
  raise exception 'Refund identity conflicts with previous evidence' using errcode='22023';
 end if;
 if ev.applied_at is not null then return ev.result||jsonb_build_object('replayed',true); end if;
 select * into pay from public.payments where paystack_reference=p_reference for update;
 if pay.id is not null then
  if pay.currency is distinct from p_currency or coalesce(p_amount_kobo,round(pay.amount*100)::bigint)>round(pay.amount*100)::bigint then
   raise exception 'Refund does not match original payment' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('member-term:'||pay.gym_id::text||':'||pay.member_id::text,0));
  select case when bool_or(is_full_dispute) then round(pay.amount*100)::bigint
    else least(round(pay.amount*100)::bigint,coalesce(sum(amount_kobo),0)) end into total_kobo
    from public.payment_refund_events where reference=p_reference;
  full_refund := total_kobo>=round(pay.amount*100)::bigint;
  update public.payments set refunded_amount=total_kobo::numeric/100,
    payment_status=case when full_refund then 'refunded' else payment_status end,
    status=case when full_refund then 'refunded' else status end where id=pay.id;
  select * into allocation from public.payment_coverage_allocations where payment_id=pay.id for update;
  if full_refund and allocation.payment_id is not null and allocation.revoked_at is null then
   select * into sub from public.member_subscriptions where id=allocation.subscription_id for update;
   unused_from := today;
   if sub.status='paused' then
    unused_from := least(today,coalesce(sub.pause_start,(sub.paused_at at time zone 'Africa/Lagos')::date,today));
   end if;
   removed_days := greatest(0,allocation.coverage_end-greatest(allocation.coverage_start,unused_from)+1);
   if removed_days>0 then
    -- Later valid purchases keep their paid date count and move into the gap.
    update public.payment_coverage_allocations set coverage_start=coverage_start-removed_days,
      coverage_end=coverage_end-removed_days where subscription_id=allocation.subscription_id
      and payment_id<>pay.id and revoked_at is null and coverage_start>allocation.coverage_end;
    update public.member_subscriptions set end_date=greatest(start_date-1,end_date-removed_days),updated_at=now()
      where id=allocation.subscription_id;
   end if;
   update public.payment_coverage_allocations set revoked_at=now(),revoked_days=removed_days where payment_id=pay.id;
  end if;
  decision := jsonb_build_object('pending',false,'table','payments','payment_id',pay.id,
    'full',full_refund,'refunded_amount_kobo',total_kobo,'revoked_days',removed_days,
    'requires_review',full_refund and allocation.payment_id is null,
    'policy','partial-retain_full-revoke-unused');
  insert into public.audit_logs(action,gym_id,record_id,table_name,old_values,new_values)
    values('provider_refund_applied',pay.gym_id,pay.id,'payments',
      jsonb_build_object('refunded_amount',pay.refunded_amount,'payment_status',pay.payment_status),decision);
 else
  select * into plat from public.platform_payments where paystack_reference=p_reference for update;
  if plat.id is null then return jsonb_build_object('pending',true,'requires_review',false,'reference',p_reference); end if;
  if plat.currency is distinct from p_currency or coalesce(p_amount_kobo,round(plat.amount*100)::bigint)>round(plat.amount*100)::bigint then
   raise exception 'Refund does not match original platform payment' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('platform-term:'||plat.gym_id::text,0));
  select case when bool_or(is_full_dispute) then round(plat.amount*100)::bigint
    else least(round(plat.amount*100)::bigint,coalesce(sum(amount_kobo),0)) end into total_kobo
    from public.payment_refund_events where reference=p_reference;
  full_refund := total_kobo>=round(plat.amount*100)::bigint;
  update public.platform_payments set refunded_amount=total_kobo::numeric/100,
    payment_status=case when full_refund then 'refunded'::public.payment_status else payment_status end where id=plat.id;
  select * into platform_allocation from public.platform_payment_coverage where payment_id=plat.id for update;
  if full_refund and platform_allocation.payment_id is not null and platform_allocation.revoked_at is null then
   removed_seconds := greatest(0,floor(extract(epoch from platform_allocation.coverage_end-greatest(platform_allocation.coverage_start,now())))::bigint);
   if removed_seconds>0 then
    update public.platform_payment_coverage set coverage_start=coverage_start-make_interval(secs=>removed_seconds),
      coverage_end=coverage_end-make_interval(secs=>removed_seconds) where gym_id=plat.gym_id and payment_id<>plat.id
      and revoked_at is null and coverage_start>=platform_allocation.coverage_end;
    update public.gyms set subscription_current_period_end=subscription_current_period_end-make_interval(secs=>removed_seconds),updated_at=now()
      where id=plat.gym_id;
   end if;
   update public.platform_payment_coverage set revoked_at=now(),revoked_seconds=removed_seconds,
     revoked_days=ceil(removed_seconds::numeric/86400)::int where payment_id=plat.id;
  end if;
  decision := jsonb_build_object('pending',false,'table','platform_payments','payment_id',plat.id,
    'full',full_refund,'refunded_amount_kobo',total_kobo,'revoked_seconds',removed_seconds,
    'requires_review',full_refund and platform_allocation.payment_id is null,
    'policy','partial-retain_full-revoke-unused');
  insert into public.audit_logs(action,gym_id,record_id,table_name,old_values,new_values)
    values('provider_refund_applied',plat.gym_id,plat.id,'platform_payments',
      jsonb_build_object('refunded_amount',plat.refunded_amount,'payment_status',plat.payment_status),decision);
 end if;
 update public.payment_refund_events set applied_at=now(),result=decision where event_key=p_event_key;
 return decision;
end;
$$;
revoke all on function public.apply_payment_refund(text,text,text,bigint,text,boolean) from public,anon,authenticated;
grant execute on function public.apply_payment_refund(text,text,text,bigint,text,boolean) to service_role;

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
  new_start date;
  refund_event public.payment_refund_events%rowtype;
  refund_result jsonb;
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
  new_start := greatest(coalesce(sub.end_date,today-1)+1,today);
  if sub.id is not null then
    update public.member_subscriptions
       set end_date = private.coverage_end(new_start, term_days, term_months),
           status = case when status in ('paused', 'pause_requested') then status else 'active' end,
           plan_id = p_plan_id, trainer_addon = coalesce(trainer, trainer_addon), updated_at = now()
     where id = sub.id returning end_date into new_end;
  else
    new_end := private.coverage_end(today, term_days, term_months);
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
      'fulfilled_end_date', new_end, 'coverage_start',new_start,'duration_days', term_days, 'duration_months', term_months),
    p_commission ->> 'platform_settlement', p_commission ->> 'platform_commission_basis',
    (p_commission ->> 'platform_commission_pct')::numeric,
    (p_commission ->> 'platform_commission_amount')::numeric
  ) returning id into payment_id;
  insert into public.payment_coverage_allocations(payment_id,gym_id,member_id,subscription_id,coverage_start,coverage_end,amount_kobo)
    values(payment_id,p_gym_id,p_member_id,sub.id,new_start,new_end,p_amount_kobo);
  for refund_event in select * from public.payment_refund_events where reference=p_reference and applied_at is null loop
    refund_result := public.apply_payment_refund(refund_event.event_key,p_reference,refund_event.event_name,
      refund_event.amount_kobo,refund_event.currency,refund_event.is_full_dispute);
  end loop;
  select end_date into new_end from public.member_subscriptions where id=sub.id;
  update public.member_payment_checkouts set fulfilled_at = now() where reference = p_reference;
  return jsonb_build_object('created', true, 'payment_id', payment_id, 'end_date', new_end,
    'refunded',exists(select 1 from public.payments where id=payment_id and payment_status='refunded'));
end;
$$;
revoke all on function public.settle_member_charge(text, uuid, uuid, uuid, bigint, text, int, int, boolean, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.settle_member_charge(text, uuid, uuid, uuid, bigint, text, int, int, boolean, text, jsonb, uuid)
  to service_role;
