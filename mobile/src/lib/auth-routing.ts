export type AuthRouteStatus = 'loading' | 'signed-out' | 'signed-in';
export type AuthRouteTarget = '/(tabs)' | '/(auth)/gym' | null;

/** Decide the one redirect needed after the stored session has been restored. */
export function authRouteTarget(status: AuthRouteStatus, segments: readonly string[]): AuthRouteTarget {
  if (status === 'loading') return null;

  const first = segments[0];
  const atRoot = segments.length === 0 || first === 'index';
  const inAuthGroup = first === '(auth)';

  if (status === 'signed-in' && (atRoot || inAuthGroup)) return '/(tabs)';
  if (status === 'signed-out' && !inAuthGroup) return '/(auth)/gym';
  return null;
}
