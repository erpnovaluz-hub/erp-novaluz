"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useEmissora } from "@/lib/useEmissora";
import QrCode from "@/components/ferramentas/QrCode";
import { urlEtiqueta } from "@/lib/ferramentas";

// Folha A4 de etiquetas (3 colunas). Recorte e cole, ou use papel adesivo A4.
export default function Etiquetas() {
  const supabase = useMemo(() => createClient(), []);
  const params = useSearchParams();
  const EMISSORA = useEmissora();
  const [itens, setItens] = useState<{ id: string; codigo: string; descricao: string }[]>([]);
  const [copias, setCopias] = useState(1);

  useEffect(() => {
    const ids = (params.get("ids") ?? "").split(",").filter(Boolean);
    if (!ids.length) return;
    supabase.from("ferramentas").select("id, codigo, descricao").in("id", ids).order("codigo")
      .then(({ data }) => setItens(data ?? []));
  }, [supabase, params]);

  const folha = itens.flatMap((f) => Array.from({ length: copias }, (_, k) => ({ ...f, k })));

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-3">
        <Link href="/estoque/ferramentas" className="text-sm text-gray-500 hover:text-gray-800">← ferramentas</Link>
        <span className="text-sm text-gray-600">{itens.length} ferramenta(s)</span>
        <label className="flex items-center gap-2 text-sm">cópias de cada
          <input type="number" min={1} max={10} className="inp w-16 py-1" value={copias} onChange={(e) => setCopias(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
        </label>
        <button className="btn-primary ml-auto text-sm" onClick={() => window.print()}>🖨️ Imprimir etiquetas</button>
      </div>
      <p className="no-print text-xs text-gray-500">Dica: imprima em papel adesivo A4 em 100% de escala (sem “ajustar à página”). A câmera do celular lê o QR e abre a ferramenta.</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 print:grid-cols-3 print:gap-[2mm]">
        {folha.map((f) => (
          <div key={`${f.id}-${f.k}`} className="flex break-inside-avoid items-center gap-2 rounded-md border border-gray-300 bg-white p-2 print:h-[34mm] print:rounded-none print:border-dashed">
            <QrCode texto={urlEtiqueta(f.codigo)} tamanho={80} />
            <div className="min-w-0">
              <p className="font-mono text-base font-bold leading-tight text-gray-900">{f.codigo}</p>
              <p className="line-clamp-2 text-[11px] leading-tight text-gray-700">{f.descricao}</p>
              <p className="mt-0.5 truncate text-[9px] text-gray-400">{EMISSORA.nome} · patrimônio</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
