-- Close two auth-escalation paths.
--
-- 1) MANAGER → OWNER via direct RLS PATCH on public.gyms.
--    gyms_update_owner_only granted UPDATE to any manager on any column of
--    the gym row. Server Actions in lib/actions/platform-gym.ts correctly
--    require a platform admin, but they are not the only writer PostgREST
--    accepts: a manager JWT hitting PATCH /rest/v1/gyms?id=eq.<id> with a
--    body of {"subscription_plan":"growth","platform_commission_pct":0,
--    "paystack_subaccount_code":"ACCT_theirs", ...} landed the write. RLS
--    doesn't offer native column-level allow lists, so a BEFORE UPDATE
--    trigger enforces "managers can only touch operational columns; owners
--    and platform admins can touch anything." Owner (not manager) is the
--    tenant's own authority over its billing/commission/payout account,
--    and platform admin is the operator override.
--
-- 2) MANAGER can rewrite gym_staff_links to make themselves owner.
--    gym_staff_links_all trusted has_gym_role(['gym_owner','manager']) with
--    no restriction on the row's role column. A manager could INSERT a row
--    with role='gym_owner' pointing at themselves, or UPDATE the actual
--    owner's link to role='manager' / is_active=false. Split into two
--    policies: managers may INSERT/UPDATE/DELETE non-owner rows only; only
--    the current gym_owner (or a platform admin) may touch owner rows.
--
-- 3) private.is_platform_admin still trusted profiles.role='platform_admin'.
--    handle_new_user (SECURITY DEFINER trigger) inserts a profile with role
--    from user_metadata via ON CONFLICT DO UPDATE that does NOT overwrite
--    role. A signup that races the trigger (or a compromised signup path
--    that stamps role='platform_admin' into user_metadata) leaves a
--    profiles row that the helper honours as platform-admin. The
--    authoritative list is public.platform_admins (SECURITY DEFINER,
--    is_active-gated, no self-service INSERT grant). Drop the profiles.role
--    clause — every app-code path already reads platform_admins directly
--    (see lib/auth/dal.ts requirePlatformAdmin), so no caller changes.
--    profiles.role stays useful as a UX hint elsewhere; it just no longer
--    authorises anything on its own.

-- ── (3) is_platform_admin: platform_admins only. ────────────────────────────
create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.platform_admins
    where user_id = (select auth.uid())
      and coalesce(is_active, true) = true
  );
$function$;

-- ── (1) gyms UPDATE column allow-list via trigger ───────────────────────────
-- Columns a manager may safely change from the console. Everything else on
-- the row is either billing (subscription_*, paystack_subaccount_code,
-- platform_commission_*, legacy_full_access), platform-owned metadata
-- (status, id, created_at), or authorization posture (two_factor_required,
-- role-adjacent). Owners still edit everything.
create or replace function private.gyms_reject_manager_billing_writes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  is_owner boolean;
  is_pa    boolean;
  uid uuid;
begin
  -- Service-role / superuser writes have no auth.uid() — the webhook fulfiller,
  -- reconciliation cron, admin.from() calls, and the test harness all reach us
  -- this way — so bypass the guard entirely; RLS separately controls what those
  -- callers can do. The guard exists to stop an *authenticated* manager JWT
  -- from PATCHing protected columns through PostgREST.
  begin
    uid := auth.uid();
  exception when others then uid := null; end;
  if uid is null then return new; end if;

  -- Platform admins may write anything.
  is_pa := private.is_platform_admin();
  if is_pa then return new; end if;

  -- The actor's role at THIS gym. Owner may write anything; manager (or
  -- anyone else who somehow reaches the trigger) is restricted below.
  is_owner := private.has_gym_role(old.id, array['gym_owner'::public.user_role]);
  if is_owner then return new; end if;

  -- Any change to a protected column is rejected. Comparing with `is
  -- distinct from` treats NULL correctly.
  if (new.subscription_plan is distinct from old.subscription_plan)
     or (new.subscription_status is distinct from old.subscription_status)
     or (new.subscription_current_period_end is distinct from old.subscription_current_period_end)
     or (new.subscription_billing_cycle is distinct from old.subscription_billing_cycle)
     or (new.paystack_subaccount_code is distinct from old.paystack_subaccount_code)
     or (new.paystack_customer_code is distinct from old.paystack_customer_code)
     or (new.paystack_subscription_code is distinct from old.paystack_subscription_code)
     or (new.platform_commission_pct is distinct from old.platform_commission_pct)
     or (new.platform_commission_mode is distinct from old.platform_commission_mode)
     or (new.platform_commission_fixed_amount is distinct from old.platform_commission_fixed_amount)
     or (new.legacy_full_access is distinct from old.legacy_full_access)
     or (new.two_factor_required is distinct from old.two_factor_required)
     or (new.status is distinct from old.status)
     or (new.trial_ends_at is distinct from old.trial_ends_at)
     or (new.slug is distinct from old.slug)
  then
    raise exception 'Only the gym owner or a platform admin may change this field.'
      using errcode = '42501'; -- insufficient_privilege
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_gyms_reject_manager_billing_writes on public.gyms;
create trigger trg_gyms_reject_manager_billing_writes
  before update on public.gyms
  for each row
  execute function private.gyms_reject_manager_billing_writes();

-- ── (2) gym_staff_links: owner-only writes on owner rows ────────────────────
-- Rebuild gym_staff_links_all as two policies with disjoint scopes: managers
-- own non-owner rows only, owners (and platform admins) own owner rows and
-- everything else. USING gates OLD-row visibility for UPDATE/DELETE so a
-- manager cannot touch the owner's link; WITH CHECK gates the NEW row so a
-- manager cannot INSERT a role='gym_owner' link, nor UPDATE a non-owner row
-- to role='gym_owner'.
drop policy if exists gym_staff_links_all on public.gym_staff_links;

create policy gym_staff_links_manager
on public.gym_staff_links
for all
to authenticated
using (
  private.has_gym_role(gym_id, array['manager'::public.user_role])
  and role <> 'gym_owner'::public.user_role
)
with check (
  private.has_gym_role(gym_id, array['manager'::public.user_role])
  and role <> 'gym_owner'::public.user_role
);

create policy gym_staff_links_owner_or_platform
on public.gym_staff_links
for all
to authenticated
using (
  private.has_gym_role(gym_id, array['gym_owner'::public.user_role])
  or private.is_platform_admin()
)
with check (
  private.has_gym_role(gym_id, array['gym_owner'::public.user_role])
  or private.is_platform_admin()
);
