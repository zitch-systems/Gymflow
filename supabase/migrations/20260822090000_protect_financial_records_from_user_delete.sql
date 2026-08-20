-- Deleting one auth user must not erase the gym's ledger.
--
-- profiles.id REFERENCES auth.users(id) ON DELETE CASCADE, and 17 tables hang
-- off profiles(id) with their own ON DELETE CASCADE. So a single operator
-- action in the Supabase dashboard (Authentication > Delete user, or
-- auth.admin.deleteUser, or honouring an NDPR erasure request the obvious way)
-- silently took the member's entire payment history, their signed waivers, and
-- an instructor's payout history with it. Verified against a database built
-- from these migrations: `delete from auth.users where id = <member>` succeeded
-- and left payments, waiver_signatures and instructor_payouts at zero. Nothing
-- warned; nothing was recoverable. audit_logs is not a backstop — it records
-- the ACTOR (auth.uid(), null for service-role webhook writes), so a member
-- typically has no rows pointing at them at all.
--
-- The fix is to make the destructive path fail loudly rather than to make the
-- ledger row survive with its attribution stripped. Three options were on the
-- table:
--
--   SET NULL — payments.member_id and waiver_signatures.member_id are already
--     nullable so it would apply, but it turns an accidental delete into a
--     silent one: the row count stays right while every revenue-by-member
--     report, every receipt lookup and the signature's legal value quietly
--     rot. It also can't cover instructor_payouts.instructor_id, which is NOT
--     NULL. Rejected.
--   A guard trigger on auth.users — same effect as RESTRICT but hand-rolled,
--     living in the schema Supabase owns and upgrades. Rejected.
--   RESTRICT on the money and legal tables — the delete raises 23503, names the
--     constraint, and nothing at all is removed because the whole cascade is
--     one transaction. Chosen.
--
-- Financial and legal records carry a RETENTION obligation that outranks
-- erasure, so blocking the delete is the correct default even for a lawful
-- erasure request: the answer there is to anonymise the profile and keep the
-- ledger, which is written up in docs/DATA_ERASURE.md. A member who never paid
-- and never signed anything is untouched by this migration and still deletes
-- cleanly, cascade and all.
--
-- WHAT IS DELIBERATELY LEFT CASCADING: check_ins, class_bookings,
-- checkin_codes, memberships, member_subscriptions, instructor_sessions,
-- instructor_subscriptions, gym_member_links, gym_staff_links, staff and
-- saved_cards. Those are personal activity, entitlement state or a stored card
-- token — they belong to the person and should follow them out. They are also
-- protected in practice: any member with a payments row can no longer be
-- deleted at all, so the cascade never gets to run on them.
--
-- salary_payments has no direct FK to profiles; it reaches auth.users through
-- gym_staff_links.user_id, so its staff_link_id FK is restricted too. Staff
-- salary is money on the same footing as an instructor payout.
--
-- platform_payments is NOT touched here: it references gyms, not profiles, so
-- deleting an auth user was never able to reach it.
--
-- PRODUCTION DATA: RESTRICT constrains future deletes only — it cannot fail on
-- existing rows. Re-adding the constraint does revalidate the table, but the
-- identical FK was already enforced on every one of those rows, so the scan
-- cannot find a violation; it costs a brief lock and nothing else. No in-app
-- code path deletes a profile, an auth user or a gym_staff_links row — member
-- and staff removal are is_active flips in lib/actions/admin-member.ts and
-- lib/actions/admin-staff.ts — so nothing that works today starts failing.
-- Idempotent.

alter table public.payments drop constraint if exists payments_member_id_fkey;
alter table public.payments add constraint payments_member_id_fkey
  FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

alter table public.instructor_payouts drop constraint if exists instructor_payouts_instructor_id_fkey;
alter table public.instructor_payouts add constraint instructor_payouts_instructor_id_fkey
  FOREIGN KEY (instructor_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

alter table public.waiver_signatures drop constraint if exists waiver_signatures_member_id_fkey;
alter table public.waiver_signatures add constraint waiver_signatures_member_id_fkey
  FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

alter table public.salary_payments drop constraint if exists salary_payments_staff_link_id_fkey;
alter table public.salary_payments add constraint salary_payments_staff_link_id_fkey
  FOREIGN KEY (staff_link_id) REFERENCES public.gym_staff_links(id) ON DELETE RESTRICT;
