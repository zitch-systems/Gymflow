# GymFlow — Data Erasure Procedure (NDPR / GDPR)

**Scope:** an operator has to remove a person — a member, an instructor, or a
staffer — from production, either because a gym asked for it or because the
person filed an erasure request under the NDPR (Nigeria) or the GDPR.

**The one rule:** never delete the auth user.

---

## 0. Why deleting the auth user is the wrong move

`public.profiles.id` references `auth.users(id)` with `ON DELETE CASCADE`, and
most of the schema hangs off `profiles(id)` the same way. Deleting one row in
**Authentication → Users** used to take the person's entire payment history,
their signed waivers and (for an instructor) their payout history with it — no
warning, no undo, and the audit log does not stand in for any of it because it
records the actor, not the subject.

Since `20260822090000_protect_financial_records_from_user_delete.sql` that
delete no longer succeeds for anyone with financial or legal history. It raises:

```
ERROR:  update or delete on table "profiles" violates foreign key constraint
        "payments_member_id_fkey" on table "payments"  (SQLSTATE 23503)
```

That is the guard working, not a bug to route around. The restricted
constraints are `payments_member_id_fkey`, `instructor_payouts_instructor_id_fkey`,
`waiver_signatures_member_id_fkey` and `salary_payments_staff_link_id_fkey`.

**Do not** drop or weaken a constraint to force the delete through. Financial
records (tax, Paystack reconciliation, chargeback defence) and signed waivers
(liability defence) carry a retention obligation that outranks the erasure
right — both the NDPR and the GDPR (Art. 17(3)(b)) exempt processing required
to comply with a legal obligation. What must go is the *identifying* data, and
that is what step 2 removes.

## 1. Cut off access first

This is reversible and buys time while the request is assessed.

- Member: **Admin → Members → the member → Suspend** (`setMemberActive`, flips
  `gym_member_links.is_active`).
- Staff / instructor: **Admin → Staff → Deactivate** (`setStaffActive`, flips
  `gym_staff_links.is_active`).

Neither deletes anything. A deactivated person cannot sign in to a gym context,
cannot check in, and stops receiving reminders.

## 2. Anonymise the profile

Run as service role in the SQL editor. Replace `:subject` with the profile id.

```sql
begin;

-- The person's identity. Keep the row: the ledger points at it.
-- full_name and member_id are GENERATED columns — do not list them; full_name
-- follows first_name/last_name on its own.
update public.profiles
   set first_name   = 'Deleted',
       last_name    = 'user',
       email        = null,
       phone        = null,
       avatar_url   = null,
       photo_url    = null,
       date_of_birth = null,
       gender       = null,
       address      = null,
       health_notes = null,
       bio          = null,
       emergency_contact_name  = null,
       emergency_contact_phone = null,
       nok_name = null, nok_relationship = null, nok_phone = null, nok_address = null
 where id = :subject;

-- Stored card tokens — no retention basis once the person is gone.
delete from public.saved_cards where member_id = :subject;

-- WhatsApp identity (the phone number is the identifier here).
update public.whatsapp_contacts set profile_id = null where profile_id = :subject;

-- Auth-side identifiers. Leaves the row so the FK holds, but the person can no
-- longer sign in and the address is no longer stored.
update auth.users
   set email = concat('erased+', id, '@invalid.local'),
       phone = null,
       raw_user_meta_data = '{}'::jsonb
 where id = :subject;

commit;
```

Check the column list against the live `profiles` table before running — this
document is only accurate as of the commit that ships it.

## 3. What survives, and why

| Kept | Reason |
|---|---|
| `payments` rows (amount, date, Paystack reference) | Tax and Paystack reconciliation; chargeback defence |
| `instructor_payouts`, `salary_payments` | Payroll / payout records |
| `waiver_signatures` (signature, IP, timestamp) | Liability defence for the gym |
| `memberships`, `member_subscriptions`, `check_ins` | Attached to the now-anonymous profile; deleted only if the money rows are gone (see §4) |
| `audit_logs` | Tamper-evidence for the erasure itself |

After step 2 those rows point at a profile with no name, no email and no phone.
They are financial records, not personal ones.

## 4. The person genuinely has no financial or legal history

A lead who signed up and never paid, never signed a waiver and was never paid
out is not caught by any restricted constraint. Deleting their `auth.users` row
succeeds and cascades cleanly, and that is the right outcome. Confirm first:

```sql
select
  (select count(*) from public.payments           where member_id     = :subject) as payments,
  (select count(*) from public.waiver_signatures  where member_id     = :subject) as waivers,
  (select count(*) from public.instructor_payouts where instructor_id = :subject) as payouts,
  (select count(*) from public.salary_payments sp
     join public.gym_staff_links l on l.id = sp.staff_link_id
    where l.user_id = :subject)                                                   as salaries;
```

All four zero → delete is safe. Any non-zero → use step 2 instead.

## 5. Record it

Log the request, the date, who approved it and which route (anonymise vs.
delete) was taken. Keep that record outside the tenant's data — the erasure
itself has to be provable to a regulator after the subject's data is gone.
