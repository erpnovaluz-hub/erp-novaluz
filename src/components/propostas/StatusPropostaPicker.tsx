"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePode } from "@/components/AcessoProvider";
import Badge from "@/components/Badge";
import { getEntity } from "@/lib/entities";

const STATUS = getEntity("propostas")!.fields.find((f) => f.key === "status")!.options!;
const FLUXO = ["rascunho", "enviada", "aprovada"];
const COR_ATIVO: Record<string, string> = {
  rascunho: "bg-gray-700 text-white", enviada: "bg-blue-600 text-white",
  aprovada: "bg-green-600 text-white", recusada: "bg-red-600 text-white",
};
const rotulo = (s: string) => STATUS.find((x) => x.value === s)?.label ?? s;

// Troca de status da proposta em um toque. "barra" (tela da proposta) ou "menu" (selo clicável na lista).
export default function StatusPropostaPicker({ prop, variante, onChange }: {
  prop: { id: string; status: string }; variante: "barra" | "menu"; onChange: (novo: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const podeEditar = usePode("comercial", "editar");
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  async function escolher(s: string) {
    setAberto(false);
    if (s === prop.status || !podeEditar) return;
    if (s === "recusada" && !confirm("Marcar esta proposta como recusada?")) return;
    setSalvando(true); setErro(null);
    const { error } = await supabase.from("propostas").update({ status: s }).eq("id", prop.id);
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onChange(s);
  }

  if (variante === "menu") {
    return (
      <div ref={ref} className="relative inline-block" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
        <button type="button" disabled={!podeEditar || salvando} onClick={() => setAberto((v) => !v)}
          className={`rounded-full ${podeEditar ? "cursor-pointer hover:ring-2 hover:ring-brand-200" : "cursor-default"}`}
          title={podeEditar ? "Mudar status" : undefined} aria-haspopup="menu" aria-expanded={aberto}>
          <Badge value={prop.status} options={STATUS} />{podeEditar && <span className="ml-0.5 text-[10px] text-gray-400">▾</span>}
        </button>
        {aberto && (
          <ul role="menu" className="absolute right-0 z-30 mt-1 w-40 overflow-hidden rounded-lg border bg-white py-1 text-left text-sm shadow-lg">
            {STATUS.map((s) => (
              <li key={s.value}>
                <button type="button" role="menuitem" onClick={() => escolher(s.value)}
                  className={`flex w-full items-center gap-2 px-3 py-2 hover:bg-gray-50 ${s.value === prop.status ? "font-semibold text-brand-700" : "text-gray-700"}`}>
                  {s.value === prop.status ? "●" : "○"} {s.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {erro && <p className="absolute right-0 z-30 mt-1 w-56 rounded bg-red-50 p-2 text-xs text-red-700 shadow">{erro}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="abas-rolaveis flex items-center gap-1 rounded-xl bg-gray-100 p-1">
        {FLUXO.map((s, i) => (
          <div key={s} className="flex items-center">
            {i > 0 && <span className="px-0.5 text-gray-300">›</span>}
            <button type="button" disabled={!podeEditar || salvando} onClick={() => escolher(s)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${prop.status === s ? COR_ATIVO[s] : podeEditar ? "text-gray-600 hover:bg-white" : "text-gray-400"}`}>
              {s === "aprovada" ? "✓ " : ""}{rotulo(s)}
            </button>
          </div>
        ))}
        <span className="px-1 text-gray-300">|</span>
        <button type="button" disabled={!podeEditar || salvando} onClick={() => escolher("recusada")}
          className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition ${prop.status === "recusada" ? COR_ATIVO.recusada : podeEditar ? "text-gray-500 hover:bg-white hover:text-red-600" : "text-gray-400"}`}>
          ✕ {rotulo("recusada")}
        </button>
      </div>
      {erro && <p className="mt-1 text-sm text-red-600">{erro}</p>}
    </div>
  );
}
