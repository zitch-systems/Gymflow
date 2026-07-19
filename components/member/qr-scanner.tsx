'use client';

import { useEffect, useInsertionEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import jsQR from 'jsqr';

// Camera QR scanner overlay. Uses the native BarcodeDetector when available
// (Android/Chromium) and falls back to jsQR decoding canvas frames (iOS Safari,
// which lacks BarcodeDetector). Calls onDetected once with the decoded text.
export function QrScanner({ onDetected, onClose }: { onDetected: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Dialog chrome refs (WCAG 2.1.2/2.4.3) — the overlay's own container (to
  // query its currently-focusable elements for the Tab trap) and its close
  // button (the first focus stop on open).
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // keep the latest callbacks without re-running the effects below — assigned
  // off-render (an insertion effect) so we never mutate a ref during render
  const cbRef = useRef(onDetected);
  const onCloseRef = useRef(onClose);
  useInsertionEffect(() => { cbRef.current = onDetected; onCloseRef.current = onClose; });

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let raf = 0;
    let detected = false;
    const canvas = document.createElement('canvas');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const BD = (window as any).BarcodeDetector;
    const detector = BD ? new BD({ formats: ['qr_code'] }) : null;

    async function tick() {
      if (cancelled || detected) return;
      const v = videoRef.current;
      if (v && v.readyState >= 2 && v.videoWidth) {
        try {
          let text: string | null = null;
          if (detector) {
            const codes = await detector.detect(v);
            if (codes && codes.length) text = codes[0].rawValue;
          } else {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const res = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
              if (res) text = res.data;
            }
          }
          if (text) { detected = true; cbRef.current(text); return; }
        } catch {
          // transient decode error — keep scanning
        }
      }
      raf = requestAnimationFrame(tick);
    }

    async function start() {
      if (!window.isSecureContext) { setError('The camera needs a secure (https) connection.'); return; }
      if (!navigator.mediaDevices?.getUserMedia) { setError('This device or browser doesn’t support camera access.'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();
        raf = requestAnimationFrame(tick);
      } catch (e) {
        const name = (e as DOMException)?.name;
        setError(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? 'Camera permission was denied. Allow camera access in your browser settings, then try again.'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'No camera was found on this device.'
              : 'Could not start the camera. Use “Tap to check in” instead.',
        );
      }
    }

    start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Modal focus management (WCAG 2.1.2 no keyboard trap / 2.4.3 focus order):
  // move focus into the dialog on open, keep Tab cycling within it, close on
  // Escape, and restore focus to the trigger on unmount. Kept separate from the
  // camera effect (and reading callbacks off refs) so it runs exactly once.
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current(); return; }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // Wrap around the ends so keyboard focus can never leave the overlay.
      if (e.shiftKey && (active === first || !root.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prevFocus?.focus?.();
    };
  }, []);

  return (
    <div ref={dialogRef} className="qr-scan" role="dialog" aria-modal="true" aria-label="Scan check-in QR code">
      <button ref={closeBtnRef} className="qr-scan-x" onClick={onClose} aria-label="Close scanner"><X strokeWidth={2} /></button>
      {error ? (
        <div className="qr-scan-msg">
          <p>{error}</p>
          <button className="gf-btn gf-btn-secondary" onClick={onClose}>Close</button>
        </div>
      ) : (
        <>
          <video ref={videoRef} className="qr-scan-video" playsInline muted />
          <div className="qr-scan-frame" aria-hidden />
          <p className="qr-scan-hint">Point at the gym’s check-in QR code</p>
        </>
      )}
    </div>
  );
}
