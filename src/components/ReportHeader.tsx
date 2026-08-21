import PrintButton from "@/components/PrintButton";

// Cabeçalho de relatório: título sempre visível + linha só de impressão com
// a empresa e a data de geração.
export default function ReportHeader({
  titulo, subtitulo, empresa,
}: { titulo: string; subtitulo?: string; empresa?: string }) {
  const agora = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  return (
    <div className="mb-5">
      <div className="print-only mb-3 border-b border-gray-300 pb-2">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span className="font-semibold text-gray-800">⚡ ERP Novaluz{empresa ? ` · ${empresa}` : ""}</span>
          <span>Gerado em {agora}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{titulo}</h1>
          {subtitulo && <p className="text-sm text-gray-500">{subtitulo}</p>}
        </div>
        <PrintButton />
      </div>
    </div>
  );
}
