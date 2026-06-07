'use client';

import { useToast } from '@/lib/toast';

type Props = {
  gymName: string;
  signupUrl: string;
  className?: string;
  children?: React.ReactNode;
};

export function ReferShareButton({ gymName, signupUrl, className, children }: Props) {
  const toast = useToast();

  async function onClick() {
    const shareText = `Join ${gymName} on GymFlow — first month gets you ₦5,000 off when you sign up via my link: ${signupUrl}`;
    const data: ShareData = {
      title: `Join ${gymName}`,
      text: shareText,
      url: signupUrl,
    };

    // Prefer the native share sheet (iOS / Android / Edge). It composes
    // a single share intent across SMS, WhatsApp, email, etc. — the right
    // primitive for a referral send.
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share(data);
        return;
      } catch (err) {
        // AbortError = user cancelled the sheet; not an error.
        if ((err as Error)?.name === 'AbortError') return;
        // Anything else (sometimes Edge throws on http: pages, Safari on
        // permissions) falls through to the clipboard path.
      }
    }

    // Fallback: copy to clipboard.
    try {
      await navigator.clipboard.writeText(shareText);
      toast('Invite link copied to clipboard', 'success');
    } catch {
      toast('Could not access the share sheet. Try long-pressing the link instead.', 'warning');
    }
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {children ?? 'Share'}
    </button>
  );
}
