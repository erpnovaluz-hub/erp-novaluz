"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAcesso } from "@/components/AcessoProvider";
import { Avatar, useEquipe } from "@/components/tarefas/comum";
import KpiDrawer from "@/components/gestao/KpiDrawer";
import { SeloFarol, Tendencia, useKpis } from "@/components/gestao/kpiComum";
import { FAROL, farol, formatarValor, janelaMeses, mesAtual, rotuloMes, somaMeses, type Farol } from "@/lib/kpis";

// /gestao/indicadores — uma tela, um KPI por linha. Fora da faixa primeiro:
// painel que destaca tudo não destaca nada.
export default function IndicadoresPainel() {
  const acesso = useAcesso();
  const { porId } = useEquipe();
  const [mes, setMes] = useState(mesAtual());
  const { kpis, catalogo, medicao, carregado, erro, recarregar } = useKpis(mes, 6);
  const [aberto, setAberto] = useState<string | null>(null);
  const atual = mesAtual();
  const janela = janelaMeses(mes, 6);

  const linhas = useMemo(() => kpis.filter((k) => k.ativo).map((k) => {
    const m = medicao(k.id, mes);
    const ant = medicao(k.id, somaMeses(mes, -1));
    const f = farol(m?.valor, k);
    return { k, m, ant, f, serie: janela.map((p) => ({ periodo: p, valor: medicao(k.id, p)?.valor ?? null })) };
  }).sort((a, b) => FAROL[a.f].ordem - FAROL[b.f].ordem || a.k.ordem - b.k.ordem), [kpis, medicao, mes, janela]);

  const contagem = linhas.reduce((acc, l) => ({ ...acc, [l.f]: (acc[l.f] ?? 0) + 1 }), {} as Partial<Record<Farol, number>>);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/gestao" className="text-xs text-brand-700 hover:underline">← Ritmo de Gestão</Link>
          <h1 className="text-xl font-bold text-gray-900">📊 Indicadores</h1>
          <p className="text-sm text-gray-500">{acesso.gerencia ? "Indicador + meta + farol. Quem é responsável apresenta o número na reunião." : "Os indicadores pelos quais você responde."}</p>
        </div>
        {acesso.gerencia && <Link href="/gestao/indicadores/configurar" className="btn-ghost text-sm ring-1 ring-gray-200">⚙️ Configurar</Link>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg ring-1 ring-gray-200">
          <button className="btn-ghost px-3 py-1.5" onClick={() => setMes(somaMeses(mes, -1))} aria-label="Mês anterior">‹</button>
          <span className="min-w-[9rem] text-center text-sm font-medium capitalize text-gray-800">{rotuloMes(mes)}</span>
          <button className="btn-ghost px-3 py-1.5" disabled={mes >= atual} onClick={() => setMes(somaMeses(mes, 1))} aria-label="Próximo mês">›</button>
        </div>
        {mes === atual && <span className="text-xs text-gray-400">mês em andamento — valores parciais</span>}
        <div className="ml-auto flex flex-wrap gap-1">
          {(["vermelho", "amarelo", "verde", "sem_meta"] as Farol[]).filter((f) => contagem[f]).map((f) => (
            <span key={f} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${FAROL[f].cls}`}>{FAROL[f].icone} {contagem[f]} {FAROL[f].label.toLowerCase()}</span>
          ))}
        </div>
      </div>

      {erro && <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      {carregado && linhas.length === 0 && (
        <div className="card mt-4 p-8 text-center text-sm text-gray-500">
          {acesso.gerencia
            ? <>Nenhum indicador ainda. <Link href="/gestao/indicadores/configurar" className="text-brand-700 hover:underline">Escolha de 3 a 5 no catálogo</Link> para começar.</>
            : "Você ainda não é responsável por nenhum indicador."}
        </div>
      )}

      {linhas.length > 0 && (
        <div className="card mt-4 divide-y overflow-hidden">
          <div className="hidden items-center gap-3 bg-gray-50 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-gray-500 lg:flex">
            <span className="flex-1">Indicador</span>
            <span className="w-28 text-right">{rotuloMes(mes, true)}</span>
            <span className="w-24 text-right">Meta</span>
            <span className="w-36">Farol</span>
            <span className="hidden w-24 text-right xl:block">Mês anterior</span>
            <span className="w-28">6 meses</span>
          </div>
          {linhas.map(({ k, m, ant, f, serie }) => {
            const cat = k.catalogo_chave ? catalogo[k.catalogo_chave] : null;
            return (
              <button key={k.id} onClick={() => setAberto(k.id)}
                className="linha-lista flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left text-sm hover:bg-gray-50 lg:flex-nowrap">
                <div className="linha-principal flex min-w-[12rem] flex-1 items-center gap-2">
                  <Avatar pessoa={k.responsavel_id ? porId[k.responsavel_id] : null} size={26} />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-900">{k.nome}</p>
                    <p className="truncate text-xs text-gray-500">
                      {k.sentido === "maior" ? "↑ maior é melhor" : "↓ menor é melhor"}
                      {" · "}{cat?.coleta === "automatico" ? "automático" : "manual"}
                      {cat?.aviso && <span className="text-amber-600" title={cat.aviso}> · ⚠ depende de lançamento</span>}
                      {m?.observacao && <span title={m.observacao}> · 💬 causa registrada</span>}
                    </p>
                  </div>
                </div>
                <span className="w-28 text-right text-base font-semibold tabular-nums text-gray-900 max-lg:w-auto">{formatarValor(m?.valor, k.unidade)}</span>
                <span className="w-24 text-right text-xs tabular-nums text-gray-500 max-lg:w-auto">{k.meta != null ? `meta ${formatarValor(k.meta, k.unidade)}` : "sem meta"}</span>
                <span className="w-36 max-lg:w-auto"><SeloFarol f={f} /></span>
                <span className="hidden w-24 text-right text-xs tabular-nums text-gray-500 xl:block">{formatarValor(ant?.valor, k.unidade)}</span>
                <span className="hidden w-28 md:block"><Tendencia kpi={k} serie={serie} /></span>
              </button>
            );
          })}
        </div>
      )}

      {aberto && (
        <KpiDrawer kpiId={aberto} mes={mes} onClose={() => setAberto(null)} onChange={recarregar} />
      )}
    </div>
  );
}
