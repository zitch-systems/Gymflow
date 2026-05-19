// /js/supabase.js — GymFlow Supabase ES Module (v5)
//
// Strategy: top-level await on the bootstrap, but with a HARD timeout.
// If the CDN doesn't load within 8 seconds, we throw with a clear message
// rather than hanging the module forever. The module-level error message
// will appear in console; importing pages can handle it via the script's
// own try/catch around the import.
//
// CRITICAL: every page that uses `client.from()`, `client.auth.x()`, etc.
// expects a REAL Supabase client with full chainable API. We can't proxy
// that without re-implementing the whole query builder, so we wait for
// the real one but with a bounded wait.

async function getReadyClient() {
  // If the bootstrap script hasn't loaded yet, try to load it dynamically.
  if (!window.GF_SUPABASE_READY) {
    const existing = document.querySelector('script[src="/js/supabase-config.js"], script[src="/supabase-config.js"]');
    if (!existing) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/js/supabase-config.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('Could not load /js/supabase-config.js'));
        document.head.appendChild(s);
        setTimeout(() => reject(new Error('Bootstrap script load timeout')), 5000);
      });
    }
    // Give the script a tick to set window.GF_SUPABASE_READY
    for (let i = 0; i < 20 && !window.GF_SUPABASE_READY; i++) {
      await new Promise(r => setTimeout(r, 25));
    }
    if (!window.GF_SUPABASE_READY) {
      throw new Error('Supabase bootstrap did not initialize within 500ms');
    }
  }
  // Wait for the ready promise, with a hard 8-second timeout.
  return await Promise.race([
    window.GF_SUPABASE_READY,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('Supabase init timeout (8s) — check your internet connection or refresh')),
      8000
    ))
  ]);
}

// Top-level await — if this rejects, the module fails to load and the
// importing page's <script type="module"> body never runs. This is the
// correct behavior: a page that can't reach Supabase should not pretend
// to work. The bootstrap script (/js/supabase-config.js) is loaded eagerly
// from the page's <head>, so by the time this module's import is resolved
// the bootstrap is almost always already settled.
export const client = await getReadyClient();

// ── Auth helpers ───────────────────────────────────────────────────────────────
export async function getUser() {
  const { data: { user } } = await client.auth.getUser();
  return user ?? null;
}

export function getGymSlug() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('gym')) return params.get('gym');
  const host = window.location.hostname;
  const parts = host.split('.');
  if (parts.length >= 3 && parts[0] !== 'www' && !host.includes('netlify.app') && !host.includes('localhost')) {
    return parts[0];
  }
  const m = window.location.pathname.match(/^\/g\/([^/]+)/);
  if (m) return m[1];
  return localStorage.getItem('gf-gym-slug') || null;
}

export async function loadGym() {
  const slug = getGymSlug();
  if (!slug) return null;
  const { data, error } = await client.from('gyms').select('*').eq('slug', slug).maybeSingle();
  if (error) { console.warn('[GF] loadGym error:', error); return null; }
  if (data) localStorage.setItem('gf-gym-slug', data.slug);
  return data ?? null;
}

export async function requireAuth() {
  const user = await getUser();
  if (!user) {
    const redirect = window.location.pathname + window.location.search;
    window.location.href = '/login.html?redirect=' + encodeURIComponent(redirect);
    return null;
  }
  return user;
}

export async function requireMember(gym) {
  const user = await requireAuth();
  if (!user || !gym) return null;
  const { data } = await client
    .from('gym_member_links')
    .select('*')
    .eq('user_id', user.id)
    .eq('gym_id', gym.id)
    .maybeSingle();
  if (!data) { window.location.href = '/login.html'; return null; }
  return data;
}

export async function getStaffRole(gymOrId) {
  const user = await getUser();
  if (!user) return null;
  const gymId = typeof gymOrId === 'string' ? gymOrId : gymOrId ? gymOrId.id : null;
  if (!gymId) return null;
  
  // First check profiles table for role (owner/manager set here)
  const { data: profile } = await client
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  
  if (profile && ['owner','manager','gym_owner'].includes(profile.role)) {
    return profile.role;
  }
  
  // Then check staff table for staff roles
  const { data: staffRow } = await client
    .from('staff')
    .select('role')
    .eq('user_id', user.id)
    .eq('gym_id', gymId)
    .eq('is_active', true)
    .maybeSingle();
  
  if (staffRow) return staffRow.role;
  
  // Also check gym_staff_links if it exists (added in migration 06)
  const { data: link } = await client
    .from('gym_staff_links')
    .select('role')
    .eq('user_id', user.id)
    .eq('gym_id', gymId)
    .maybeSingle();
  
  return link ? (link.role || profile && profile.role || null) : (profile ? profile.role : null);
}

// ── UI helpers ─────────────────────────────────────────────────────────────────
export function toast(message, type = 'success', duration = 3500) {
  // Defer to the global toast (defined by gf-utils.js) when present.
  if (typeof window.toast === 'function' && window.toast !== toast) {
    return window.toast(message, type, duration);
  }
  let container = document.getElementById('gf-toasts');
  if (!container) {
    container = document.createElement('div');
    container.id = 'gf-toasts';
    container.className = 'gf-toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: '\u2713', error: '\u2715', warning: '\u26A0', info: '\u2139' };
  const el = document.createElement('div');
  el.className = 'gf-toast gf-toast-' + type;
  el.innerHTML = '<span>' + (icons[type] || icons.info) + '</span><span>' + message + '</span>';
  container.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 400); }, duration);
}

// ── Formatting helpers ─────────────────────────────────────────────────────────
export function daysLeft(expiryDate) {
  if (!expiryDate) return 0;
  const diff = Math.ceil((new Date(expiryDate) - new Date()) / 86400000);
  return Math.max(0, diff);
}

export function fmtDate(dateStr) {
  if (!dateStr) return '\u2014';
  return new Date(dateStr).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtNaira(amount) {
  if (amount == null) return '\u2014';
  return '\u20a6' + Number(amount).toLocaleString('en-NG');
}
