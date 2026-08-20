-- One live subscription per member per gym.
--
-- member_subscriptions carried nothing but its primary key, so two concurrent
-- fulfillers could each read "this member has no subscription" and each INSERT
-- one. Two distinct Paystack references, two rows, two mirrored memberships —
-- and one month of access, because everything downstream reads the LATEST row.
-- It also breaks the assumption findSub() leans on (lib/member-sub-fulfill.ts):
-- with two live rows, the member/gym fallback can bind an auto-debit mandate to
-- whichever row happened to be created last.
--
-- The index below makes that state unrepresentable. lib/paystack-fulfill.ts and
-- lib/actions/admin-member.ts handle the resulting 23505 by re-reading the live
-- row and extending it, which is what the losing writer should have done all
-- along.
--
-- PRODUCTION DATA: live rows may ALREADY be duplicated by exactly this race, so
-- a bare CREATE UNIQUE INDEX would abort the deploy on the first affected
-- member. The duplicates are collapsed first, deterministically:
--
--   * The survivor is the row carrying a live auto-debit mandate if one of them
--     does, then the furthest end_date, with created_at and id as tie-breakers
--     so the choice is stable whatever order the rows come back in. Mandate
--     first because cancelling the row a Paystack subscription code points at
--     would leave that mandate charging a card with no live row to credit.
--   * The survivor takes the group's FURTHEST end_date, so collapsing can only
--     ever move a member's access forward, never back.
--   * The others are marked 'cancelled' (a status outside the live set) with
--     auto-debit cleared, so no mandate stays bound to a row the app no longer
--     treats as current.
--   * Each collapse is written to audit_logs. A duplicate pair is usually the
--     footprint of the lost-period race — two payments, one period granted —
--     and the audit row is what lets an operator find those members and make
--     them whole. Deleting the row instead would destroy that evidence.
--
-- The index is created NON-concurrently on purpose: the migration runner puts
-- each file in a transaction and CREATE INDEX CONCURRENTLY cannot run in one.
-- It takes a SHARE lock on member_subscriptions for the duration, which is a
-- brief write pause on a table with one row per member.
--
-- Idempotent: re-running collapses nothing once there is nothing to collapse.

with ranked as (
  select
    id, gym_id, member_id, end_date,
    row_number()  over w as rn,
    first_value(id) over w as keep_id,
    count(*)      over (partition by gym_id, member_id) as live_rows,
    max(end_date) over (partition by gym_id, member_id) as group_end
  from public.member_subscriptions
  where status in ('active', 'past_due', 'paused', 'pause_requested')
  window w as (
    partition by gym_id, member_id
    order by
      (auto_debit_enabled is true and paystack_subscription_code is not null) desc,
      end_date desc, created_at desc, id desc
  )
),
dups as (
  select * from ranked where live_rows > 1
),
-- Fold the collapsed rows' coverage into the one that stays live.
survivors as (
  update public.member_subscriptions ms
     set end_date = d.group_end, updated_at = now()
    from dups d
   where ms.id = d.id and d.rn = 1 and ms.end_date < d.group_end
  returning ms.id
),
collapsed as (
  update public.member_subscriptions ms
     set status = 'cancelled', auto_debit_enabled = false, updated_at = now()
    from dups d
   where ms.id = d.id and d.rn > 1
  returning ms.id, ms.gym_id, ms.member_id, d.end_date as superseded_end_date, d.keep_id, d.group_end
)
insert into public.audit_logs (gym_id, action, table_name, record_id, new_values)
select
  gym_id, 'duplicate_live_subscription_collapsed', 'member_subscriptions', id,
  jsonb_build_object(
    'member_id', member_id,
    'superseded_end_date', superseded_end_date,
    'kept_subscription_id', keep_id,
    'kept_end_date', group_end
  )
from collapsed;

create unique index if not exists member_subscriptions_one_live_idx
  on public.member_subscriptions (gym_id, member_id)
  where status in ('active', 'past_due', 'paused', 'pause_requested');

comment on index public.member_subscriptions_one_live_idx is
  'A member holds at most one live subscription per gym. Live = the statuses that mean "this is their current membership": active, past_due, paused, pause_requested. Mirrored in LIVE_SUB_STATUSES (lib/member-sub-core.ts).';
