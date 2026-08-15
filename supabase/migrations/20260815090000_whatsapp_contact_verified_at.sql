-- whatsapp_contacts.profile_id can now be set two ways: proven, through the
-- Flow (email + password), or merely recognised, by the inbound number
-- matching a profile's phone (lib/whatsapp/contacts.ts findProfileByWaId).
-- Both are documented to grant read-only access to membership state; only the
-- former should ever be allowed to spend money. Until now nothing recorded
-- which kind a contact was, so router.ts had no way to enforce that line —
-- a phone-matched contact could reach checkout the same as a signed-in one.
--
-- verified_at is set only by lib/whatsapp/contacts.ts#linkContact, which runs
-- exclusively after a successful Flow sign-in or sign-up
-- (app/api/whatsapp/flow/route.ts#attachContact). The phone-match auto-link
-- path in upsertContact never touches it.
alter table public.whatsapp_contacts
  add column if not exists verified_at timestamptz;

comment on column public.whatsapp_contacts.verified_at is
  'Set when this contact proved itself through the WhatsApp sign-in/sign-up Flow (password). Null for a contact only auto-linked by phone-number match — that grants read access to membership state, not the ability to pay.';
