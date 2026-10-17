'use client';

import { useState } from 'react';
import { Share2, Check } from 'lucide-react';

export function ShareReceiptButton({ summary }: { summary: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);

  async function share() {
    setError(false);
    if (navigator.share) {
      try { await navigator.share({ title: 'GymFlow receipt', text: summary }); return; }
      catch (cause) { if (cause instanceof Error && cause.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(summary); setCopied(true); }
    catch { setError(true); }
  }

  return <div style={{ position: 'relative' }}>
    <button type="button" className="icon-btn" style={{ width: 34, height: 34 }} onClick={share} aria-label={copied ? 'Receipt copied' : 'Share receipt'}>
      {copied ? <Check strokeWidth={1.9} /> : <Share2 strokeWidth={1.9} />}
    </button>
    {copied && <span role="status" className="sr-only">Receipt copied to clipboard.</span>}
    {error && <p role="alert" style={{ position: 'absolute', right: 0, width: 220, zIndex: 2, padding: 12, background: 'var(--gf-surface)', border: '1px solid var(--gf-border)', borderRadius: 8, fontSize: '0.8rem' }}>Sharing is unavailable. Use Download PDF below to save your receipt.</p>}
  </div>;
}
