// Pure confirmation-link handling shared by email generation and the callback.
// Keeping this outside Next/Supabase modules makes the redirect boundary easy
// to test and prevents old, already-sent links from taking a different path
// from newly generated ones.

function isSafeRelative(path: string | null | undefined): path is string {
  return !!path && path.startsWith('/') && !path.startsWith('//');
}

/**
 * Validate a same-origin path and unwrap the historical nested callback shape:
 *   /auth/confirm?next=/launch  ->  /launch
 *
 * The outer value must already be relative. Callers handling an absolute,
 * trusted configuration URL should reduce it to pathname + search first.
 */
export function confirmationHandoff(path: string | null | undefined, fallback: string): string {
  if (!isSafeRelative(path)) return fallback;

  try {
    const url = new URL(path, 'https://placeholder.invalid');
    if (url.pathname === '/auth/confirm') {
      const nested = url.searchParams.get('next');
      return isSafeRelative(nested) ? nested : fallback;
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}
