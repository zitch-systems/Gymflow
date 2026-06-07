'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { platformSetGymStatus, platformImpersonate } from '@/lib/actions/platform';
import { useToast } from '@/lib/toast';

export function SuperadminGymRowActions({ gymId, slug, ownerEmail, status }: { gymId: string; slug: string; ownerEmail: string; status: string }) {
  const [pending, start] = useTransition();
  const [magicLink, setMagicLink] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <a className="gf-btn gf-btn-ghost gf-btn-sm" href={`https://${slug}.gymflow.ng/admin/dashboard`} target="_blank" rel="noreferrer">
        Open
      </a>
      <button
        type="button"
        className="gf-btn gf-btn-ghost gf-btn-sm"
        disabled={pending || !ownerEmail}
        onClick={() =>
          start(async () => {
            const r = await platformImpersonate(ownerEmail);
            if (r.ok && r.magicLink) {
              setMagicLink(r.magicLink);
              if (navigator.clipboard) {
                try {
                  await navigator.clipboard.writeText(r.magicLink);
                  toast('Magic link copied to clipboard', 'success');
                } catch {
                  toast('Magic link generated (shown below)', 'success');
                }
              } else {
                toast('Magic link generated', 'success');
              }
            } else {
              toast(r.error ?? 'Failed', 'error');
            }
          })
        }
      >
        Impersonate
      </button>
      <button
        type="button"
        className="gf-btn gf-btn-ghost gf-btn-sm"
        disabled={pending}
        onClick={() => {
          const next = status === 'suspended' ? 'active' : 'suspended';
          if (!confirm(`${next === 'suspended' ? 'Suspend' : 'Re-activate'} ${slug}?`)) return;
          start(async () => {
            const r = await platformSetGymStatus(gymId, next);
            if (r.ok) {
              toast(`Gym ${next}`, 'success');
              router.refresh();
            } else {
              toast(r.error ?? 'Failed', 'error');
            }
          });
        }}
      >
        {status === 'suspended' ? 'Unsuspend' : 'Suspend'}
      </button>

      {magicLink && (
        <div style={{ marginLeft: 8, fontSize: 11, color: 'var(--gf-text-muted)' }}>
          <a href={magicLink} className="gf-link">open link</a>
        </div>
      )}
    </div>
  );
}
