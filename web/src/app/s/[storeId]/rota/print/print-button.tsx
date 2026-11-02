"use client";

export function PrintButton() {
  return (
    <button className="btn-secondary no-print" onClick={() => window.print()}>
      Print
    </button>
  );
}
