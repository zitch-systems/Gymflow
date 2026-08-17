import Constants from 'expo-constants';
import type { Session } from '@/api/types';

// The one place the app talks to GymFlow.
//
// Every screen goes through `api.get/post/patch`, which means token refresh,
// expiry handling and error shaping are solved once. Screens get either data or
// an ApiError with a sentence they can show a member — never a raw status code.

/** Where the Next.js app lives. Override per build with EXPO_PUBLIC_API_URL. */
export const API_BASE_URL: string = (
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ??
  'https://gymflow.ng'
).replace(/\/+$/, '');

export class ApiError extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// How the client reaches the session the AuthProvider owns. The provider binds
// this at mount; without it the client simply sends unauthenticated requests
// (which is right for the sign-in endpoints).
export type AuthBridge = {
  getSession: () => Session | null;
  saveSession: (s: Session) => Promise<void>;
  onSessionLost: () => Promise<void>;
};

let bridge: AuthBridge | null = null;

export function bindAuth(b: AuthBridge | null): void {
  bridge = b;
}

// Refresh a minute before the token actually dies, so a request never races the
// expiry it was going to hit anyway.
const REFRESH_MARGIN_SECONDS = 60;

// One refresh at a time. Without this, a screen that fires four requests on
// mount with an expired token starts four refreshes — and Supabase rotates the
// refresh token on each, so three of them come back with a token that has
// already been superseded and the member is signed out for no reason.
let refreshInFlight: Promise<Session | null> | null = null;

async function refreshSession(): Promise<Session | null> {
  if (!bridge) return null;
  if (refreshInFlight) return refreshInFlight;

  const current = bridge.getSession();
  if (!current?.refresh_token) return null;

  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/app/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: current.refresh_token }),
      });
      const body = (await res.json().catch(() => ({}))) as { session?: Session | null };
      if (!res.ok || !body.session) return null;
      await bridge!.saveSession(body.session);
      return body.session;
    } catch {
      // A refresh that fails on the network is not a dead session — the member
      // is on a bad connection. Returning null lets the caller surface a
      // connection error instead of signing them out.
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

function isExpiring(session: Session | null): boolean {
  if (!session?.expires_at) return false;
  return session.expires_at - REFRESH_MARGIN_SECONDS <= Math.floor(Date.now() / 1000);
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  /** Set false for the endpoints that mint a session in the first place. */
  auth?: boolean;
  signal?: AbortSignal;
};

async function request<T>(path: string, opts: RequestOptions = {}, isRetry = false): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = opts;

  let token: string | null = null;
  if (auth && bridge) {
    let session = bridge.getSession();
    if (isExpiring(session)) session = (await refreshSession()) ?? session;
    token = session?.access_token ?? null;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('Can’t reach GymFlow. Check your connection and try again.', 0, 'offline');
  }

  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (res.status === 401 && auth && !isRetry) {
    // The token was rejected. One refresh, one retry — then give up and let the
    // provider send the member back to sign-in.
    const refreshed = await refreshSession();
    if (refreshed) return request<T>(path, opts, true);
    await bridge?.onSessionLost();
    throw new ApiError('Your session has expired. Please sign in again.', 401, 'expired');
  }

  if (!res.ok) {
    const message = typeof payload.error === 'string' ? payload.error : 'Something went wrong. Please try again.';
    throw new ApiError(message, res.status, typeof payload.code === 'string' ? payload.code : null);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown, auth = true) => request<T>(path, { method: 'POST', body, auth }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
};
