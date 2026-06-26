'use client';

import { useEffect } from 'react';

// When a member opens the INSTALLED app (display-mode: standalone), request
// camera permission once so QR check-in is instant later. Stops the stream
// immediately — we only want the grant. No-op in a normal browser tab, on
// repeat opens (localStorage flag), or where the camera/API is unavailable.
export function CameraPrime() {
  useEffect(() => {
    try {
      const standalone =
        window.matchMedia?.('(display-mode: standalone)').matches ||
        // iOS Safari
        (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (!standalone) return;
      if (localStorage.getItem('gf-cam-primed')) return;
      if (!navigator.mediaDevices?.getUserMedia) return;
      localStorage.setItem('gf-cam-primed', '1');
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: 'environment' } })
        .then((stream) => stream.getTracks().forEach((t) => t.stop()))
        .catch(() => { /* denied / needs gesture — the on-demand scanner still prompts */ });
    } catch {
      // ignore
    }
  }, []);
  return null;
}
