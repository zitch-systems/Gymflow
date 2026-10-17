'use client';

import { useState } from 'react';

// Referral "Invite" — opens the native share sheet (PWA-friendly) and falls
// back to copying the gym's join link (where a friend can create a member
// account linked to this gym — NOT /signup, which creates gym owners).
export function ShareInvite({ gymName, gymSlug }: { gymName: string; gymSlug: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function share() {
    setError(null);
    const url = `${window.location.origin}/join/${encodeURIComponent(gymSlug)}`;
    const text = `Join me at ${gymName} on GymFlow — sign up here:`;
    if (navigator.share) {
      try { await navigator.share({ title: `Join ${gymName}`, text, url }); return; }
      catch (cause) { if (cause instanceof Error && cause.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setError('Could not copy the invite. Please share your gym’s join link from the browser.'); }
  }

  return <div><button type="button" className="pill" onClick={share}>{copied ? 'Link copied!' : 'Invite'}</button>{error && <p role="alert" style={{ fontSize: '0.75rem', maxWidth: '22ch' }}>{error}</p>}</div>;
}
