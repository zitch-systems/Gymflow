-- One durable provider-initialization intent per member/gym. A timeout never
-- expires this reservation into a second still-payable subscription checkout.
create table public.member_auto_renewal_intents (
 gym_id uuid not null references public.gyms(id) on delete restrict,
 member_id uuid not null references public.profiles(id) on delete restrict,
 reference text not null unique references public.member_payment_checkouts(reference) on delete restrict,
 plan_id uuid not null references public.membership_plans(id) on delete restrict,
 trainer_addon boolean not null,
 state text not null check(state in ('initializing','ready','fulfilled','cancelled')),
 authorization_url text,
 subscription_code text,
 initialization_error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(gym_id,member_id)
);
alter table public.member_auto_renewal_intents enable row level security;
revoke all on public.member_auto_renewal_intents from public,anon,authenticated;
grant all on public.member_auto_renewal_intents to service_role;

create or replace function public.reserve_member_auto_renewal(
 p_reference text,p_gym_id uuid,p_member_id uuid,p_plan_id uuid,p_amount_kobo bigint,
 p_days int,p_months int,p_trainer boolean,p_plan_code text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare previous public.member_auto_renewal_intents%rowtype;
begin
 if p_reference is null or length(p_reference) not between 1 and 200 or p_plan_code is null
   or p_trainer is null or p_amount_kobo is null or p_amount_kobo<=0 then
  raise exception 'Invalid auto-renewal checkout' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('member-auto-intent:'||p_gym_id::text||':'||p_member_id::text,0));
 if not exists(select 1 from public.gym_member_links where gym_id=p_gym_id and user_id=p_member_id and is_active is true) then
  raise exception 'Active member link required' using errcode='42501';
 end if;
 if exists(select 1 from public.member_subscriptions where gym_id=p_gym_id and member_id=p_member_id and auto_debit_enabled is true) then
  raise exception 'Auto-renew is already on; confirm cancellation before starting again' using errcode='22023';
 end if;
 select * into previous from public.member_auto_renewal_intents where gym_id=p_gym_id and member_id=p_member_id for update;
 if found and previous.state<>'cancelled' then
  if previous.plan_id is distinct from p_plan_id or previous.trainer_addon is distinct from p_trainer then
   raise exception 'An auto-renew checkout is already pending for another plan; contact the gym before switching' using errcode='22023';
  end if;
  return jsonb_build_object('created',false,'reference',previous.reference,'state',previous.state,'url',previous.authorization_url);
 end if;
 if not exists(select 1 from public.membership_plans where id=p_plan_id and gym_id=p_gym_id and is_active is true) then
  raise exception 'Active gym plan required' using errcode='22023';
 end if;
 insert into public.member_payment_checkouts(reference,gym_id,member_id,plan_id,amount_kobo,currency,
  duration_days,duration_months,trainer_addon,provider_plan_code)
 values(p_reference,p_gym_id,p_member_id,p_plan_id,p_amount_kobo,'NGN',p_days,p_months,p_trainer,p_plan_code);
 insert into public.member_auto_renewal_intents(gym_id,member_id,reference,plan_id,trainer_addon,state)
 values(p_gym_id,p_member_id,p_reference,p_plan_id,p_trainer,'initializing')
 on conflict(gym_id,member_id) do update set reference=excluded.reference,plan_id=excluded.plan_id,
  trainer_addon=excluded.trainer_addon,state='initializing',authorization_url=null,subscription_code=null,
  initialization_error=null,created_at=now(),updated_at=now();
 return jsonb_build_object('created',true,'reference',p_reference,'state','initializing','url',null);
end;
$$;
revoke all on function public.reserve_member_auto_renewal(text,uuid,uuid,uuid,bigint,int,int,boolean,text) from public,anon,authenticated;
grant execute on function public.reserve_member_auto_renewal(text,uuid,uuid,uuid,bigint,int,int,boolean,text) to service_role;

create or replace function public.finish_member_auto_renewal_initialization(
 p_reference text,p_url text,p_definite_failure boolean,p_error text
) returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if p_url is not null and p_url !~ '^https://checkout[.]paystack[.]com/[A-Za-z0-9_-]+$' then
  raise exception 'Invalid provider checkout URL' using errcode='22023';
 end if;
 update public.member_auto_renewal_intents set
  state=case when p_url is not null then 'ready' when p_definite_failure is true then 'cancelled' else 'initializing' end,
  authorization_url=p_url,initialization_error=left(p_error,300),updated_at=now()
 where reference=p_reference and state='initializing';
 return found;
end;
$$;
revoke all on function public.finish_member_auto_renewal_initialization(text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.finish_member_auto_renewal_initialization(text,text,boolean,text) to service_role;

create or replace function private.mark_auto_renewal_fulfilled()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.fulfilled_at is not null then
  update public.member_auto_renewal_intents set state='fulfilled',updated_at=now() where reference=new.reference;
 end if;
 return new;
end;
$$;
revoke all on function private.mark_auto_renewal_fulfilled() from public,anon,authenticated;
create trigger mark_auto_renewal_fulfilled after update of fulfilled_at on public.member_payment_checkouts
 for each row execute function private.mark_auto_renewal_fulfilled();
