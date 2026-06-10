'use client';

import { useState } from 'react';

// Referral "Invite" — opens the native share sheet (PWA-friendly) and falls
// back to copying the gym's join link (where a friend can create a member
// account linked to this gym — NOT /signup, which creates gym owners).
export function ShareInvite({ gymName, gymSlug }: { gymName: string; gymSlug: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}/join/${encodeURIComponent(gymSlug)}`;
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
