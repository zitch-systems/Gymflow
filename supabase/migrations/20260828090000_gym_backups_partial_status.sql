-- Distinguish a partial gym backup from a complete one in the row itself.
--
-- gym_backups.status was ('success', 'failed'). A run where SOME tables read
-- and others failed was logged as 'success' with the failure list in the
-- problems array — the audit found this makes the backup list look like N
-- healthy archives when several are actually 2-of-25-tables partial files.
-- Worse, prune() counts 'success' toward KEEP_BACKUPS, so a stream of partials
-- can evict a real full backup from the retention window.
--
-- Adds 'partial' as a distinct terminal status. lib/backup-run.ts now sets it
-- when archive.failures.length > 0 (real table read failures — warnings like
-- row-cap truncation still land as 'success' with a note, because the data is
-- in the archive). prune() keeps its 'success'-only rule so partials cannot
-- displace real backups from the retained window.

do $$ begin
  if exists (select 1 from pg_constraint where conname='gym_backups_status_check' and conrelid='public.gym_backups'::regclass) then
    alter table public.gym_backups drop constraint gym_backups_status_check;
  end if;
  alter table public.gym_backups
    add constraint gym_backups_status_check
    check (status in ('success', 'partial', 'failed'));
end $$;
