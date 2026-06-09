'use client';

import { useSyncExternalStore } from 'react';
import { Sun, Moon, ChevronRight } from 'lucide-react';

// <html data-theme> is the source of truth (set pre-paint by the script in
// app/layout.tsx). Reading it as an external store avoids a mount effect and
// keeps every toggle instance in sync when any of them flips the attribute.
function subscribe(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => obs.disconnect();
}
const getSnapshot = () => (document.documentElement.getAttribute('data-theme') as 'dark' | 'light') || 'dark';
const getServerSnapshot = () => 'dark' as const;

function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('gf-theme', next); } catch { /* ignore */ }
  }
  return { theme, toggle };
}

// Icon button — toggles <html data-theme> dark/light, persists to localStorage.
export function ThemeToggle({ size = 40 }: { size?: number }) {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" className="icon-btn" onClick={toggle} style={{ width: size, height: size }}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title="Toggle theme" suppressHydrationWarning>
      {theme === 'light' ? <Moon strokeWidth={1.9} /> : <Sun strokeWidth={1.9} />}
    </button>
  );
}

// Member-menu row variant (matches the profile .group .row styling).
export function ThemeToggleRow() {
  const { theme, toggle } = useTheme();
  const light = theme === 'light';
  return (
    <button type="button" className="row" onClick={toggle} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }} suppressHydrationWarning>
      <span className="ic">{light ? <Moon strokeWidth={1.9} /> : <Sun strokeWidth={1.9} />}</span>
      <div className="m"><strong>Appearance</strong><small>{light ? 'Light theme' : 'Dark theme'}</small></div>
      <ChevronRight className="chev" strokeWidth={1.9} />
    </button>
  );
}
