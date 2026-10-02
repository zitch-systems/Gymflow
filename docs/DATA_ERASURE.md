# GymFlow account deletion operations

## Request and service target

Every account holder can initiate account deletion from the native app's Profile → Delete account, or from **https://www.gymflow.ng/account/delete**. The web form verifies the account directly and works without an active membership or a paid gym plan. No phone call or support email is required to submit a request.

Requests cover the person's **whole GymFlow account across all gyms**, not just the currently selected membership. `POST /api/app/account-deletion` requires a verified bearer identity and the exact confirmation `DELETE`; callers cannot supply a subject or gym identifier. `GET` returns only the caller's receipt. Duplicate requests preserve the original request, status and due date.

The product displays a **30-day processing target**. Platform operators must review **Platform console → Account deletion** daily and prioritize overdue requests. This target does not override a shorter applicable deadline. If an exceptional lawful delay is necessary, contact the person with the reason and expected date before the target expires; keep the request open and the restricted case record current. Never silently reset its due date.

The request itself does not delete the account, cancel billing, issue refunds or suspend access. The app and website disclose this. Processing must actually remove the account and associated personal data that is not required to be retained; a suspended account alone is **not** a completed deletion.

Apple permits a manual process when the user is told how long it takes and receives completion confirmation: https://developer.apple.com/support/offering-account-deletion-in-your-app/.

## 1. Claim and assess the request

Use **Start processing** in the platform queue. The action requires an active platform administrator and a current privileged-session proof. Request state and its audit event change atomically. Stale or duplicate operator forms cannot overwrite newer work.

Create a restricted case record using the request UUID. Verify the subject UUID against the verified request, not a name search. Inventory all gyms, member/staff/instructor links, gym ownership, subscriptions, provider mandates, personal content, files and third-party processors associated with the subject. Ownership transfer may be needed before removing an owner; coordinate it without denying deletion solely because the account is an owner.

Preserve a verified delivery address temporarily in that restricted case only so a completion notice can be delivered after Auth removal. Do not copy identities, health data, bank details or payment credentials into the queue's evidence fields or ordinary logs.

For every category proposed for retention, record its specific legal or contractual basis, purpose, access restriction, review date and deletion deadline. A foreign-key constraint, a business preference, a general reference to tax law, or the mere existence of a payment is **not by itself** a legal retention decision. Obtain the responsible privacy/legal owner's decision where necessary.

## 2. Stop future use and billing safely

Before erasure, cancel each recurring mandate/subscription with the payment provider and confirm cancellation there. Reconcile pending charges and refunds so deleting a local saved-card row cannot leave provider billing running. A deletion request does not automatically entitle the person to a refund; resolve any actual refund through the normal reconciled payment workflow.

Deactivate gym member/staff/instructor links and revoke active Auth sessions and refresh tokens. Remove trusted devices, recovery material, pending sign-in challenges and API access associated with the subject. If a retained technical identity row is necessary, disable sign-in permanently and remove authenticating credentials and provider identities using the supported Auth administration flow. An email replacement alone does not disable password, phone, OAuth, MFA or existing access tokens.

Deleting an Auth user does not immediately invalidate every previously issued JWT. Confirm that sensitive operations reject the removed or disabled identity and allow remaining token lifetimes to expire; never mistake a local sign-out for full revocation.

Supabase documentation: https://supabase.com/docs/guides/auth/managing-user-data#deleting-users.

## 3. Erase non-retained personal data

Use a reviewed, subject-scoped operational script against the current schema. Rehearse it on disposable fixtures first. Run database changes transactionally where possible, check affected counts and keep the before/after evidence in the restricted case. Do not use the old blanket SQL recipe: it did not cover all identifiers or processors and could leave a sign-in-capable account behind.

The inventory must include at least:

- Profile identity and contact fields, emergency/next-of-kin details, avatar/photo URLs and files, biography, health notes and their separate `profile_health_notes` / `profile_health_note_audit` data.
- Gym/member/staff/instructor links, bookings, attendance/check-ins, membership/subscription details, member notifications, personal content and any exports or backups subject to the retention schedule.
- Saved payment authorizations and cards, recurring intents and checkouts, provider customer metadata and outstanding mandate state. Preserve only the approved financial evidence.
- WhatsApp contact identifiers and message/content records, email delivery/customer records and other processor-held personal data. Setting `whatsapp_contacts.profile_id` to null does not remove a stored phone number or conversation.
- Auth email/phone, user metadata, linked identities, sessions, MFA factors, recovery tokens and trusted-device records. Remove Storage objects before deleting an Auth identity that still owns them; use Storage APIs so object bytes and metadata remain consistent.
- Audit and telemetry records containing personal information. Remove or restrict unnecessary identifying payloads while preserving the minimal approved security/financial evidence.

The inventory is a minimum, not proof that the current schema contains no other personal data. Check current database columns, foreign keys, Storage buckets, processor integrations and logs on each operation. Do not publish raw customer rows or backup files as evidence.

## 4. Financial and legal records

The schema deliberately restricts cascades from profiles/auth into payment, payroll, payout and waiver evidence. **Do not drop or weaken those foreign keys to force an Auth delete.** The four historical restricted tables are not a complete dependency or retention inventory.

If records need lawful retention, remove unnecessary identifiers and segregate access. A stable UUID, payment reference, signature, IP address or linkable ledger can still be personal data after names and emails are removed. Describe such records as retained or pseudonymized, not anonymous without evidence of irreversibility.

Where an approved retained record requires a technical tombstone identity, keep the minimum non-authenticating row and its documented basis. The person's usable account, credentials and non-retained personal information must still be removed. Schedule the retained record and tombstone for deletion when their retention basis expires.

If no retention basis applies, remove all associated data and delete the Auth account using supported administration tools after checking every relevant dependency. Four zero counts in selected financial tables are insufficient to declare the deletion safe or complete.

## 5. Verify and confirm completion

Verify that sign-in/access is disabled, provider renewals are stopped, non-retained rows and stored objects are gone, remaining data matches the approved retention inventory, and processor requests have completed or have a documented lawful disposition. A queued processor erasure with no confirmed outcome is still open work.

Send the person a completion notice through the verified channel. State what was deleted, completion date, and any retained categories, purpose and retention period. Then remove the temporary contact information from the restricted case unless its continued retention has a documented basis. This deployment's automated tests never send this notice and never erase a real customer.

Only now choose **Record completed deletion**. Both attestations are required: actual account/data/renewal processing is complete, and completion has been confirmed to the person. Record the restricted evidence reference and a brief retention outcome without personal data. The action does not itself erase data or send messages.

`account_deletion_requests` has no cascading subject FK, so the minimal request receipt survives actual Auth erasure. Only the subject can read receipt columns through RLS; internal completion evidence is not granted to client roles. `account_deletion_events` is service-only audit history, and operator transitions are enforced through the private verified-session function. Include these minimal accountability records in the retention schedule too.

## Operational boundary

This release implements authenticated initiation, durable receipt/status, protected operator processing and completion accountability. It does **not** claim that an automated universal erasure engine exists or that all historical customer data has been erased. Operators remain responsible for executing and verifying the current-schema, provider and retention work above for each real request.
