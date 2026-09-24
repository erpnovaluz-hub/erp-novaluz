"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import { numeroBR } from "@/lib/planilha";
import { CATEGORIAS, ESTADOS, type Ferramenta } from "@/lib/ferramentas";

type Campos = {
  codigo: string; descricao: string; categoria: string; marca: string; modelo: string; numero_serie: string;
  deposito_id: string; estado: string; valor_aquisicao: string; data_aquisicao: string;
  proxima_manutencao: string; periodicidade_dias: string; observacao: string;
};

// Cadastro/edição de uma ferramenta. Código vazio = gera FER-0001 automático.
export default function FerramentaForm({ registro, onFechar, onSalvo }: {
  registro: Ferramenta | null; onFechar: () => void; onSalvo: (id: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { gerencia } = useAcesso();
  const [depositos, setDepositos] = useState<{ id: string; nome: string }[]>([]);
  const [f, setF] = useState<Campos>(() => ({
    codigo: registro?.codigo ?? "", descricao: registro?.descricao ?? "", categoria: registro?.categoria ?? "ferramenta_eletrica",
    marca: registro?.marca ?? "", modelo: registro?.modelo ?? "", numero_serie: registro?.numero_serie ?? "",
    deposito_id: registro?.deposito_id ?? "", estado: registro?.estado ?? "bom",
    valor_aquisicao: registro?.valor_aquisicao != null ? String(registro.valor_aquisicao).replace(".", ",") : "",
    data_aquisicao: registro?.data_aquisicao ?? "", proxima_manutencao: registro?.proxima_manutencao ?? "",
    periodicidade_dias: registro?.periodicidade_dias != null ? String(registro.periodicidade_dias) : "",
    observacao: registro?.observacao ?? "",
  }));
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);

  useEffect(() => {
    supabase.from("depositos").select("id, nome").eq("ativo", true).order("nome").then(({ data }) => {
      setDepositos(data ?? []);
      if (!registro && data?.[0]) setF((x) => ({ ...x, deposito_id: x.deposito_id || data[0].id }));
    });
  }, [supabase, registro]);

  const set = (k: keyof Campos, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setGravando(true); setErro(null);
    const dados: Record<string, any> = {
      descricao: f.descricao.trim(), categoria: f.categoria, marca: f.marca.trim() || null, modelo: f.modelo.trim() || null,
      numero_serie: f.numero_serie.trim() || null, deposito_id: f.deposito_id || null, estado: f.estado,
      data_aquisicao: f.data_aquisicao || null, proxima_manutencao: f.proxima_manutencao || null,
      periodicidade_dias: f.periodicidade_dias ? Number(f.periodicidade_dias) : null, observacao: f.observacao.trim() || null,
    };
    if (gerencia) dados.valor_aquisicao = f.valor_aquisicao.trim() ? numeroBR(f.valor_aquisicao) : null;
    if (!registro) dados.codigo = f.codigo.trim() || null;
    const q = registro
      ? supabase.from("ferramentas").update(dados).eq("id", registro.id).select("id").single()
      : supabase.from("ferramentas").insert(dados).select("id").single();
    const { data, error } = await q;
    setGravando(false);
    if (error) { setErro(error.message.includes("duplicate") ? "Já existe uma ferramenta com esse código." : error.message); return; }
    onSalvo(data.id);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onFechar}>
      <div className="absolute inset-0 bg-black/20" />
      <form onSubmit={salvar} onClick={(e) => e.stopPropagation()}
        className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
        style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold text-gray-900">{registro ? `Editar ${registro.codigo}` : "Nova ferramenta / equipamento"}</h2>
          <button type="button" className="text-2xl leading-none text-gray-400" onClick={onFechar} aria-label="Fechar">×</button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4 text-sm">
          {!registro && (
            <label className="block"><span className="lbl">Código da etiqueta</span>
              <input className="inp uppercase" value={f.codigo} onChange={(e) => set("codigo", e.target.value)} placeholder="vazio = automático (FER-0001)" />
            </label>
          )}
          <label className="block"><span className="lbl">Descrição *</span>
            <input className="inp" required value={f.descricao} onChange={(e) => set("descricao", e.target.value)} placeholder="ex.: Esmerilhadeira angular 7&quot;" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="lbl">Categoria</span>
              <select className="inp" value={f.categoria} onChange={(e) => set("categoria", e.target.value)}>
                {CATEGORIAS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
            <label className="block"><span className="lbl">Estado</span>
              <select className="inp" value={f.estado} onChange={(e) => set("estado", e.target.value)}>
                {ESTADOS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
            <label className="block"><span className="lbl">Marca</span><input className="inp" value={f.marca} onChange={(e) => set("marca", e.target.value)} /></label>
            <label className="block"><span className="lbl">Modelo</span><input className="inp" value={f.modelo} onChange={(e) => set("modelo", e.target.value)} /></label>
          </div>
          <label className="block"><span className="lbl">Nº de série</span><input className="inp" value={f.numero_serie} onChange={(e) => set("numero_serie", e.target.value)} /></label>
          <label className="block"><span className="lbl">Guardada em (depósito)</span>
            <select className="inp" value={f.deposito_id} onChange={(e) => set("deposito_id", e.target.value)}>
              <option value="">—</option>
              {depositos.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="lbl">Data de aquisição</span><input type="date" className="inp" value={f.data_aquisicao} onChange={(e) => set("data_aquisicao", e.target.value)} /></label>
            {gerencia && <label className="block"><span className="lbl">Valor (R$)</span><input inputMode="decimal" className="inp" value={f.valor_aquisicao} onChange={(e) => set("valor_aquisicao", e.target.value)} /></label>}
            <label className="block"><span className="lbl">Próxima manutenção / calibração</span><input type="date" className="inp" value={f.proxima_manutencao} onChange={(e) => set("proxima_manutencao", e.target.value)} /></label>
            <label className="block"><span className="lbl">Repetir a cada (dias)</span><input type="number" min={1} className="inp" value={f.periodicidade_dias} onChange={(e) => set("periodicidade_dias", e.target.value)} placeholder="ex.: 180" /></label>
          </div>
          <label className="block"><span className="lbl">Observação</span><textarea className="inp" rows={3} value={f.observacao} onChange={(e) => set("observacao", e.target.value)} /></label>
          {erro && <div className="rounded-lg bg-red-50 p-3 text-red-700">{erro}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <button type="button" className="btn-ghost" onClick={onFechar}>Cancelar</button>
          <button className="btn-primary" disabled={gravando || !f.descricao.trim()}>{gravando ? "Salvando…" : "Salvar"}</button>
        </div>
      </form>
    </div>
  );
}
