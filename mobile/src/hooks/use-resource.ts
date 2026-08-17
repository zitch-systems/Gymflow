import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/api/client';

// One loader for every read-only screen: fetch on mount, refetch on focus,
// pull-to-refresh, and an error the screen can show as a sentence.
//
// Refetching on focus matters more here than in most apps — the facts on these
// screens change from outside the phone. Reception checks a member in at the
// desk, a coach marks them attended, a webhook lands their renewal. Coming back
// to a screen should show what is true now, not what was true when it mounted.

export type Resource<T> = {
  data: T | null;
  error: string | null;
  /** First load, nothing on screen yet. */
  loading: boolean;
  /** A pull-to-refresh in flight over data that is already rendered. */
  refreshing: boolean;
  refresh: () => void;
  /** Replace the data locally after a mutation, without a round-trip. */
  set: (updater: (current: T) => T) => void;
};

export function useResource<T>(path: string): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Guards against a slow response landing after the screen has gone.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'refresh') setRefreshing(true);
    try {
      const next = await api.get<T>(path);
      if (!alive.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      if (!alive.current) return;
      // An expired session is already being handled by the auth provider, which
      // is about to swap this screen out for sign-in. Showing an error under it
      // would just flash red on the way out.
      if (!(e instanceof ApiError && e.code === 'expired')) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      }
    } finally {
      if (alive.current) { setLoading(false); setRefreshing(false); }
    }
  }, [path]);

  useFocusEffect(
    useCallback(() => {
      void load(alive.current && !loading ? 'refresh' : 'initial');
      // `loading` is deliberately not a dependency: including it would re-run
      // the effect the moment the first load finishes, fetching twice.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  const refresh = useCallback(() => { void load('refresh'); }, [load]);

  const set = useCallback((updater: (current: T) => T) => {
    setData((cur) => (cur === null ? cur : updater(cur)));
  }, []);

  return { data, error, loading, refreshing, refresh, set };
}
