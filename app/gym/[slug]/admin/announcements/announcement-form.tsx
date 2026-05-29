'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sendGymAnnouncement } from '@/lib/actions/announcements';
import { useToast } from '@/lib/toast';

export function AnnouncementForm({ slug, memberCount }: { slug: string; memberCount: number }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const [message, setMessage] = useState('');

  return (
    <form
      className="form-grid"
      style={{ padding: 18 }}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        if (!window.confirm(`Send this announcement to all ${memberCount} active member${memberCount === 1 ? '' : 's'}?`)) return;
        start(async () => {
          const r = await sendGymAnnouncement(slug, fd);
          if (r.ok) {
            toast(`Announcement sent to ${r.recipients} member${r.recipients === 1 ? '' : 's'}`, 'success');
            form.reset();
            setMessage('');
            router.refresh();
          } else {
            toast(r.error ?? 'Failed to send', 'error');
          }
        });
      }}
    >
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="subject">Subject <span className="req">*</span></label>
        <input id="subject" name="subject" className="gf-input" maxLength={120} required placeholder="Closed for public holiday on Monday" />
      </div>

      <div className="gf-form-group">
        <label className="gf-label" htmlFor="channel">Send via</label>
        <select id="channel" name="channel" className="gf-input" defaultValue="email">
          <option value="email">Email</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="both">Email + WhatsApp</option>
        </select>
        <p className="gf-form-hint">Members who opted out of a channel won&apos;t receive it.</p>
      </div>

      <div className="gf-form-group form-grid-full">
        <label className="gf-label" htmlFor="message">Message <span className="req">*</span></label>
        <textarea
          id="message"
          name="message"
          className="gf-input"
          rows={6}
          maxLength={2000}
          required
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Write your announcement here. Blank lines start a new paragraph."
        />
        <p className="gf-form-hint">{message.length}/2000</p>
      </div>

      <div className="form-grid-full" style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" className="gf-btn gf-btn-primary" disabled={pending || memberCount === 0}>
          {pending ? 'Sending…' : `Send to ${memberCount} member${memberCount === 1 ? '' : 's'}`}
        </button>
      </div>
    </form>
  );
}
