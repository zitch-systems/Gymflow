-- Preserve each explicit acceptance when a gym edits an existing waiver ID.
-- The application writes a SHA-256 document revision to signature and the
-- exact displayed document snapshot to signature_data. Historic signatures
-- remain untouched; this is not a backfill or acceptance of a new document.
drop index if exists public.waiver_signatures_one_per_waiver_member_idx;
create unique index if not exists waiver_signatures_one_per_revision_member_idx
on public.waiver_signatures (gym_id, waiver_id, member_id, (coalesce(md5(signature), '')));
