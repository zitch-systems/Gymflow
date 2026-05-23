'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { checkInBySlug } from '@/lib/actions/checkin';
import { useToast } from '@/lib/toast';

export function StaffCheckInForm({ slug, defaultMember }: { slug: string; defaultMember: string }) {
  const [memberId, setMemberId] = useState(defaultMember);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <form
      className="gf-form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await checkInBySlug(slug, memberId.trim(), { method: 'manual' });
          if (res.ok) {
            toast(
              `${res.memberName} checked in${res.daysLeft != null ? ` · ${res.daysLeft}d left` : ' · no active plan'}`,
              'success',
            );
            setMemberId('');
            router.refresh();
          } else {
            toast(res.error, 'error');
          }
        });
      }}
    >
      <label className="gf-form-label" htmlFor="member-id">
        Member ID (UUID or scan QR)
      </label>
      <div className="gf-input-group">
        <input
          id="member-id"
          name="member"
          className="gf-input"
          placeholder="Paste member ID or scan"
          autoComplete="off"
          autoFocus
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
          required
        />
      </div>
      <button type="submit" disabled={pending || !memberId.trim()} className="gf-btn gf-btn-primary gf-btn-full">
        {pending ? 'Checking in…' : 'Check in'}
      </button>
    </form>
  );
}
