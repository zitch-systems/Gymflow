-- Monthly is a first-class billing cycle again, alongside quarterly and annual.
--
-- 20260812090000 introduced subscription_billing_cycle constrained to the two
-- commitment cycles, on the assumption monthly was retired. It isn't: both tiers
-- are sold monthly, on the same Paystack Plans that already existed, so the
-- constraint has to accept it or every monthly charge fails fulfilment.

alter table public.gyms
  drop constraint if exists gyms_subscription_billing_cycle_valid;

alter table public.gyms
  add constraint gyms_subscription_billing_cycle_valid
  check (subscription_billing_cycle is null or subscription_billing_cycle in ('monthly', 'quarterly', 'annually'))
  not valid;

alter table public.gyms
  validate constraint gyms_subscription_billing_cycle_valid;
