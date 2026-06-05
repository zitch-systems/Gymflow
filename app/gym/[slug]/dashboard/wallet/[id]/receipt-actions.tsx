'use client';

import { Download } from 'lucide-react';

// The browser's print dialog doubles as "save as PDF" — no server-side PDF
// generation needed for a member to keep a copy of their receipt.
export function ReceiptActions() {
  return (
    <button
      type="button"
      className="gf-btn gf-btn-secondary gf-btn-full"
      style={{ marginTop: 16 }}
      onClick={() => window.print()}
    >
      <Download size={16} strokeWidth={1.9} /> Download / print
    </button>
  );
}
