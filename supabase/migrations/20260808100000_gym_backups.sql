-- Scheduled data backups for a gym.
--
-- A gym's operating record — who its members are, what they paid, who turned
-- up — lives only in this database. Owners asked for a copy they hold
-- themselves, on a schedule, without remembering to click anything.
--
--   gyms.backup_frequency  — 'off' | 'daily' | 'weekly' | 'monthly'
--   gyms.backup_email      — also email the archive to the gym's owners
--   gym_backups            — one row per run: where the file is, how big, what
--                            it contained, and whether it worked
--
-- Defaults to WEEKLY and emailing, on by design: a backup nobody switched on
-- protects nobody, and the gyms most likely to lose their records are the least
-- likely to go looking for a setting. Adding the column with a default also
-- backfills every existing gym, so this turns on for the whole estate rather
-- than only for gyms created after it ships.
--
-- Weekly rather than daily: the archive is emailed and stored, and a daily
-- extract of every member and payment is a lot of mail, a lot of storage and a
-- larger standing pile of personal data than the protection warrants. Owners
-- who want daily can pick it; 'off' stays available for those who want none.
--
-- Retention lives in the app (lib/backup-plan.ts), not here: pruning old rows
-- needs to delete the storage object too, which SQL can't do.
--
-- Additive + idempotent.

alter table public.gyms
  add column if not exists backup_frequency text not null default 'weekly',
  add column if not exists backup_email boolean not null default true,
  add column if not exists backup_last_run_at timestamptz;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'gyms_backup_frequency_check' and conrelid = 'public.gyms'::regclass
  ) then
    alter table public.gyms add constraint gyms_backup_frequency_check
      check (backup_frequency in ('off', 'daily', 'weekly', 'monthly'));
  end if;
end $$;

create table if not exists public.gym_backups (
  id uuid not null default gen_random_uuid(),
  gym_id uuid not null,
  created_at timestamptz not null default now(),
  -- Path inside the gym-backups bucket. Null while a failed run is recorded:
  -- the row is the evidence that the attempt happened at all.
  storage_path text,
  size_bytes bigint,
  -- {"members": 412, "payments": 1290, ...} — lets an owner see at a glance
  -- that a backup actually contains what they expect, without downloading it.
  row_counts jsonb not null default '{}'::jsonb,
  status text not null default 'success',
  error text,
  -- 'scheduled' | 'manual', so a run triggered from Settings is
  -- distinguishable from one the cron produced.
  trigger text not null default 'scheduled'
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='gym_backups_pkey' and conrelid='public.gym_backups'::regclass) then
    alter table public.gym_backups add constraint gym_backups_pkey primary key (id);
  end if;
  if not exists (select 1 from pg_constraint where conname='gym_backups_gym_id_fkey' and conrelid='public.gym_backups'::regclass) then
    alter table public.gym_backups add constraint gym_backups_gym_id_fkey
      foreign key (gym_id) references public.gyms(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='gym_backups_status_check' and conrelid='public.gym_backups'::regclass) then
    alter table public.gym_backups add constraint gym_backups_status_check
      check (status in ('success', 'failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname='gym_backups_trigger_check' and conrelid='public.gym_backups'::regclass) then
    alter table public.gym_backups add constraint gym_backups_trigger_check
      check (trigger in ('scheduled', 'manual'));
  end if;
end $$;

create index if not exists idx_gym_backups_gym_created
  on public.gym_backups using btree (gym_id, created_at desc);

alter table public.gym_backups enable row level security;

-- Reads: owners and managers of the owning gym. Front desk and instructors have
-- no business seeing a full member/payment extract, and this table is the index
-- to exactly that.
drop policy if exists gym_backups_select_managers on public.gym_backups;
create policy gym_backups_select_managers on public.gym_backups
  as permissive for select to authenticated
  using (exists (
    select 1 from public.gym_staff_links s
    where s.gym_id = gym_backups.gym_id
      and s.user_id = (select auth.uid())
      and s.is_active = true
      and s.role in ('gym_owner', 'manager')
  ));

-- Writes are service-role only: rows are produced by the cron and the
-- Back-up-now action, both of which run with the service key. An authenticated
-- INSERT would let a staffer forge a "success" row for a backup that never ran,
-- which is worse than no backup because it stops anyone looking.
revoke insert, update, delete on public.gym_backups from anon, authenticated;
grant select on public.gym_backups to authenticated;
grant all on public.gym_backups to service_role;

-- ── Storage ────────────────────────────────────────────────────────────────
-- Private bucket. First path segment is the gym id, matching gym-docs, so the
-- policies below can scope by it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gym-backups', 'gym-backups', false, 104857600, array['application/zip'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read: owners and managers of the owning gym only — same reasoning as the
-- table policy. Platform admins are deliberately NOT included here (unlike
-- gym-docs, where they verify the certificate): nobody at GymFlow needs to pull
-- a tenant's full member and payment extract out of storage.
drop policy if exists "gym_backups_read" on storage.objects;
create policy "gym_backups_read" on storage.objects
  for select
  using (
    bucket_id = 'gym-backups'
    and auth.role() = 'authenticated'
    and exists (
      select 1 from public.gym_staff_links s
      where s.user_id = auth.uid() and s.is_active = true
        and s.role in ('gym_owner', 'manager')
        and s.gym_id::text = split_part(objects.name, '/', 1)
    )
  );

-- No authenticated write policy at all: only the service role (which bypasses
-- RLS) puts objects in this bucket. A staffer who could upload here could
-- replace a backup with a file of their choosing.

comment on table public.gym_backups is 'One row per backup run. Writes are service-role only — the cron and the manual Back up now action. A forged success row would stop someone noticing that backups had silently stopped.';
comment on column public.gyms.backup_frequency is 'off | daily | weekly | monthly. Defaults to weekly and applies to existing rows: a backup nobody switched on protects nobody, and the gyms most likely to lose their records are the least likely to go looking for the setting.';
comment on column public.gyms.backup_email is 'Also email the archive to the gym owners when a backup completes. The stored copy is written either way.';
comment on column public.gyms.backup_last_run_at is 'When the last backup completed. The scheduler compares this against backup_frequency to decide what is due, so a missed cron catches up rather than skipping a period.';
