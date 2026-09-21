import PrintButton from "@/components/PrintButton";
import ReportPrintHeader from "@/components/ReportPrintHeader";

// Cabeçalho de relatório: título na tela + cabeçalho padrão só na impressão
// (marca Novaluz, título, "Emitido em…"), seguindo o padrão do Lote.
export default function ReportHeader({
  titulo, subtitulo, empresa, periodo,
}: { titulo: string; subtitulo?: string; empresa?: string; periodo?: string }) {
  return (
    <div className="mb-5">
      <ReportPrintHeader titulo={titulo} subtitulo={subtitulo} periodo={periodo} empresa={empresa} />
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{titulo}</h1>
          {subtitulo && <p className="text-sm text-gray-500">{subtitulo}</p>}
        </div>
        <PrintButton />
      </div>
    </div>
  );
}
