'use client';

import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';

// Mobile drawer behaviour shared by the three app shells (admin / coach /
// superadmin). Below 860px the sidebar is off-canvas (see "App shell
// responsive" in globals.css); the burger in the topbar slides it in, the
// backdrop / Escape / any navigation slides it out. Desktop is untouched —
// .nav-burger and .nav-backdrop only exist inside the media query.
export function useMobileNav(pathname: string) {
  const [open, setOpen] = useState(false);

  // Close when the route changes (user tapped a nav link). State-from-props
  // during render — the sanctioned effect-free way to react to a prop change.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return { open, toggle: () => setOpen((o) => !o), close: () => setOpen(false) };
}

export function NavBurger({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button type="button" className="nav-burger" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} onClick={onClick}>
      {open ? <X size={18} strokeWidth={1.9} /> : <Menu size={18} strokeWidth={1.9} />}
    </button>
  );
}

export function NavBackdrop({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <button type="button" className="nav-backdrop" aria-label="Close navigation" onClick={onClose} />;
}
