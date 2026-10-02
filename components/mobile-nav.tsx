'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Menu, X } from 'lucide-react';

// Mobile drawer behaviour shared by the three app shells (admin / coach /
// superadmin). Below 860px the sidebar is off-canvas (see "App shell
// responsive" in globals.css); the burger in the topbar slides it in, the
// backdrop / Escape / any navigation slides it out. Desktop is untouched —
// .nav-burger and .nav-backdrop only exist inside the media query.
export function useMobileNav(pathname: string) {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);

  // Close when the route changes (user tapped a nav link). State-from-props
  // during render — the sanctioned effect-free way to react to a prop change.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    const query = window.matchMedia('(max-width: 860px)');
    const sync = () => setMobile(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((current) => !current), []);
  const drawerOpen = mobile && open;

  useEffect(() => {
    if (!drawerOpen) return;

    const sidebar = sidebarRef.current;
    const opener = burgerRef.current;
    if (!sidebar) return;
    const focusable = () => Array.from(sidebar.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');

    const frame = window.requestAnimationFrame(() => focusable()[0]?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [close, drawerOpen]);

  return {
    open,
    drawerOpen,
    drawerClosed: mobile && !open,
    sidebarRef,
    burgerRef,
    toggle,
    close,
  };
}

export function NavBurger({
  open, onClick, buttonRef,
}: {
  open: boolean;
  onClick: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className="nav-burger"
      aria-label={open ? 'Close navigation' : 'Open navigation'}
      aria-expanded={open}
      aria-controls="console-navigation"
      onClick={onClick}
    >
      {open ? <X size={18} strokeWidth={1.9} /> : <Menu size={18} strokeWidth={1.9} />}
    </button>
  );
}

export function NavBackdrop({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <button type="button" className="nav-backdrop" aria-label="Close navigation" onClick={onClose} />;
}
