import type { ReactNode } from 'react';

type Tone = 'on' | 'off' | 'warn' | 'info' | 'neutral';

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const cls = tone === 'on' ? 'on'
    : tone === 'off' ? 'off'
    : tone === 'warn' ? 'warn'
    : tone === 'info' ? 'info'
    : 'neutral';
  return <span className={`status-pill ${cls}`}>{children}</span>;
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`gf-badge gf-badge-${tone}`}>{children}</span>;
}
