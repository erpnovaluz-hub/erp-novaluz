"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { SeloFarol, useKpis } from "@/components/gestao/kpiComum";
import { farol, formatarValor, mesISO, rotuloMes, somaMeses, type Kpi } from "@/lib/kpis";
import type { ItemPauta, Reuniao } from "@/lib/ritmo";

export function tituloPautaKpi(k: Kpi) { return `📊 ${k.nome}`; }

// Bloco 1 × Bloco 2: na reunião, os indicadores fora da faixa viram pauta.
// Mensal olha o mês fechado anterior; as demais, o mês corrente (parcial).
export default function KpisForaDaFaixa({ r, pauta, editavel, onLevou }: {
  r: Reuniao; pauta: ItemPauta[]; editavel: boolean; onLevou: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const mesReuniao = mesISO(new Date(r.data_hora));
  const mes = r.tipo === "mensal" ? somaMeses(mesReuniao, -1) : mesReuniao;
  const { kpis, medicao, catalogo, carregado } = useKpis(mes, 1);
  const [erro, setErro] = useState<string | null>(null);

  const fora = kpis.filter((k) => k.ativo).map((k) => {
    const m = medicao(k.id, mes);
    return { k, m, f: farol(m?.valor, k) };
  }).filter((x) => x.f === "vermelho" || x.f === "amarelo")
    .sort((a, b) => (a.f === b.f ? a.k.ordem - b.k.ordem : a.f === "vermelho" ? -1 : 1));

  if (!carregado || kpis.length === 0) return null;

  async function levar(k: Kpi, valor: number | null | undefined, causa: string | null | undefined) {
    setErro(null);
    const desc = [
      `${rotuloMes(mes)}: ${formatarValor(valor, k.unidade)} · meta ${formatarValor(k.meta, k.unidade)}`,
      causa ? `Causa registrada: ${causa}` : "Sem causa registrada — discutir a causa antes da solução.",
      k.catalogo_chave && catalogo[k.catalogo_chave] ? `Decisão que apoia: ${catalogo[k.catalogo_chave].decisao}` : null,
    ].filter(Boolean).join("\n");
    const { error } = await supabase.from("reuniao_pauta").insert({
      reuniao_id: r.id, titulo: tituloPautaKpi(k), descricao: desc, origem: "manual", status: "aceito",
      ordem: -1 + (pauta.reduce((m, p) => Math.min(m, p.ordem), 0) || 0),   // indicadores abrem a pauta
    });
    if (error) { setErro(error.message); return; }
    onLevou();
  }

  return (
    <section className="card border-l-4 border-l-amber-400 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-gray-800">📊 Indicadores fora da faixa · <span className="capitalize">{rotuloMes(mes)}</span></h2>
        <Link href="/gestao/indicadores" className="text-xs text-brand-700 hover:underline">painel completo →</Link>
      </div>
      <p className="mt-0.5 text-xs text-gray-400">Quem responde pelo indicador apresenta o número. Discuta a causa antes da solução.</p>
      {erro && <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{erro}</p>}
      {fora.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">Todos os indicadores com meta estão na faixa. ✓</p>
      ) : (
        <div className="mt-2 divide-y">
          {fora.map(({ k, m, f }) => {
            const naPauta = pauta.some((p) => p.titulo === tituloPautaKpi(k));
            return (
              <div key={k.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <b className="text-gray-900">{k.nome}</b>
                  <span className="ml-2 tabular-nums text-gray-700">{formatarValor(m?.valor, k.unidade)}</span>
                  <span className="ml-1 text-xs text-gray-400">meta {formatarValor(k.meta, k.unidade)}</span>
                  {m?.observacao && <span className="block truncate text-xs text-gray-500">Causa: {m.observacao}</span>}
                </span>
                <SeloFarol f={f} />
                {naPauta ? <span className="text-xs text-green-700">✓ na pauta</span>
                  : editavel && <button className="btn-ghost px-2 py-1 text-xs ring-1 ring-gray-200" onClick={() => levar(k, m?.valor, m?.observacao)}>Levar à pauta</button>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
