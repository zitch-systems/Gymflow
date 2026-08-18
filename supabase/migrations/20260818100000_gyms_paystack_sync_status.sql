-- Persist Paystack split out-of-sync state on gyms, so a subaccount-push
-- failure survives past the page reload that used to lose it.
--
-- setGymCommission (lib/actions/platform-gym.ts) writes platform_commission_pct
-- first and pushes it to the gym's Paystack subaccount second — intentionally,
-- so a Paystack rejection never rolls back the saved rate. Until now the
-- rejection itself lived only in the React action state returned to the
-- editor: reload the page and it was gone, with no server-side record that a
-- gym had drifted from Paystack at all. The reconciliation sweep
-- (lib/reconcile.ts reconcileGymSplits) needs a persisted place to find these
-- gyms on its own, without a human re-opening the commission editor to
-- reproduce the failure.
--
--   paystack_sync_error      NULL when the gym's live Paystack split matches
--                             what's stored here; otherwise the message from
--                             the most recent failed push/recreate attempt.
--   paystack_sync_checked_at When the sweep (or a commission save) last
--                             verified this gym against Paystack, whether or
--                             not it needed a fix. Lets the sweep revisit
--                             every subaccount gym on a rotation instead of
--                             only ones already flagged, so a gym that went
--                             stale silently (subaccount created under a
--                             different key/mode, or deleted at Paystack,
--                             with nobody re-editing its commission to
--                             surface it) is still found eventually.

alter table public.gyms
  add column if not exists paystack_sync_error text,
  add column if not exists paystack_sync_checked_at timestamptz;

comment on column public.gyms.paystack_sync_error is
  'Message from the most recent failed push of platform_commission_pct to this gym''s Paystack subaccount, or a subaccount-not-found error. NULL means the live split matches what''s stored. Set by setGymCommission and by the reconciliation sweep; cleared by whichever of them next succeeds.';
comment on column public.gyms.paystack_sync_checked_at is
  'When this gym''s subaccount was last checked against Paystack (by a commission save or by the reconciliation sweep). Drives the sweep''s revisit order so every gym with a subaccount is eventually re-verified, not only ones already flagged.';

-- The sweep's candidate query filters/orders on this alongside
-- paystack_subaccount_code; partial on "has a subaccount" since gyms without
-- one are never candidates.
create index if not exists idx_gyms_paystack_sync_pending
  on public.gyms (paystack_sync_checked_at)
  where paystack_subaccount_code is not null;
