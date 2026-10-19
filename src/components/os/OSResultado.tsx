"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/format";
import { numeroBR } from "@/lib/planilha";

type R = { valor_venda: number | null; custo_estimado: number | null; custo_material: number; horas: number;
  custo_mao_obra: number; custo_terceiros: number | null; custo_total: number; margem: number | null; margem_pct: number | null };

// Resultado da OS — só para a gerência (a função do banco já recusa os demais).
export default function OSResultado({ os, atualizar }: { os: Record<string, any>; atualizar: number }) {
  const supabase = useMemo(() => createClient(), []);
  const [r, setR] = useState<R | null>(null);
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState("");
  const [sugestao, setSugestao] = useState<{ rot: string; valor: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data } = await supabase.rpc("resultado_os", { p_os: os.id });
    setR(((data ?? []) as R[])[0] ?? null);
  }, [supabase, os.id]);
  useEffect(() => { carregar(); }, [carregar, atualizar]);

  // sugere o valor da proposta ou do contrato vinculado
  useEffect(() => {
    (async () => {
      if (os.proposta_id) {
        const { data } = await supabase.from("propostas").select("numero, valor_total").eq("id", os.proposta_id).maybeSingle();
        if (data?.valor_total) { setSugestao({ rot: `proposta ${data.numero ?? ""}`, valor: Number(data.valor_total) }); return; }
      }
      if (os.contrato_id) {
        const { data } = await supabase.from("contratos").select("numero, valor").eq("id", os.contrato_id).maybeSingle();
        if (data?.valor) setSugestao({ rot: `contrato ${data.numero ?? ""}`, valor: Number(data.valor) });
      }
    })();
  }, [supabase, os.proposta_id, os.contrato_id]);

  async function salvarValor(v: number | null) {
    setErro(null);
    const { error } = await supabase.from("ordens_servico").update({ valor_venda: v }).eq("id", os.id);
    if (error) { setErro(error.message); return; }
    setEditando(false);
    carregar();
  }

  if (!r) return null;
  const pctUsado = r.custo_estimado ? Math.round((r.custo_total / r.custo_estimado) * 100) : null;
  const corMargem = r.margem == null ? "text-gray-400" : r.margem < 0 ? "text-red-600" : (r.margem_pct ?? 0) < 15 ? "text-amber-700" : "text-green-700";

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">💰 Resultado da OS <span className="normal-case text-gray-400">· só gerência</span></h2>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <div>
          <p className="text-xs text-gray-400">Valor de venda</p>
          {editando ? (
            <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); const v = numeroBR(valor); salvarValor(v == null || Number.isNaN(v) ? null : v); }}>
              <input autoFocus inputMode="decimal" className="inp py-1" value={valor} onChange={(e) => setValor(e.target.value)} />
              <button className="btn-primary px-2 py-1 text-xs">ok</button>
            </form>
          ) : (
            <button className="text-left font-semibold tabular-nums text-gray-900 hover:underline"
              onClick={() => { setValor(r.valor_venda != null ? String(r.valor_venda).replace(".", ",") : ""); setEditando(true); }}>
              {r.valor_venda != null ? formatCurrency(r.valor_venda) : <span className="font-normal text-brand-600">+ informar</span>}
            </button>
          )}
          {sugestao && r.valor_venda == null && !editando && (
            <button className="mt-0.5 block text-[11px] text-brand-600 hover:underline" onClick={() => salvarValor(sugestao.valor)}>
              usar {formatCurrency(sugestao.valor)} da {sugestao.rot}
            </button>
          )}
        </div>
        <Item rot="Material" v={formatCurrency(r.custo_material)} />
        <Item rot={`Mão de obra própria (${Number(r.horas).toLocaleString("pt-BR")} h)`} v={formatCurrency(r.custo_mao_obra)} />
        <Item rot="Mão de obra terceirizada" v={formatCurrency(r.custo_terceiros ?? 0)} />
        <Item rot="Custo total" v={formatCurrency(r.custo_total)} />
        <div>
          <p className="text-xs text-gray-400">Margem</p>
          <p className={`font-semibold tabular-nums ${corMargem}`}>
            {r.margem == null ? "—" : `${formatCurrency(r.margem)}`}
            {r.margem_pct != null && <span className="ml-1 text-xs">({r.margem_pct}%)</span>}
          </p>
        </div>
      </div>
      {r.custo_estimado ? (
        <div className="mt-4">
          <div className="flex justify-between text-xs text-gray-500">
            <span>Custo real × previsto ({formatCurrency(r.custo_estimado)})</span>
            <span className={pctUsado != null && pctUsado > 100 ? "font-medium text-red-600" : ""}>{pctUsado}%</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div className={`h-2 rounded-full ${pctUsado != null && pctUsado > 100 ? "bg-red-500" : "bg-brand-600"}`} style={{ width: `${Math.min(100, pctUsado ?? 0)}%` }} />
          </div>
        </div>
      ) : null}
      {r.custo_mao_obra === 0 && r.horas > 0 && (
        <p className="mt-2 text-xs text-amber-700">Há horas apontadas sem custo: cadastre o custo/hora dos colaboradores em RH › Colaboradores.</p>
      )}
      {erro && <p className="mt-2 text-sm text-red-600">{erro}</p>}
    </section>
  );
}

function Item({ rot, v }: { rot: string; v: string }) {
  return <div><p className="text-xs text-gray-400">{rot}</p><p className="font-semibold tabular-nums text-gray-900">{v}</p></div>;
}
