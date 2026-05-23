'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveWaiver } from '@/lib/actions/waiver';
import { useToast } from '@/lib/toast';

type Props = { slug: string; defaultTitle: string; defaultContent: string; defaultVersion: string };

export function WaiverForm({ slug, defaultTitle, defaultContent, defaultVersion }: Props) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          await saveWaiver(slug, fd);
          toast('Waiver saved · previous version archived', 'success');
          router.refresh();
        });
      }}
    >
      <div className="gf-form-group form-grid-full">
        <label className="gf-label" htmlFor="w-title">
          Title
        </label>
        <input id="w-title" name="title" defaultValue={defaultTitle} className="gf-input" />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="w-version">
          Version
        </label>
        <input id="w-version" name="version" defaultValue={defaultVersion} className="gf-input" />
      </div>
      <div className="gf-form-group form-grid-full">
        <label className="gf-label" htmlFor="w-content">
          Content (members will see this verbatim)
        </label>
        <textarea
          id="w-content"
          name="content"
          rows={12}
          defaultValue={defaultContent}
          className="gf-input"
          required
        />
      </div>
      <button type="submit" disabled={pending} className="gf-btn gf-btn-primary">
        {pending ? 'Saving…' : 'Save & publish new version'}
      </button>
    </form>
  );
}
