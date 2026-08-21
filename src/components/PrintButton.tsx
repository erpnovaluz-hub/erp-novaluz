"use client";

export default function PrintButton({ label = "Imprimir / Salvar PDF" }: { label?: string }) {
  return (
    <button className="no-print btn-ghost text-sm ring-1 ring-gray-200" onClick={() => window.print()}>
      🖨️ {label}
    </button>
  );
}
