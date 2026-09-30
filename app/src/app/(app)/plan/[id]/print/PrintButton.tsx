'use client';

/** Opens the browser's print dialog, from which the user chooses Save as PDF. */
export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="btn btn-primary text-sm"
    >
      Print / Save as PDF
    </button>
  );
}
