"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/format";

type Opt = { id: string; nome: string };
type SubOpt = { id: string; nome: string; categoria_id: string };
type Row = Record<string, any>;

const STATUS = [
  { value: "aberto", label: "Aberto" },
  { value: "pago", label: "Pago" },
  { value: "cancelado", label: "Cancelado" },
];

export default function TituloDrawer({
  registro, tipo, categorias, subcategorias, clientes, fornecedores, contas, onClose, onSaved,
}: {
  registro: Row;
  tipo: "pagar" | "receber";
  categorias: Opt[];
  subcategorias: SubOpt[];
  clientes: Opt[];
  fornecedores: Opt[];
  contas: Opt[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const editando = !!registro?.id;
  const [f, setF] = useState<Row>({
    descricao: registro.descricao ?? "",
    valor: registro.valor ?? "",
    categoria_id: registro.categoria_id ?? "",
    subcategoria_id: registro.subcategoria_id ?? "",
    vencimento: (registro.vencimento ?? "").slice(0, 10),
    competencia: (registro.competencia ?? "").slice(0, 10),
    cliente_id: registro.cliente_id ?? "",
    fornecedor_id: registro.fornecedor_id ?? "",
    status: registro.status ?? "aberto",
    conta_bancaria_id: registro.conta_bancaria_id ?? "",
    data_pagamento: (registro.data_pagamento ?? "").slice(0, 10),
  });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [parcelar, setParcelar] = useState(false);
  const [nParcelas, setNParcelas] = useState("2");
  const [intervalo, setIntervalo] = useState("30");
  const set = (k: string, v: any) => setF((o) => ({ ...o, [k]: v }));

  const subsDaCategoria = useMemo(
    () => subcategorias.filter((s) => s.categoria_id === f.categoria_id),
    [subcategorias, f.categoria_id]
  );

  async function salvar() {
    setErro(null);
    if (!f.descricao || !f.valor) { setErro("Descrição e valor são obrigatórios."); return; }
    if (f.status === "pago" && !f.conta_bancaria_id) { setErro("Para marcar como Pago, escolha a conta da baixa."); return; }
    setSalvando(true);
    const comum = {
      tipo,
      categoria_id: f.categoria_id || null,
      subcategoria_id: f.subcategoria_id || null,
      cliente_id: tipo === "receber" ? (f.cliente_id || null) : null,
      fornecedor_id: tipo === "pagar" ? (f.fornecedor_id || null) : null,
    };

    // parcelamento (só em novo lançamento)
    const n = parseInt(nParcelas);
    if (!editando && parcelar && n > 1) {
      const total = Number(f.valor);
      const base = Math.round((total / n) * 100) / 100;
      const inter = parseInt(intervalo) || 30;
      const venc0 = new Date((f.vencimento || new Date().toISOString().slice(0, 10)) + "T00:00:00");
      const parcelas: Row[] = [];
      let acum = 0;
      for (let i = 1; i <= n; i++) {
        const valor = i < n ? base : Math.round((total - acum) * 100) / 100;
        acum += base;
        const d = new Date(venc0); d.setDate(d.getDate() + (i - 1) * inter);
        const venc = d.toISOString().slice(0, 10);
        parcelas.push({ ...comum, descricao: `${f.descricao} (${i}/${n})`, valor, vencimento: venc, competencia: venc, status: "aberto" });
      }
      const { error } = await supabase.from("titulos_financeiros").insert(parcelas);
      setSalvando(false);
      if (error) { setErro(error.message); return; }
      onSaved();
      return;
    }

    const payload: Row = {
      ...comum,
      descricao: f.descricao,
      valor: Number(f.valor),
      vencimento: f.vencimento || null,
      competencia: f.competencia || null,
      status: f.status,
      conta_bancaria_id: f.conta_bancaria_id || null,
      data_pagamento: f.data_pagamento || null,
    };
    const { error } = editando
      ? await supabase.from("titulos_financeiros").update(payload).eq("id", registro.id)
      : await supabase.from("titulos_financeiros").insert(payload);
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSaved();
  }

  async function excluir() {
    if (!confirm("Excluir este título?")) return;
    const { error } = await supabase.from("titulos_financeiros").delete().eq("id", registro.id);
    if (error) { setErro(error.message); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="font-semibold text-gray-900">
            {editando ? "Editar" : "Novo"} lançamento · {tipo === "pagar" ? "Despesa" : "Receita"}
          </h2>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className="lbl">Descrição <span className="text-red-500">*</span></label>
            <input className="inp" value={f.descricao} onChange={(e) => set("descricao", e.target.value)} />
          </div>
          <div>
            <label className="lbl">Valor <span className="text-red-500">*</span></label>
            <input className="inp" type="number" step="0.01" value={f.valor} onChange={(e) => set("valor", e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="lbl">Categoria</label>
              <select className="inp" value={f.categoria_id} onChange={(e) => { set("categoria_id", e.target.value); set("subcategoria_id", ""); }}>
                <option value="">—</option>
                {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="lbl">Subcategoria</label>
              <select className="inp" value={f.subcategoria_id} onChange={(e) => set("subcategoria_id", e.target.value)} disabled={!f.categoria_id}>
                <option value="">—</option>
                {subsDaCategoria.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </div>
          </div>

          {tipo === "receber" ? (
            <div>
              <label className="lbl">Cliente</label>
              <select className="inp" value={f.cliente_id} onChange={(e) => set("cliente_id", e.target.value)}>
                <option value="">—</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className="lbl">Fornecedor</label>
              <select className="inp" value={f.fornecedor_id} onChange={(e) => set("fornecedor_id", e.target.value)}>
                <option value="">—</option>
                {fornecedores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="lbl">Vencimento</label>
              <input className="inp" type="date" value={f.vencimento} onChange={(e) => set("vencimento", e.target.value)} />
            </div>
            <div>
              <label className="lbl">Competência</label>
              <input className="inp" type="date" value={f.competencia} onChange={(e) => set("competencia", e.target.value)} />
            </div>
          </div>

          {!editando && (
            <div className="rounded-lg border border-gray-200 p-3">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input type="checkbox" className="h-4 w-4" checked={parcelar} onChange={(e) => setParcelar(e.target.checked)} />
                Parcelar este lançamento
              </label>
              {parcelar && (
                <>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <label className="lbl">Nº de parcelas</label>
                      <input className="inp" type="number" min="2" value={nParcelas} onChange={(e) => setNParcelas(e.target.value)} />
                    </div>
                    <div>
                      <label className="lbl">Intervalo (dias)</label>
                      <input className="inp" type="number" value={intervalo} onChange={(e) => setIntervalo(e.target.value)} />
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    Gera {parseInt(nParcelas) || 0} títulos em aberto de {formatCurrency((Number(f.valor) || 0) / (parseInt(nParcelas) || 1))} cada, a partir do vencimento.
                  </p>
                </>
              )}
            </div>
          )}

          <div className={`rounded-lg border border-gray-200 p-3 ${parcelar && !editando ? "opacity-40" : ""}`}>
            <label className="lbl">Status</label>
            <select className="inp" value={f.status} onChange={(e) => set("status", e.target.value)}>
              {STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {f.status === "pago" && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="lbl">Conta da baixa <span className="text-red-500">*</span></label>
                  <select className="inp" value={f.conta_bancaria_id} onChange={(e) => set("conta_bancaria_id", e.target.value)}>
                    <option value="">—</option>
                    {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </div>
                <div>
                  <label className="lbl">Data do pagamento</label>
                  <input className="inp" type="date" value={f.data_pagamento} onChange={(e) => set("data_pagamento", e.target.value)} />
                </div>
              </div>
            )}
          </div>

          {erro && <p className="text-sm text-red-600">{erro}</p>}
        </div>

        <div className="flex items-center justify-between border-t px-5 py-4">
          {editando ? (
            <button className="text-sm text-red-500 hover:underline" onClick={excluir}>Excluir</button>
          ) : <span />}
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn-primary" onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
