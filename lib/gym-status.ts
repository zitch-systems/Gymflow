// What `gyms.status` means, in one place.
//
// The enum is `active | trial | suspended | terminated`. The first two are
// trading normally; the last two are the platform's off switch, set from
// /superadmin/gyms/[id] (lib/actions/platform-gym.ts) when a tenant stops
// paying or leaves.
//
// This module exists because "offline" used to be spelled `gym.status ===
// 'suspended'` inline, in five places, all of them render guards — the public
// landing page, its QR routes and the admin layout. Everything else in the app
// resolved a gym by slug or member code and never looked at status at all, so a
// suspended gym still took new signups through /join and the mobile API, still
// initialised Paystack checkouts that settled to its own subaccount, and still
// sent gym-branded email on the nightly cron. The console hid itself and
// nothing else changed.
//
// Two consequences of the old spelling worth keeping in mind:
//   • `terminated` was never checked anywhere, so a terminated gym was more
//     online than a suspended one.
//   • A render guard is not a boundary. Next.js layouts don't run for Server
//     Action invocations, so a check in a layout only hides chrome.
// Both are why callers should reach for this predicate at the point a gym is
// *resolved*, not at the point it is drawn.
export const OFFLINE_GYM_STATUSES = ['suspended', 'terminated'] as const;

/**
 * Is this gym switched off at the platform level?
 *
 * Unknown/null statuses read as online: `status` is NOT NULL with a default in
 * the schema, and failing open here matches how the rest of the app treats
 * missing gym columns (a bad read must not black out a paying tenant).
 */
export function gymIsOffline(status: string | null | undefined): boolean {
  return (OFFLINE_GYM_STATUSES as readonly string[]).includes(status ?? '');
}

/** Convenience for the common `{ status }`-shaped row. */
export function isOfflineGym(gym: { status?: string | null } | null | undefined): boolean {
  return !!gym && gymIsOffline(gym.status);
}

/**
 * The PostgREST filter that keeps offline gyms out of a query.
 *
 * `.not('status', 'in', OFFLINE_GYM_FILTER)` rather than a pair of `.neq()`
 * calls, so adding a status to the list above changes every call site at once.
 */
export const OFFLINE_GYM_FILTER = `(${OFFLINE_GYM_STATUSES.join(',')})`;
