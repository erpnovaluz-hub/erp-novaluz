"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePode } from "@/components/AcessoProvider";
import Badge from "@/components/Badge";
import { STATUS_OS } from "@/lib/os";
import PausaModal from "@/components/os/PausaModal";

const FLUXO = ["orcamento", "a_fazer", "em_andamento", "pausada", "concluido"];
const COR_ATIVO: Record<string, string> = {
  orcamento: "bg-purple-600 text-white", a_fazer: "bg-gray-700 text-white", em_andamento: "bg-blue-600 text-white",
  pausada: "bg-amber-500 text-white", concluido: "bg-green-600 text-white", faturada: "bg-green-700 text-white", cancelado: "bg-gray-500 text-white",
};
const rotulo = (s: string) => STATUS_OS.find((x) => x.value === s)?.label ?? s;

// Troca de status em um toque. variante "barra" (tela da OS) ou "menu" (selo clicável na lista/quadro).
// Regras: pausar pede motivo; cancelar confirma; "faturada" só pelo painel Faturar.
export default function StatusOSPicker({ os, variante, onChange }: {
  os: { id: string; status: string; numero?: string | null; titulo?: string }; variante: "barra" | "menu"; onChange: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const podeEditar = usePode("os", "editar");
  const [aberto, setAberto] = useState(false);
  const [pausar, setPausar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  async function salvar(campos: Record<string, any>) {
    setSalvando(true); setErro(null);
    const { error } = await supabase.from("ordens_servico").update(campos).eq("id", os.id);
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onChange();
  }

  function escolher(s: string) {
    setAberto(false);
    if (s === os.status || !podeEditar) return;
    if (s === "pausada") { setPausar(true); return; }
    if (s === "faturada") { setErro("Para faturar, use o painel 💵 Faturar da OS concluída."); return; }
    if (s === "cancelado" && !confirm("Cancelar esta OS?")) return;
    if (os.status === "faturada" && !confirm("Esta OS já foi faturada. Mudar o status mesmo assim? (os títulos a receber continuam)")) return;
    salvar({ status: s });
  }

  const modal = pausar && (
    <PausaModal titulo={`${os.numero ?? ""} ${os.titulo ?? ""}`} onCancelar={() => setPausar(false)}
      onConfirmar={(m, o) => { setPausar(false); salvar({ status: "pausada", motivo_pausa: m, pausa_obs: o || null }); }} />
  );

  if (variante === "menu") {
    return (
      <div ref={ref} className="relative inline-block" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
        <button type="button" disabled={!podeEditar || salvando} onClick={() => setAberto((v) => !v)}
          className={`rounded-full ${podeEditar ? "cursor-pointer hover:ring-2 hover:ring-brand-200" : "cursor-default"}`}
          title={podeEditar ? "Mudar status" : undefined} aria-haspopup="menu" aria-expanded={aberto}>
          <Badge value={os.status} options={STATUS_OS} />{podeEditar && <span className="ml-0.5 text-[10px] text-gray-400">▾</span>}
        </button>
        {aberto && (
          <ul role="menu" className="absolute right-0 z-30 mt-1 w-48 overflow-hidden rounded-lg border bg-white py-1 text-left text-sm shadow-lg">
            {STATUS_OS.filter((s) => s.value !== "faturada").map((s) => (
              <li key={s.value}>
                <button type="button" role="menuitem" onClick={() => escolher(s.value)}
                  className={`flex w-full items-center gap-2 px-3 py-2 hover:bg-gray-50 ${s.value === os.status ? "font-semibold text-brand-700" : "text-gray-700"}`}>
                  {s.value === os.status ? "●" : "○"} {s.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {erro && <p className="absolute right-0 z-30 mt-1 w-56 rounded bg-red-50 p-2 text-xs text-red-700 shadow">{erro}</p>}
        {modal}
      </div>
    );
  }

  // barra: fluxo principal em botões + cancelar à parte
  return (
    <div>
      <div className="abas-rolaveis flex items-center gap-1 rounded-xl bg-gray-100 p-1">
        {FLUXO.map((s, i) => {
          const ativo = os.status === s;
          return (
            <div key={s} className="flex items-center">
              {i > 0 && <span className="px-0.5 text-gray-300">›</span>}
              <button type="button" disabled={!podeEditar || salvando} onClick={() => escolher(s)}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${ativo ? COR_ATIVO[s] : podeEditar ? "text-gray-600 hover:bg-white" : "text-gray-400"}`}>
                {s === "pausada" ? "⏸ " : s === "concluido" ? "✓ " : ""}{rotulo(s)}
              </button>
            </div>
          );
        })}
        {(os.status === "faturada" || os.status === "cancelado") && (
          <span className={`ml-1 rounded-lg px-3 py-2 text-sm font-medium ${COR_ATIVO[os.status]}`}>{rotulo(os.status)}</span>
        )}
        {podeEditar && os.status !== "cancelado" && (
          <button type="button" onClick={() => escolher("cancelado")} className="ml-auto shrink-0 px-2 py-2 text-xs text-gray-400 hover:text-red-600">cancelar OS</button>
        )}
      </div>
      {erro && <p className="mt-1 text-sm text-red-600">{erro}</p>}
      {modal}
    </div>
  );
}
