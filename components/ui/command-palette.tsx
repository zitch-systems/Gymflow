'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { Search } from 'lucide-react';
import { filterCommandItems, clampHighlight } from '@/lib/command-palette';

export type CommandItem = {
  href: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
};

type Props = {
  items: CommandItem[];
  /** Placeholder shown in the search input. */
  placeholder?: string;
  /** A11y label for the listbox describing what kind of items it lists. */
  listLabel?: string;
};

// Spotlight-style ⌘K command palette. Keyboard-first: opens on Cmd/Ctrl-K
// (or Cmd/Ctrl-P) from anywhere on the page; closes on Escape or backdrop
// click. Arrow keys + Enter to select. Filter is a case-insensitive substring
// match on label + optional hint. Shared between admin / member / coach
// portals — items come from the parent so the palette can't drift out of
// sync with whatever nav the shell renders.
export function CommandPalette({
  items,
  placeholder = 'Jump to…',
  listLabel = 'Pages',
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset state and focus when the palette opens; pure callback (no effect
  // chain) so the React Compiler is happy and we don't double-render.
  const openPalette = useCallback(() => {
    setQuery('');
    setHighlight(0);
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);
  const closePalette = useCallback(() => setOpen(false), []);

  // Global key listener. Suppressed inside <input>/<textarea>/[contenteditable]
  // so typing the letter K in a form doesn't hijack to the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      if (!isEditable && (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K' || e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        if (open) closePalette();
        else openPalette();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, openPalette, closePalette]);

  const filtered = useMemo(() => filterCommandItems(items, query), [items, query]);
  // Derive the effective highlight at render time rather than clamping via
  // an effect — avoids the cascading-render React Compiler rule.
  const effectiveHighlight = clampHighlight(highlight, filtered.length);

  const onSelect = useCallback(
    (item: CommandItem) => {
      closePalette();
      router.push(item.href);
    },
    [router, closePalette],
  );

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(Math.min(effectiveHighlight + 1, filtered.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(Math.max(effectiveHighlight - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const target = filtered[effectiveHighlight];
      if (target) onSelect(target);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="gf-cmdk-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) closePalette();
      }}
    >
      <div className="gf-cmdk">
        <div className="gf-cmdk-search">
          <Search size={16} strokeWidth={2} aria-hidden />
          <input
            ref={inputRef}
            type="text"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            aria-label={`Search ${listLabel.toLowerCase()}`}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="gf-cmdk-kbd">esc</kbd>
        </div>

        {filtered.length === 0 ? (
          <div className="gf-cmdk-empty">No matches for &ldquo;{query}&rdquo;</div>
        ) : (
          <ul className="gf-cmdk-list" role="listbox" aria-label={listLabel}>
            {filtered.map((item, idx) => {
              const Icon = item.icon;
              const active = idx === effectiveHighlight;
              return (
                <li key={item.href}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`gf-cmdk-item${active ? ' active' : ''}`}
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => onSelect(item)}
                  >
                    <span className="gf-cmdk-item-icon" aria-hidden>
                      <Icon size={16} strokeWidth={2} />
                    </span>
                    <span className="gf-cmdk-item-label">{item.label}</span>
                    {item.hint ? <span className="gf-cmdk-item-hint">{item.hint}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="gf-cmdk-footer">
          <span><kbd className="gf-cmdk-kbd">↑</kbd> <kbd className="gf-cmdk-kbd">↓</kbd> navigate</span>
          <span><kbd className="gf-cmdk-kbd">↵</kbd> open</span>
          <span><kbd className="gf-cmdk-kbd">⌘ K</kbd> toggle</span>
        </div>
      </div>
    </div>
  );
}
