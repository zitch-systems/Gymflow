import * as SecureStore from 'expo-secure-store';
import type { Gym, Session } from '@/api/types';

// Where the signed-in member lives between launches.
//
// The Supabase session goes in the Android keystore (expo-secure-store), not
// AsyncStorage: it is a bearer credential for this member's gym record —
// payments, personal details, the lot — and AsyncStorage is a plaintext file
// that any backup or rooted-device dump walks off with.
//
// The gym is cached alongside it purely so the first frame after launch can
// show the member's gym name and colour instead of a spinner. It is public
// information (the same fields /api/app/gym hands to anyone with the code), so
// it lives in the same store only for tidiness, not for secrecy.

const SESSION_KEY = 'gf.session';
const GYM_KEY = 'gf.gym';
const LAST_CODE_KEY = 'gf.last_gym_code';

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // A corrupt or undecryptable entry is not worth crashing a launch over —
    // the member just signs in again.
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, JSON.stringify(value));
  } catch {
    // Storage failures are survivable: the session stays in memory for this run.
  }
}

async function remove(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* nothing to clear */
  }
}

export const storage = {
  getSession: () => readJson<Session>(SESSION_KEY),
  setSession: (s: Session) => writeJson(SESSION_KEY, s),
  clearSession: () => remove(SESSION_KEY),

  getGym: () => readJson<Gym>(GYM_KEY),
  setGym: (g: Gym) => writeJson(GYM_KEY, g),
  clearGym: () => remove(GYM_KEY),

  // Pre-fills the gym-code field on the next sign-in. Members share a phone
  // with nobody but themselves, and re-typing the code after every sign-out is
  // the kind of friction that gets an app deleted.
  getLastCode: async () => {
    try {
      return await SecureStore.getItemAsync(LAST_CODE_KEY);
    } catch {
      return null;
    }
  },
  setLastCode: async (code: string) => {
    try {
      await SecureStore.setItemAsync(LAST_CODE_KEY, code);
    } catch {
      /* best effort */
    }
  },
};
