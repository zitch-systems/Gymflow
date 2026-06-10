'use client';

import { useState } from 'react';
import { Link2, Check } from 'lucide-react';

// Copies the gym's public join link (/join/<slug>) — how members create their
// own accounts. Lives in the admin members toolbar.
export function InviteLinkButton({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/join/${encodeURIComponent(slug)}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  }
  return (
    <button type="button" className="gf-btn gf-btn-secondary gf-btn-sm" onClick={copy} title="Copy the public link members use to create their account">
      {copied ? <Check strokeWidth={2} size={15} /> : <Link2 strokeWidth={1.9} size={15} />} {copied ? 'Copied!' : 'Invite link'}
    </button>
  );
}
