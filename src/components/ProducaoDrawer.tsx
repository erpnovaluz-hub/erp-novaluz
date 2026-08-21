"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/format";

type Opt = { id: string; nome: string };
type Peca = { id: string; nome: string; peso: number; tipo?: string | null };
type Servico = { id: string; nome: string; valor: number; unidade: string };
type Row = Record<string, any>;

export default function ProducaoDrawer({
  registro, pecas, servicos, clientes, colaboradores, onClose, onSaved,
}: {
  registro: Row;
  pecas: Peca[];
  servicos: Servico[];
  clientes: Opt[];
  colaboradores: Opt[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const editando = !!registro?.id;
  const [f, setF] = useState<Row>({
    data: (registro.data ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
    cliente_id: registro.cliente_id ?? "",
    colaborador_id: registro.colaborador_id ?? "",
    peca_id: registro.peca_id ?? "",
    peca_nome: registro.peca_nome ?? "",
    servico_id: registro.servico_id ?? "",
    tipo: registro.tipo ?? "",
    quantidade: registro.quantidade ?? "",
    peso_unit: registro.peso_unit ?? "",
    valor_unit: registro.valor_unit ?? "",
    unidade: registro.unidade ?? "KG",
  });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const set = (k: string, v: any) => setF((o) => ({ ...o, [k]: v }));

  function escolherPeca(id: string) {
    const p = pecas.find((x) => x.id === id);
    setF((o) => ({ ...o, peca_id: id, peca_nome: p?.nome ?? o.peca_nome, peso_unit: p ? p.peso : o.peso_unit, tipo: p?.tipo ?? o.tipo }));
  }
  function escolherServico(id: string) {
    const s = servicos.find((x) => x.id === id);
    setF((o) => ({ ...o, servico_id: id, valor_unit: s ? s.valor : o.valor_unit, unidade: s?.unidade ?? o.unidade }));
  }

  const qtd = Number(f.quantidade) || 0;
  const peso = Number(f.peso_unit) || 0;
  const preco = Number(f.valor_unit) || 0;
  const pesoTotal = qtd * peso;
  const valorTotal = String(f.unidade).toUpperCase() === "UND" ? qtd * preco : qtd * peso * preco;

  async function salvar() {
    setErro(null);
    if (!f.data || !qtd) { setErro("Data e quantidade são obrigatórias."); return; }
    setSalvando(true);
    const payload: Row = {
      data: f.data,
      cliente_id: f.cliente_id || null,
      colaborador_id: f.colaborador_id || null,
      peca_id: f.peca_id || null,
      peca_nome: f.peca_nome || null,
      servico_id: f.servico_id || null,
      unidade: f.unidade || null,
      tipo: f.tipo || null,
      quantidade: qtd,
      peso_unit: peso,
      valor_unit: preco,
    };
    const { error } = editando
      ? await supabase.from("producao").update(payload).eq("id", registro.id)
      : await supabase.from("producao").insert(payload);
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSaved();
  }

  async function excluir() {
    if (!confirm("Excluir este lançamento?")) return;
    const { error } = await supabase.from("producao").delete().eq("id", registro.id);
    if (error) { setErro(error.message); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="font-semibold text-gray-900">{editando ? "Editar" : "Novo"} lançamento de produção</h2>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="lbl">Data <span className="text-red-500">*</span></label>
              <input className="inp" type="date" value={f.data} onChange={(e) => set("data", e.target.value)} />
            </div>
            <div>
              <label className="lbl">Cliente</label>
              <select className="inp" value={f.cliente_id} onChange={(e) => set("cliente_id", e.target.value)}>
                <option value="">—</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="lbl">Peça <span className="text-xs text-gray-400">(puxa o peso)</span></label>
            <select className="inp" value={f.peca_id} onChange={(e) => escolherPeca(e.target.value)}>
              <option value="">— (ou digite abaixo)</option>
              {pecas.map((p) => <option key={p.id} value={p.id}>{p.nome} · {p.peso} kg</option>)}
            </select>
            <input className="inp mt-2" placeholder="Nome da peça" value={f.peca_nome} onChange={(e) => set("peca_nome", e.target.value)} />
          </div>

          <div>
            <label className="lbl">Serviço <span className="text-xs text-gray-400">(puxa o preço)</span></label>
            <select className="inp" value={f.servico_id} onChange={(e) => escolherServico(e.target.value)}>
              <option value="">—</option>
              {servicos.map((s) => <option key={s.id} value={s.id}>{s.nome} · {formatCurrency(s.valor)}/{s.unidade}</option>)}
            </select>
          </div>

          <div>
            <label className="lbl">Colaborador</label>
            <select className="inp" value={f.colaborador_id} onChange={(e) => set("colaborador_id", e.target.value)}>
              <option value="">—</option>
              {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="lbl">Quantidade <span className="text-red-500">*</span></label>
              <input className="inp" type="number" step="any" value={f.quantidade} onChange={(e) => set("quantidade", e.target.value)} />
            </div>
            <div>
              <label className="lbl">Peso unit. (kg)</label>
              <input className="inp" type="number" step="any" value={f.peso_unit} onChange={(e) => set("peso_unit", e.target.value)} />
            </div>
            <div>
              <label className="lbl">Preço ({f.unidade})</label>
              <input className="inp" type="number" step="any" value={f.valor_unit} onChange={(e) => set("valor_unit", e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-3 text-sm">
            <div>
              <p className="text-xs text-gray-500">Peso total</p>
              <p className="font-semibold text-gray-900">{pesoTotal.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Valor total <span className="text-gray-400">({String(f.unidade).toUpperCase() === "UND" ? "por unidade" : "por kg"})</span></p>
              <p className="font-semibold text-brand-600">{formatCurrency(valorTotal)}</p>
            </div>
          </div>

          {erro && <p className="text-sm text-red-600">{erro}</p>}
        </div>

        <div className="flex items-center justify-between border-t px-5 py-4">
          {editando ? <button className="text-sm text-red-500 hover:underline" onClick={excluir}>Excluir</button> : <span />}
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn-primary" onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
