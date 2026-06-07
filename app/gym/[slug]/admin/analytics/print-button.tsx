'use client';

export function PrintAnalyticsButton() {
  return (
    <button
      type="button"
      className="gf-btn gf-btn-ghost gf-btn-sm"
      onClick={() => window.print()}
    >
      Download PDF
    </button>
  );
}
