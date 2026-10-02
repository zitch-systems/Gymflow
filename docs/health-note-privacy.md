# Health-note privacy decision

Health notes are profile-level sensitive data. They live in
`profile_health_notes`, keyed once by member profile. The legacy
`profiles.health_notes` column remains for API compatibility but always stores
`NULL`; authorised non-null legacy writes are transferred by a guarded trigger.

Access is limited to:

- the member;
- a verified gym owner or manager while that member has an active link to the
  owner or manager's gym; and
- a verified instructor with a current, explicit active assignment to that
  member. Assigned instructors have read access only.

Front-desk staff, accountants, unrelated instructors, other tenants and staff
sessions without second-factor proof cannot read or mutate the note. Set and
clear operations use `set_profile_health_note`, validate the gym/member scope,
and record actor, tenant, action, source, reason and note length. Audit rows do
not contain the note text.

General gym backups omit health notes because scheduled runs have no human
actor and current manual backups are available to managers. If health data is
exported later, it must use a separate owner-only action and artifact with an
explicit actor and audit record. It must not be added to scheduled or general
manager-accessible archives.
