-- CAC registration on the gym profile: the RC/BN/IT number and the certificate.
--
-- Nigerian gyms are registered with the Corporate Affairs Commission, and the
-- certificate is what proves the business behind a payout account is real. It
-- belongs on the gym profile, next to the bank details it corroborates.
--
-- STORAGE: a new PRIVATE bucket rather than gym-assets. gym-assets is public —
-- its objects serve straight off the storage CDN without evaluating RLS, which
-- is right for a logo and wrong for a document carrying a company's
-- registration number and its directors' names. gym-docs is public=false, so
-- the only way to read an object is a short-lived signed URL minted
-- server-side for someone the app has already authorised. It also accepts
-- PDFs, which gym-assets deliberately does not (image/* only, 2 MB).
--
-- Hence cac_certificate_path stores a STORAGE PATH, not a URL: there is no
-- durable public URL to store, and a path is what createSignedUrl takes.
--
-- Policy shape mirrors the existing gym_assets_staff_* policies: path is
-- <gym_id>/<file>, and the first segment is compared as TEXT via split_part
-- rather than cast to uuid, so a malformed path simply fails to match instead
-- of raising inside a policy expression.
--
-- Idempotent.

alter table public.gyms add column if not exists cac_number text;
alter table public.gyms add column if not exists cac_certificate_path text;

comment on column public.gyms.cac_number is
  'CAC registration number, normalised (e.g. RC1234567). Corporate Affairs Commission — Nigeria.';
comment on column public.gyms.cac_certificate_path is
  'Object path inside the private gym-docs bucket. Read via a short-lived signed URL; never public.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'gym-docs', 'gym-docs', false, 5242880,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read: any active staff member of the owning gym, plus platform admins, who
-- are the ones verifying these documents — without that they would have to ask
-- a gym to email the certificate it had already uploaded.
drop policy if exists "gym_docs_read" on storage.objects;
create policy "gym_docs_read" on storage.objects
  for select
  using (
    bucket_id = 'gym-docs'
    and auth.role() = 'authenticated'
    and (
      exists (
        select 1 from public.gym_staff_links s
        where s.user_id = auth.uid() and s.is_active = true
          and s.gym_id::text = split_part(objects.name, '/', 1)
      )
      or exists (
        select 1 from public.platform_admins pa
        where pa.user_id = auth.uid() and pa.is_active = true
      )
    )
  );

-- Write: owners and managers only. Front desk and instructors have no business
-- replacing the company's registration certificate.
drop policy if exists "gym_docs_write" on storage.objects;
create policy "gym_docs_write" on storage.objects
  for insert
  with check (
    bucket_id = 'gym-docs'
    and auth.role() = 'authenticated'
    and exists (
      select 1 from public.gym_staff_links s
      where s.user_id = auth.uid() and s.is_active = true
        and s.role in ('gym_owner', 'manager')
        and s.gym_id::text = split_part(objects.name, '/', 1)
    )
  );

drop policy if exists "gym_docs_update" on storage.objects;
create policy "gym_docs_update" on storage.objects
  for update
  using (
    bucket_id = 'gym-docs'
    and auth.role() = 'authenticated'
    and exists (
      select 1 from public.gym_staff_links s
      where s.user_id = auth.uid() and s.is_active = true
        and s.role in ('gym_owner', 'manager')
        and s.gym_id::text = split_part(objects.name, '/', 1)
    )
  );

drop policy if exists "gym_docs_delete" on storage.objects;
create policy "gym_docs_delete" on storage.objects
  for delete
  using (
    bucket_id = 'gym-docs'
    and auth.role() = 'authenticated'
    and exists (
      select 1 from public.gym_staff_links s
      where s.user_id = auth.uid() and s.is_active = true
        and s.role in ('gym_owner', 'manager')
        and s.gym_id::text = split_part(objects.name, '/', 1)
    )
  );
