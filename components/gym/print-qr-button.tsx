'use client';

import { Printer } from 'lucide-react';

export function PrintQrButton() {
  return (
    <button className="qr-print-button" type="button" onClick={() => window.print()}>
      <Printer aria-hidden="true" strokeWidth={2} />
      Print A4 poster
    </button>
  );
}
