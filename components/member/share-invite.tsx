'use client';

import { useState } from 'react';

// Referral "Invite" — opens the native share sheet (PWA-friendly) and falls
// back to copying the signup link.
export function ShareInvite({ gymName }: { gymName: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}/signup`;
    const text = `Join me at ${gymName} on GymFlow — sign up here:`;
    if (navigator.share) {
      try { await navigator.share({ title: `Join ${gymName}`, text, url }); return; } catch { /* cancelled */ }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  }

  return <button className="pill" onClick={share}>{copied ? 'Link copied!' : 'Invite'}</button>;
}
