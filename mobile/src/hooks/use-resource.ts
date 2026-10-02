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
  /** When the currently rendered server payload was last fetched successfully. */
  lastRefreshedAt: number | null;
  /** True when a refresh failed and `data` is retained only as stale context. */
  stale: boolean;
  /** True when the latest request failed before receiving an HTTP response. */
  offline: boolean;
  refresh: () => void;
  /** Replace the data locally after a mutation, without a round-trip. */
  set: (updater: (current: T) => T) => void;
};

export function useResource<T>(path: string): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const loadedOnce = useRef(false);

  // Guards against a slow response landing after the screen has gone.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    const id = ++requestId.current;
    controller.current?.abort();
    if (!path) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const nextController = new AbortController();
    controller.current = nextController;
    if (mode === 'refresh') setRefreshing(true);
    try {
      const next = await api.get<T>(path, nextController.signal);
      if (!alive.current || id !== requestId.current) return;
      setData(next);
      setLastRefreshedAt(Date.now());
      setOffline(false);
      setError(null);
    } catch (e) {
      if (!alive.current || id !== requestId.current || (e as Error).name === 'AbortError') return;
      // An expired session is already being handled by the auth provider, which
      // is about to swap this screen out for sign-in. Showing an error under it
      // would just flash red on the way out.
      if (!(e instanceof ApiError && e.code === 'expired')) {
        setOffline(e instanceof ApiError && e.code === 'offline');
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      }
    } finally {
      if (alive.current && id === requestId.current) {
        loadedOnce.current = true;
        setLoading(false);
        setRefreshing(false);
        controller.current = null;
      }
    }
  }, [path]);

  useFocusEffect(
    useCallback(() => {
      void load(loadedOnce.current ? 'refresh' : 'initial');
      return () => controller.current?.abort();
    }, [load]),
  );

  const refresh = useCallback(() => { void load('refresh'); }, [load]);

  const set = useCallback((updater: (current: T) => T) => {
    setData((cur) => (cur === null ? cur : updater(cur)));
  }, []);

  return {
    data,
    error,
    loading,
    refreshing,
    lastRefreshedAt,
    stale: data !== null && error !== null,
    offline,
    refresh,
    set,
  };
}
