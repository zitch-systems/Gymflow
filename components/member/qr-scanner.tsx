'use client';

import { useEffect, useInsertionEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

// Camera QR scanner overlay. Uses the native BarcodeDetector when available
// (Android/Chromium) and falls back to jsQR decoding canvas frames (iOS Safari,
// which lacks BarcodeDetector). Calls onDetected once with the decoded text.
export function QrScanner({ onDetected, onClose }: { onDetected: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // keep the latest callback without re-running the scanner effect — assigned
  // off-render (an insertion effect) so we never mutate a ref during render
  const cbRef = useRef(onDetected);
  useInsertionEffect(() => { cbRef.current = onDetected; });

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let raf = 0;
    let detected = false;
    const canvas = document.createElement('canvas');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const BD = (window as any).BarcodeDetector;
    const detector = BD ? new BD({ formats: ['qr_code'] }) : null;
    // jsQR (~55KB gzip) is only the fallback for browsers without a native
    // BarcodeDetector — load it lazily when the scanner opens, and only on
    // those browsers, so it never weighs down the /checkin tab switch. A
    // failed chunk load (offline, stale deploy) must surface as an error,
    // not spin the camera forever while every decode attempt silently throws.
    const jsQRP = detector
      ? null
      : import('jsqr').then((m) => m.default).catch(() => {
          if (!cancelled) setError('Couldn’t load the scanner. Check your connection and try again, or use “Tap to self check-in”.');
          return null;
        });

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
              const jsQR = await jsQRP!;
              if (!jsQR) return; // chunk failed to load — error state is showing
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

  return (
    <div className="qr-scan" role="dialog" aria-modal="true" aria-label="Scan check-in QR code">
      <button className="qr-scan-x" onClick={onClose} aria-label="Close scanner"><X strokeWidth={2} /></button>
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
