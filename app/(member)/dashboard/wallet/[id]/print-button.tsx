'use client';

import { Download } from 'lucide-react';

// Browser print-to-PDF for the receipt. Print CSS (globals.css @media print)
// hides everything but the .receipt card.
export function PrintReceiptButton() {
  return (
    <button type="button" onClick={() => window.print()} className="gf-btn gf-btn-secondary gf-btn-full no-print">
      <Download strokeWidth={1.9} style={{ width: 16, height: 16 }} /> Download PDF
    </button>
  );
}
