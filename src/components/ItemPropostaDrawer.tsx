"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/format";
import { FOTOS_PORTFOLIO } from "@/lib/empresa";

type Row = Record<string, any>;
type Prod = { id: string; nome: string; preco_sugerido: number; custo_direto: number };

export default function ItemPropostaDrawer({
  registro, propostaId, produtos, onClose, onSaved,
}: {
  registro: Row;
  propostaId: string;
  produtos: Prod[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const editando = !!registro?.id;
  const [f, setF] = useState<Row>({
    descricao: registro.descricao ?? "",
    referencia: registro.referencia ?? "",
    quantidade: registro.quantidade ?? 1,
    valor_unit: registro.valor_unit ?? "",
    foto: registro.foto ?? "",
    ordem: registro.ordem ?? 0,
  });
  const [prodSel, setProdSel] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const set = (k: string, v: any) => setF((o) => ({ ...o, [k]: v }));

  function puxarPrecificador(pid: string) {
    setProdSel(pid);
    const p = produtos.find((x) => x.id === pid);
    if (p) setF((o) => ({ ...o, descricao: o.descricao || p.nome, valor_unit: p.preco_sugerido || o.valor_unit }));
  }

  async function salvar() {
    setErro(null);
    if (!f.descricao) { setErro("Descrição é obrigatória."); return; }
    setSalvando(true);
    const payload = {
      proposta_id: propostaId,
      descricao: f.descricao, referencia: f.referencia || null,
      quantidade: Number(f.quantidade) || 1, valor_unit: Number(f.valor_unit) || 0,
      foto: f.foto || null, ordem: Number(f.ordem) || 0,
    };
    const { error } = editando
      ? await supabase.from("itens_proposta").update(payload).eq("id", registro.id)
      : await supabase.from("itens_proposta").insert(payload);
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSaved();
  }

  const total = (Number(f.quantidade) || 0) * (Number(f.valor_unit) || 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="font-semibold text-gray-900">{editando ? "Editar" : "Novo"} item da proposta</h2>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="rounded-lg bg-brand-50 p-3">
            <label className="lbl">🧮 Puxar do precificador</label>
            <select className="inp" value={prodSel} onChange={(e) => puxarPrecificador(e.target.value)}>
              <option value="">— escolher produto/serviço —</option>
              {produtos.map((p) => (
                <option key={p.id} value={p.id}>{p.nome} · {formatCurrency(p.preco_sugerido)}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">Preenche descrição e valor com o preço sugerido (você ainda pode ajustar).</p>
          </div>

          <div>
            <label className="lbl">Descrição <span className="text-red-500">*</span></label>
            <textarea className="inp min-h-[70px]" value={f.descricao} onChange={(e) => set("descricao", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="lbl">Referência</label>
              <input className="inp" value={f.referencia} onChange={(e) => set("referencia", e.target.value)} />
            </div>
            <div>
              <label className="lbl">Ordem</label>
              <input className="inp" type="number" value={f.ordem} onChange={(e) => set("ordem", e.target.value)} />
            </div>
            <div>
              <label className="lbl">Quantidade</label>
              <input className="inp" type="number" step="any" value={f.quantidade} onChange={(e) => set("quantidade", e.target.value)} />
            </div>
            <div>
              <label className="lbl">Valor unitário</label>
              <input className="inp" type="number" step="0.01" value={f.valor_unit} onChange={(e) => set("valor_unit", e.target.value)} />
            </div>
          </div>
          <div>
            <label className="lbl">Foto</label>
            <select className="inp" value={f.foto} onChange={(e) => set("foto", e.target.value)}>
              <option value="">— nenhuma —</option>
              {FOTOS_PORTFOLIO.map((ft) => <option key={ft.arquivo} value={ft.arquivo}>{ft.titulo}</option>)}
            </select>
          </div>

          <div className="rounded-lg bg-gray-50 p-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Total do item</span><span className="font-semibold text-gray-900">{formatCurrency(total)}</span></div>
          </div>

          {erro && <p className="text-sm text-red-600">{erro}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}
