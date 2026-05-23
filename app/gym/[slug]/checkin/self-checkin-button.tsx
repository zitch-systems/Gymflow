'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { selfCheckIn, selfCheckInByQrPayload } from '@/lib/actions/checkin';
import { useToast } from '@/lib/toast';

export function SelfCheckInButton({ slug }: { slug: string }) {
  const [pending, start] = useTransition();
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const toast = useToast();
  const router = useRouter();

  function handleResult(res: Awaited<ReturnType<typeof selfCheckIn>>) {
    if (res.ok) {
      toast(
        res.daysLeft != null
          ? `Checked in! ${res.daysLeft} days left on your plan.`
          : `Checked in! Note: no active plan on file.`,
        'success',
      );
      router.refresh();
    } else {
      toast(res.error, 'error');
    }
  }

  async function stopScanner() {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        // already stopped
      }
      scannerRef.current = null;
    }
    setScanning(false);
  }

  async function startScanner() {
    setScanning(true);
    try {
      const mod = await import('html5-qrcode');
      // wait one tick so the #qr-reader div is in the DOM
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const scanner = new mod.Html5Qrcode('qr-reader');
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        async (decoded) => {
          await stopScanner();
          start(async () => {
            const res = await selfCheckInByQrPayload(slug, decoded);
            handleResult(res);
          });
        },
        () => {
          // per-frame failure callback — silent
        },
      );
    } catch (err) {
      toast((err as Error).message || 'Could not open camera', 'error');
      setScanning(false);
    }
  }

  useEffect(() => () => void stopScanner(), []); // unmount cleanup

  if (scanning) {
    return (
      <div>
        <div id="qr-reader" style={{ width: '100%', maxWidth: 360, margin: '0 auto', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--gf-border)' }} />
        <button type="button" className="gf-btn gf-btn-ghost gf-btn-full" onClick={stopScanner} style={{ marginTop: 12 }}>
          Cancel scan
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button
        type="button"
        className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg"
        disabled={pending}
        onClick={startScanner}
      >
        {pending ? 'Checking in…' : '📷 Scan gym QR'}
      </button>
      <button
        type="button"
        className="gf-btn gf-btn-ghost gf-btn-full"
        disabled={pending}
        onClick={() => start(async () => handleResult(await selfCheckIn(slug)))}
      >
        Or check me in without scanning
      </button>
    </div>
  );
}
