/**
 * Escape a value so it's safe to use as the pattern in a PostgreSQL ILIKE
 * call. ILIKE treats `_` as "any single character" and `%` as "any
 * sequence" — both of which are legal characters in email addresses. An
 * unescaped lookup for `ru_smith@gmail.com` would also match
 * `rusmith@gmail.com` and `ruXsmith@gmail.com`, so two colliding accounts
 * cause `.maybeSingle()` to return error+null, and Paystack webhook
 * fulfilment silently fails to resolve the member.
 *
 * Pair with the `idx_profiles_email_lower` functional index (migration
 * 20260529_hot_path_indexes.sql): always pass a lowercased value here so
 * the ILIKE call can still hit the index for a fast lookup.
 */
export function escapeIlikeEmail(value: string): string {
  // Backslash is ILIKE's default escape character — escape it first, then
  // the two wildcards. The order matters: escaping `\` after `%`/`_` would
  // double-escape the backslashes we just wrote.
  return value.replace(/[\\%_]/g, '\\$&');
}
