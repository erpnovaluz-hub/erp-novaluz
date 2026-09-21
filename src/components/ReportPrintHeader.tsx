/* Cabeçalho padrão de impressão dos relatórios (só aparece no PDF/impressão).
   Segue o padrão do "Lote de Pagamento": marca Novaluz, título, "Emitido em…"
   e uma régua embaixo. Use junto do CSS global .card de impressão. */
export default function ReportPrintHeader({
  titulo, subtitulo, periodo, empresa = "Novaluz",
}: { titulo: string; subtitulo?: string; periodo?: string; empresa?: string }) {
  const agora = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const meta = ["Emitido em " + agora, periodo].filter(Boolean).join(" · ");
  return (
    <div className="print-only doc mb-4 border-b border-gray-300 pb-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-700">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-novaluz.png" alt="" className="h-5 w-auto" />
          {empresa}
        </span>
        <span className="text-xs text-gray-500">{meta}</span>
      </div>
      <h1 className="text-lg font-bold text-gray-900">{titulo}</h1>
      {subtitulo && <p className="text-xs text-gray-500">{subtitulo}</p>}
    </div>
  );
}
