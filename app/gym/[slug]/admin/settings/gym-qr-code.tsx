'use client';

import { useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';

export function GymQrCode({ value, downloadName }: { value: string; downloadName: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);

  function downloadPng() {
    const svg = wrapRef.current?.querySelector('svg');
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([xml], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const size = 1024;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => {
        if (!b) return;
        const link = document.createElement('a');
        link.href = URL.createObjectURL(b);
        link.download = `${downloadName}.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1500);
      }, 'image/png');
    };
    img.src = url;
  }

  return (
    <div ref={wrapRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ background: '#fff', padding: 12, borderRadius: 12, border: '1px solid var(--gf-border)' }}>
        <QRCodeSVG value={value} size={200} level="M" includeMargin={false} />
      </div>
      <button type="button" className="gf-btn gf-btn-ghost gf-btn-sm" onClick={downloadPng}>
        Download PNG
      </button>
    </div>
  );
}
