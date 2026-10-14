"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePode } from "@/components/AcessoProvider";
import { formatDateTime } from "@/lib/format";
import { useEquipe } from "@/components/tarefas/comum";

type Item = { id: string; item: string; ordem: number; feito: boolean; feito_por: string | null; feito_em: string | null };

// Checklist de execução da OS. Itens à mão ou copiados de um modelo (os mesmos das tarefas).
export default function OSChecklist({ osId }: { osId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const podeEditar = usePode("os", "editar");
  const { porId } = useEquipe();
  const [itens, setItens] = useState<Item[]>([]);
  const [modelos, setModelos] = useState<{ id: string; nome: string }[]>([]);
  const [novo, setNovo] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("os_checklist").select("*").eq("os_id", osId).order("ordem").order("item");
    setItens((data ?? []) as Item[]);
  }, [supabase, osId]);
  useEffect(() => {
    carregar();
    supabase.from("modelos_projeto").select("id, nome").order("nome").then(({ data }) => setModelos(data ?? []));
  }, [supabase, carregar]);

  const proxOrdem = () => Math.max(0, ...itens.map((i) => i.ordem)) + 1;

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    if (!novo.trim()) return;
    const { error } = await supabase.from("os_checklist").insert({ os_id: osId, item: novo.trim(), ordem: proxOrdem() });
    if (error) { setErro(error.message); return; }
    setNovo(""); carregar();
  }

  async function doModelo(modeloId: string) {
    if (!modeloId) return;
    const { data } = await supabase.from("modelos_tarefa").select("titulo, ordem").eq("modelo_id", modeloId).order("ordem");
    const base = proxOrdem();
    const novos = (data ?? []).map((t: any, k: number) => ({ os_id: osId, item: t.titulo, ordem: base + k }));
    if (!novos.length) { setErro("Esse modelo não tem itens."); return; }
    const { error } = await supabase.from("os_checklist").insert(novos);
    if (error) { setErro(error.message); return; }
    setErro(null); carregar();
  }

  async function marcar(i: Item) {
    setItens((l) => l.map((x) => (x.id === i.id ? { ...x, feito: !x.feito } : x)));
    const { error } = await supabase.from("os_checklist").update({ feito: !i.feito }).eq("id", i.id);
    if (error) setErro(error.message);
    carregar();
  }

  async function excluir(i: Item) {
    await supabase.from("os_checklist").delete().eq("id", i.id);
    carregar();
  }

  const feitos = itens.filter((i) => i.feito).length;

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">☑️ Checklist de execução · {feitos}/{itens.length}</h2>
        {podeEditar && modelos.length > 0 && (
          <select className="inp w-auto py-1 text-xs" value="" onChange={(e) => doModelo(e.target.value)}>
            <option value="">+ carregar de modelo…</option>
            {modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        )}
      </div>
      {erro && <p className="mb-2 text-sm text-red-600">{erro}</p>}
      <div className="card overflow-hidden">
        {itens.length > 0 && (
          <div className="h-1 bg-gray-100"><div className="h-1 bg-green-500" style={{ width: `${(feitos / itens.length) * 100}%` }} /></div>
        )}
        <ul className="divide-y divide-gray-100 text-sm">
          {itens.map((i) => (
            <li key={i.id} className="group flex items-center gap-3 px-4 py-2.5">
              <input type="checkbox" className="h-5 w-5 shrink-0 rounded" checked={i.feito} disabled={!podeEditar} onChange={() => marcar(i)} />
              <span className={`min-w-0 flex-1 ${i.feito ? "text-gray-400 line-through" : "text-gray-800"}`}>{i.item}</span>
              {i.feito && i.feito_em && (
                <span className="hidden text-[11px] text-gray-400 sm:inline">
                  {i.feito_por ? (porId[i.feito_por]?.nome || "").split(" ")[0] : ""} · {formatDateTime(i.feito_em)}
                </span>
              )}
              {podeEditar && <button className="text-xs text-gray-300 opacity-0 hover:text-red-500 group-hover:opacity-100" onClick={() => excluir(i)}>excluir</button>}
            </li>
          ))}
          {podeEditar && (
            <li>
              <form onSubmit={adicionar} className="flex items-center gap-2 px-4 py-2">
                <span className="text-gray-300">+</span>
                <input className="flex-1 border-0 p-1 text-sm focus:ring-0" placeholder="Adicionar item (Enter)" value={novo} onChange={(e) => setNovo(e.target.value)} />
              </form>
            </li>
          )}
          {!podeEditar && itens.length === 0 && <li className="px-4 py-5 text-center text-gray-400">Sem checklist.</li>}
        </ul>
      </div>
    </section>
  );
}
