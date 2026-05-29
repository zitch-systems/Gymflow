'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ScanLine } from 'lucide-react';
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
    // Guard the React 19 / StrictMode double-mount and a user racing the
    // click — a second start would try to attach Html5Qrcode to the same
    // #qr-reader div and fight for the camera.
    if (scannerRef.current) return;
    setScanning(true);
    try {
      const mod = await import('html5-qrcode');
      // If something stopped us during the async import, bail.
      if (scannerRef.current) return;
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
      // Most common: user denied the camera prompt, or the device has no
      // camera. Toast it and fall back to the button view so they can still
      // use "check in without scanning".
      toast((err as Error).message || 'Could not open camera', 'error');
      setScanning(false);
    }
  }

  // Auto-open the camera as soon as the page loads — the whole point of the
  // bottom-nav Check In tab is "scan to check in". On denial / no-camera the
  // catch block above reverts to the button view, which still works. The
  // setScanning(true) inside startScanner is the legitimate "kick off an
  // external system" pattern the React Compiler rule documents an exception
  // for.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void startScanner();
    return () => void stopScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (scanning) {
    return (
      <div>
        <div id="qr-reader" style={{ width: '100%', maxWidth: 360, margin: '0 auto', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--gf-border)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="gf-btn gf-btn-ghost gf-btn-full"
            disabled={pending}
            onClick={() => {
              start(async () => {
                await stopScanner();
                handleResult(await selfCheckIn(slug));
              });
            }}
          >
            {pending ? 'Checking in…' : "Can't see the QR? Check in without scanning"}
          </button>
          <button type="button" className="gf-btn gf-btn-ghost gf-btn-full" onClick={stopScanner}>
            Cancel
          </button>
        </div>
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
        {pending ? 'Checking in…' : (
          <>
            <ScanLine size={18} strokeWidth={1.75} /> Scan gym QR
          </>
        )}
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
