"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getEntity } from "@/lib/entities";
import { formatCurrency } from "@/lib/format";
import EntityForm from "@/components/EntityForm";

type Row = Record<string, any>;
const CAT_LABEL: Record<string, string> = {
  material: "Material", mao_de_obra: "Mão de obra", equipamento: "Equipamento",
  terceiro: "Terceiros", frete: "Frete/transporte", outros: "Outros",
};

export default function PrecificadorItem({ params }: { params: { id: string } }) {
  const id = params.id;
  const supabase = useMemo(() => createClient(), []);
  const [prod, setProd] = useState<Row | null>(null);
  const [comp, setComp] = useState<Row[]>([]);
  const [par, setPar] = useState<Row | null>(null);
  const [margem, setMargem] = useState("0");
  const [tempo, setTempo] = useState("0");
  const [precoPrat, setPrecoPrat] = useState("");
  const [drawer, setDrawer] = useState<Row | null | undefined>(undefined);
  const [carregando, setCarregando] = useState(true);
  const [salvo, setSalvo] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [p, c] = await Promise.all([
      supabase.from("produtos").select("*").eq("id", id).maybeSingle(),
      supabase.from("composicao_custo").select("*").eq("produto_id", id).order("categoria"),
    ]);
    setProd(p.data); setComp(c.data ?? []);
    setMargem(String(p.data?.margem_alvo ?? 0)); setTempo(String(p.data?.tempo_horas ?? 0));
    setCarregando(false);
  }, [supabase, id]);

  useEffect(() => {
    supabase.from("parametros_preco").select("*").maybeSingle().then(({ data }) => setPar(data));
  }, [supabase]);
  useEffect(() => { carregar(); }, [carregar]);

  const porCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of comp) m.set(c.categoria, (m.get(c.categoria) || 0) + Number(c.custo_total || 0));
    return Array.from(m.entries());
  }, [comp]);

  if (carregando) return <p className="text-gray-400">Carregando…</p>;
  if (!prod) return <p className="text-gray-400">Item não encontrado. <Link href="/precificador" className="text-brand-600">voltar</Link></p>;

  // ---- cálculo ----
  const custoDireto = comp.reduce((s, c) => s + Number(c.custo_total || 0), 0);
  const metodo = par?.overhead_metodo ?? "hora";
  const overhead = metodo === "hora" ? Number(tempo || 0) * Number(par?.overhead_hora || 0)
    : metodo === "percentual" ? custoDireto * Number(par?.overhead_perc || 0) / 100 : 0;
  const custoTotal = custoDireto + overhead;
  const impostos = Number(par?.impostos_perc || 0), comissao = Number(par?.comissao_perc || 0), cartao = Number(par?.taxa_cartao_perc || 0);
  const taxasPerc = impostos + comissao + cartao;
  const margemNum = Number(margem || 0);
  const deducoes = margemNum + taxasPerc;
  const precoSugerido = deducoes < 100 ? custoTotal / (1 - deducoes / 100) : NaN;

  const preco = Number(precoPrat) || (isFinite(precoSugerido) ? precoSugerido : 0);
  const receitaLiq = preco * (1 - taxasPerc / 100);
  const lucro = receitaLiq - custoTotal;
  const margemLiq = preco > 0 ? (lucro / preco) * 100 : 0;
  const markup = custoTotal > 0 ? preco / custoTotal : 0;

  async function salvar() {
    await supabase.from("produtos").update({
      margem_alvo: Number(margem || 0), tempo_horas: Number(tempo || 0),
      preco_sugerido: isFinite(precoSugerido) ? Math.round(precoSugerido * 100) / 100 : 0,
    }).eq("id", id);
    setSalvo(true); setTimeout(() => setSalvo(false), 2000);
  }
  async function excluirComp(cid: string) {
    if (!confirm("Excluir item de custo?")) return;
    await supabase.from("composicao_custo").delete().eq("id", cid);
    carregar();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link href="/precificador" className="hover:text-gray-700">Precificador</Link> <span>/</span> <span className="text-gray-600">{prod.nome}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Composição */}
        <div className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Composição de custo</h2>
            <button className="btn-ghost text-sm text-brand-600" onClick={() => setDrawer(null)}>+ Adicionar</button>
          </div>
          <div className="card overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr><th className="px-4 py-2">Categoria</th><th className="px-4 py-2">Descrição</th><th className="px-4 py-2 text-right">Qtd</th><th className="px-4 py-2 text-right">Custo un.</th><th className="px-4 py-2 text-right">Total</th><th className="px-4 py-2 text-right">Ações</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {comp.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Sem itens de custo.</td></tr>
                ) : comp.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-500">{CAT_LABEL[c.categoria] ?? c.categoria}</td>
                    <td className="px-4 py-2">{c.descricao}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{Number(c.quantidade)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(c.custo_unitario)}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{formatCurrency(c.custo_total)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      <button className="text-brand-600 hover:underline" onClick={() => setDrawer(c)}>Editar</button>
                      <button className="ml-3 text-red-500 hover:underline" onClick={() => excluirComp(c.id)}>Excluir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                <tr><td colSpan={4} className="px-4 py-2 text-right">Custo direto</td><td className="px-4 py-2 text-right tabular-nums">{formatCurrency(custoDireto)}</td><td /></tr>
              </tfoot>
            </table>
          </div>

          {porCat.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
              {porCat.map(([cat, v]) => <span key={cat} className="rounded-full bg-gray-100 px-2 py-1">{CAT_LABEL[cat] ?? cat}: <b>{formatCurrency(v)}</b></span>)}
            </div>
          )}
        </div>

        {/* Painel de preço */}
        <div className="space-y-4">
          <div className="card p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">{prod.nome}</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="lbl">Tempo (horas)</label>
                <input className="inp" type="number" step="any" value={tempo} onChange={(e) => setTempo(e.target.value)} />
              </div>
              <div>
                <label className="lbl">Margem alvo (%)</label>
                <input className="inp" type="number" step="any" value={margem} onChange={(e) => setMargem(e.target.value)} />
              </div>
            </div>
            <div className="mt-4 space-y-1.5 text-sm">
              <Linha rot="Custo direto" val={formatCurrency(custoDireto)} />
              <Linha rot={`Overhead (${metodo})`} val={formatCurrency(overhead)} />
              <Linha rot="Custo total" val={formatCurrency(custoTotal)} bold />
              <Linha rot={`Deduções (${deducoes.toFixed(1)}%)`} val={`margem ${margemNum}% + taxas ${taxasPerc}%`} muted />
              <div className="mt-2 rounded-lg bg-brand-50 p-3">
                <p className="text-xs text-brand-700">Preço sugerido</p>
                <p className="text-2xl font-bold text-brand-700">{isFinite(precoSugerido) ? formatCurrency(precoSugerido) : "—"}</p>
              </div>
            </div>
            <button className="btn-primary mt-3 w-full" onClick={salvar}>{salvo ? "✓ Salvo" : "Salvar preço sugerido"}</button>
          </div>

          <div className="card p-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Análise de margem</h3>
            <label className="lbl">Preço praticado (deixe vazio = sugerido)</label>
            <input className="inp" type="number" step="any" placeholder={isFinite(precoSugerido) ? String(Math.round(precoSugerido)) : ""} value={precoPrat} onChange={(e) => setPrecoPrat(e.target.value)} />
            <div className="mt-3 space-y-1.5 text-sm">
              <Linha rot="Preço" val={formatCurrency(preco)} />
              <Linha rot="Receita líquida" val={formatCurrency(receitaLiq)} muted />
              <Linha rot="Lucro" val={formatCurrency(lucro)} bold cor={lucro >= 0 ? "text-green-600" : "text-red-600"} />
              <Linha rot="Margem líquida" val={`${margemLiq.toFixed(1)}%`} cor={margemLiq >= 0 ? "text-green-600" : "text-red-600"} />
              <Linha rot="Markup" val={`${markup.toFixed(2)}×`} muted />
            </div>
          </div>
        </div>
      </div>

      {drawer !== undefined && (
        <EntityForm
          entity={getEntity("composicao_custo")!}
          registro={drawer}
          refOptions={{}}
          fixedValues={{ produto_id: id }}
          onClose={() => setDrawer(undefined)}
          onSaved={() => { setDrawer(undefined); carregar(); }}
        />
      )}
    </div>
  );
}

function Linha({ rot, val, bold, muted, cor }: { rot: string; val: string; bold?: boolean; muted?: boolean; cor?: string }) {
  return (
    <div className="flex justify-between">
      <span className={muted ? "text-gray-400" : "text-gray-600"}>{rot}</span>
      <span className={`tabular-nums ${bold ? "font-semibold" : ""} ${cor ?? "text-gray-800"}`}>{val}</span>
    </div>
  );
}
