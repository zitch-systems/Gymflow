import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, bindAuth } from '@/api/client';
import { storage } from '@/auth/storage';
import type { AuthResponse, Gym, Session } from '@/api/types';

// Who is signed in, at which gym, and how that changes.
//
// GymFlow is multi-tenant and a member belongs to exactly one gym in the app, so
// "signed in" always means a session AND a gym. The gym is resolved from the
// short member code printed on the gym's wall before any password is typed —
// that is what /api/app/gym is for, and it is why sign-in is a two-step flow
// rather than the usual email + password screen.

type Status = 'loading' | 'signed-out' | 'signed-in';

type AuthValue = {
  status: Status;
  gym: Gym | null;
  session: Session | null;
  /** Look up a gym from the code on the wall. Doesn't sign anyone in. */
  resolveGym: (code: string) => Promise<Gym>;
  signIn: (params: { code: string; email: string; password: string }) => Promise<void>;
  signUp: (params: { code: string; email: string; password: string; fullName: string; phone?: string }) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [gym, setGym] = useState<Gym | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  // The client reads the session synchronously on every request, so it can't go
  // through React state — a ref is the live copy, state is what renders.
  const sessionRef = useRef<Session | null>(null);

  const applySession = useCallback(async (next: Session) => {
    sessionRef.current = next;
    setSession(next);
    await storage.setSession(next);
  }, []);

  const clear = useCallback(async () => {
    sessionRef.current = null;
    setSession(null);
    setGym(null);
    setStatus('signed-out');
    await Promise.all([storage.clearSession(), storage.clearGym()]);
  }, []);

  // Bind before the first request goes out, and keep the binding for the life of
  // the app — the client's refresh path calls back into these.
  useEffect(() => {
    bindAuth({
      getSession: () => sessionRef.current,
      saveSession: applySession,
      onSessionLost: clear,
    });
    return () => bindAuth(null);
  }, [applySession, clear]);

  // Restore on launch. The stored session is trusted enough to render with: the
  // first API call either works, silently refreshes, or lands the member back on
  // sign-in through onSessionLost.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [stored, storedGym] = await Promise.all([storage.getSession(), storage.getGym()]);
      if (cancelled) return;
      if (stored?.access_token && storedGym) {
        sessionRef.current = stored;
        setSession(stored);
        setGym(storedGym);
        setStatus('signed-in');
      } else {
        setStatus('signed-out');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const resolveGym = useCallback(async (code: string): Promise<Gym> => {
    const res = await api.get<{ gym: Gym }>(`/api/app/gym?code=${encodeURIComponent(code.trim())}`);
    return res.gym;
  }, []);

  const finishAuth = useCallback(async (res: AuthResponse, code: string) => {
    if (!res.session) {
      // Sign-up can succeed without a session when the platform is configured to
      // require email confirmation and no service key is present to auto-confirm.
      throw new Error('Your account was created. Please confirm your email, then sign in.');
    }
    await Promise.all([applySession(res.session), storage.setGym(res.gym), storage.setLastCode(code.trim())]);
    setGym(res.gym);
    setStatus('signed-in');
  }, [applySession]);

  const signIn = useCallback(async ({ code, email, password }: { code: string; email: string; password: string }) => {
    const res = await api.post<AuthResponse>('/api/app/signin', { code, email, password }, false);
    await finishAuth(res, code);
  }, [finishAuth]);

  const signUp = useCallback(async (
    { code, email, password, fullName, phone }: { code: string; email: string; password: string; fullName: string; phone?: string },
  ) => {
    const res = await api.post<AuthResponse>('/api/app/signup', {
      code, email, password, full_name: fullName, phone: phone ?? '',
    }, false);
    await finishAuth(res, code);
  }, [finishAuth]);

  const value = useMemo<AuthValue>(
    () => ({ status, gym, session, resolveGym, signIn, signUp, signOut: clear }),
    [status, gym, session, resolveGym, signIn, signUp, clear],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}
