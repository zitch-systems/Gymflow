-- Enforce the paid calendar window at the database boundary for every writer,
-- including staff and the WhatsApp service-role client. The existing RLS and
-- write validators still constrain tenant, actor, immutable fields and timing.
create function public.validate_checkin_entitlement_window()
returns trigger language plpgsql security invoker
set search_path to 'public', 'pg_temp'
as $$
declare today date := (now() at time zone 'Africa/Lagos')::date;
begin
  if not exists (select 1 from public.gym_member_links
                 where gym_id = new.gym_id and user_id = new.member_id and is_active is true)
     or not exists (select 1 from public.member_subscriptions
                    where gym_id = new.gym_id and member_id = new.member_id
                      and status in ('active', 'past_due')
                      and start_date <= today and end_date >= today)
     or not exists (select 1 from public.gyms where id = new.gym_id and status in ('active', 'trial')) then
    raise exception 'Current paid membership is required for check-in' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_checkin_entitlement_window() from public, anon, authenticated, service_role;
create trigger trg_checkin_entitlement_window before insert on public.check_ins
for each row execute function public.validate_checkin_entitlement_window();

create function public.validate_code_entitlement_window()
returns trigger language plpgsql security invoker
set search_path to 'public', 'pg_temp'
as $$
declare today date := (now() at time zone 'Africa/Lagos')::date;
begin
  -- An existing open visit permits a code for checkout, including after
  -- midnight. No entitlement is invented for a new entry.
  if exists (select 1 from public.check_ins where gym_id = new.gym_id and member_id = new.member_id
             and status = 'active' and checked_out_at is null) then return new; end if;
  if not exists (select 1 from public.gym_member_links
                 where gym_id = new.gym_id and user_id = new.member_id and is_active is true)
     or not exists (select 1 from public.member_subscriptions
                    where gym_id = new.gym_id and member_id = new.member_id
                      and status in ('active', 'past_due')
                      and start_date <= today and end_date >= today) then
    raise exception 'Current paid membership is required for entry code' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_code_entitlement_window() from public, anon, authenticated, service_role;
create trigger trg_code_entitlement_window before insert on public.checkin_codes
for each row execute function public.validate_code_entitlement_window();
