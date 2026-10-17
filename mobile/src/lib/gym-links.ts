/** Keep browser handoffs and printed door codes in the member’s selected gym. */
export function gymPortalUrl(baseUrl: string, gymSlug: string, path: string): string {
  const url = new URL(baseUrl);
  if (/^[a-z0-9][a-z0-9-]*$/i.test(gymSlug)
    && (url.hostname === 'gymflow.ng' || url.hostname.endsWith('.gymflow.ng'))) {
    url.hostname = `${gymSlug.toLowerCase()}.gymflow.ng`;
  }
  url.pathname = path;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function isGymCheckinCode(value: string, baseUrl: string, gymSlug: string | null | undefined): boolean {
  if (!gymSlug) return false;
  try {
    const scanned = new URL(value.trim());
    const expected = new URL(gymPortalUrl(baseUrl, gymSlug, '/checkin'));
    return scanned.origin === expected.origin
      && !scanned.username && !scanned.password
      && scanned.pathname.replace(/\/$/, '') === '/checkin'
      && scanned.searchParams.get('via') === 'qr';
  } catch {
    return false;
  }
}
