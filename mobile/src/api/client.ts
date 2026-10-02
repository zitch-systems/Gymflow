import Constants from 'expo-constants';
import type { Session } from '@/api/types';

// The one place the app talks to GymFlow.
//
// Every screen goes through `api.get/post/patch`, which means token refresh,
// expiry handling and error shaping are solved once. Screens get either data or
// an ApiError with a sentence they can show a member — never a raw status code.

/** Where the Next.js app lives. Override per build with EXPO_PUBLIC_API_URL. */
function canonicalApiOrigin(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    // Production redirects the apex to www. Following that redirect can strip
    // Authorization on a cross-origin fetch, so authenticated API calls must
    // start on the canonical host. Preserve localhost and gym subdomains used
    // by development and tenant previews.
    if (url.hostname === 'gymflow.ng') url.hostname = 'www.gymflow.ng';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return trimmed;
  }
}

export const API_BASE_URL: string = canonicalApiOrigin(
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ??
  'https://www.gymflow.ng',
);

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
  getGymId: () => string | null;
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
type RefreshFlight = { auth: AuthBridge; refreshToken: string; promise: Promise<Session | null> };
let refreshInFlight: RefreshFlight | null = null;

async function refreshSession(auth: AuthBridge, current: Session): Promise<Session | null> {
  if (refreshInFlight?.auth === auth && refreshInFlight.refreshToken === current.refresh_token) {
    return refreshInFlight.promise;
  }
  const gymId = auth.getGymId();
  if (!current?.refresh_token) return null;

  const flight = { auth, refreshToken: current.refresh_token } as RefreshFlight;
  const promise = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/app/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(gymId ? { 'X-Gym-Id': gymId } : {}),
        },
        body: JSON.stringify({ refresh_token: current.refresh_token }),
      });
      const body = (await res.json().catch(() => ({}))) as { session?: Session | null };
      if (res.status === 400 || res.status === 401 || res.status === 403) return null;
      if (!res.ok) {
        throw new ApiError('GymFlow couldn’t refresh your session. Please try again.', res.status, 'session_unavailable');
      }
      if (!body.session) return null;
      // A sign-out can happen while the refresh request is in flight. Never
      // let that old response write a new bearer token back into storage.
      if (bridge !== auth || auth.getSession()?.refresh_token !== current.refresh_token) return null;
      await auth.saveSession(body.session);
      return body.session;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      // Keep the stored session on a transient connection failure. Callers
      // surface offline state instead of treating it as invalid credentials.
      throw new ApiError('Can’t reach GymFlow. Check your connection and try again.', 0, 'offline');
    } finally {
      if (refreshInFlight === flight) refreshInFlight = null;
    }
  })();
  flight.promise = promise;
  refreshInFlight = flight;

  return promise;
}

function sessionChanged(): Error {
  const error = new Error('The active session changed while this request was running.');
  error.name = 'AbortError';
  return error;
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
  let gymId: string | null = null;
  const requestAuth = auth ? bridge : null;
  let session: Session | null = requestAuth?.getSession() ?? null;
  if (requestAuth && session) {
    const original = session;
    if (isExpiring(session)) session = (await refreshSession(requestAuth, session)) ?? session;
    if (bridge !== requestAuth) throw sessionChanged();
    const live = requestAuth.getSession();
    if (live?.access_token !== session.access_token) {
      // A null refresh result is only relevant to the session that requested
      // it. A sign-out/sign-in or gym-account switch makes this request stale.
      if (live?.refresh_token !== original.refresh_token) throw sessionChanged();
    }
    token = session?.access_token ?? null;
    gymId = requestAuth.getGymId();
  }

  const assertRequestIsCurrent = () => {
    if (requestAuth && token && (
      bridge !== requestAuth
      || requestAuth.getSession()?.access_token !== token
      || requestAuth.getGymId() !== gymId
    )) {
      throw sessionChanged();
    }
  };

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(auth && gymId ? { 'X-Gym-Id': gymId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('Can’t reach GymFlow. Check your connection and try again.', 0, 'offline');
  }

  assertRequestIsCurrent();

  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // JSON parsing is asynchronous and can be arbitrarily slow for a large
  // response. Recheck after it so an account switch during parsing cannot
  // return the old member's payload or error into the new session.
  assertRequestIsCurrent();

  if (res.status === 401 && auth && !isRetry) {
    // The token was rejected. One refresh, one retry — then give up and let the
    // provider send the member back to sign-in.
    if (!requestAuth || !session || bridge !== requestAuth || requestAuth.getSession()?.access_token !== token || requestAuth.getGymId() !== gymId) {
      throw sessionChanged();
    }
    const refreshed = await refreshSession(requestAuth, session);
    if (refreshed) {
      if (bridge !== requestAuth || requestAuth.getSession()?.access_token !== refreshed.access_token || requestAuth.getGymId() !== gymId) throw sessionChanged();
      return request<T>(path, opts, true);
    }
    // Invalidate only the credentials that received this 401. An old response
    // must never sign out a newer session that was established meanwhile.
    if (bridge !== requestAuth || requestAuth.getSession()?.access_token !== token || requestAuth.getGymId() !== gymId) throw sessionChanged();
    await requestAuth.onSessionLost();
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
