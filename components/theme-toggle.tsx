'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon, ChevronRight } from 'lucide-react';

function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setTheme((document.documentElement.getAttribute('data-theme') as 'dark' | 'light') || 'dark');
    setMounted(true);
  }, []);
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('gf-theme', next); } catch { /* ignore */ }
    setTheme(next);
  }
  return { theme, mounted, toggle };
}

// Icon button — toggles <html data-theme> dark/light, persists to localStorage.
// The pre-paint script in app/layout.tsx applies the saved value on load.
export function ThemeToggle({ size = 40 }: { size?: number }) {
  const { theme, mounted, toggle } = useTheme();
  return (
    <button type="button" className="icon-btn" onClick={toggle} style={{ width: size, height: size }}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title="Toggle theme" suppressHydrationWarning>
      {mounted && theme === 'light' ? <Moon strokeWidth={1.9} /> : <Sun strokeWidth={1.9} />}
    </button>
  );
}

// Member-menu row variant (matches the profile .group .row styling).
export function ThemeToggleRow() {
  const { theme, mounted, toggle } = useTheme();
  const light = mounted && theme === 'light';
  return (
    <button type="button" className="row" onClick={toggle} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }} suppressHydrationWarning>
      <span className="ic">{light ? <Moon strokeWidth={1.9} /> : <Sun strokeWidth={1.9} />}</span>
      <div className="m"><strong>Appearance</strong><small>{light ? 'Light theme' : 'Dark theme'}</small></div>
      <ChevronRight className="chev" strokeWidth={1.9} />
    </button>
  );
}
