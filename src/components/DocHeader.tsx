import { EMISSORA } from "@/lib/empresa";

// Cabeçalho padrão de documentos (proposta, pedido, OS).
export default function DocHeader({ titulo, numero, subtitulo }: { titulo: string; numero?: string; subtitulo?: string }) {
  return (
    <div className="flex items-start justify-between border-b-2 border-brand-600 pb-4">
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={EMISSORA.logo} alt="logo" className="mb-2 h-12 object-contain" />
        <p className="text-xs text-gray-500">{EMISSORA.nome} · CNPJ {EMISSORA.cnpj}</p>
        <p className="text-xs text-gray-500">{EMISSORA.endereco} · Tel {EMISSORA.telefone}</p>
      </div>
      <div className="text-right">
        <h1 className="text-lg font-bold text-brand-700">{titulo}</h1>
        {numero && <p className="text-sm text-gray-500">Nº {numero}</p>}
        {subtitulo && <p className="mt-1 text-xs text-gray-400">{subtitulo}</p>}
      </div>
    </div>
  );
}
