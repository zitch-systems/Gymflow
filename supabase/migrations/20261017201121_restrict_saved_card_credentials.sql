-- A saved card is payment-provider state, not member-editable profile data.
-- The legacy cards_member_all policy exposed reusable authorization tokens
-- and let callers forge their own card records through the direct Data API.
-- Wallets select only display fields; credentials and writes stay server-side.

alter table public.saved_cards enable row level security;

revoke all privileges on table public.saved_cards from public, anon, authenticated;

-- Table-level REVOKE does not remove independently granted column privileges.
-- Clear those as well, including any grants added outside the migration chain.
do $$
declare columns text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum)
    into columns
  from pg_attribute
  where attrelid = 'public.saved_cards'::regclass
    and attnum > 0 and not attisdropped;
  execute format(
    'revoke all privileges (%s) on table public.saved_cards from public, anon, authenticated',
    columns
  );
end $$;

drop policy if exists cards_member_all on public.saved_cards;
drop policy if exists cards_member_display on public.saved_cards;
create policy cards_member_display on public.saved_cards
  for select to authenticated
  using (member_id = (select auth.uid()));

grant select (
  id, gym_id, member_id, card_type, last4, exp_month, exp_year,
  bank, brand, is_default, is_active, created_at, expiry_month, expiry_year
) on public.saved_cards to authenticated;
grant all privileges on table public.saved_cards to service_role;

comment on table public.saved_cards is
  'Payment-provider card credentials. Members may read only their display fields; authorization tokens and all writes are service-role-only.';
