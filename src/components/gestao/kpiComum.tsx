"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import {
  FAROL, farol, formatarValor, janelaMeses, mesAtual, rotuloMes, somaMeses,
  type Catalogo, type Farol, type Kpi, type Medicao,
} from "@/lib/kpis";

// Carrega KPIs visíveis (RLS: gerência todos, demais só os seus), o catálogo e
// as medições da janela de meses. A gerência recalcula os automáticos do mês
// atual (e do anterior, se faltar) antes de ler.
export function useKpis(ate: string = mesAtual(), meses = 6) {
  const supabase = useMemo(() => createClient(), []);
  const acesso = useAcesso();
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [catalogo, setCatalogo] = useState<Record<string, Catalogo>>({});
  const [medicoes, setMedicoes] = useState<Medicao[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (recalcular = false) => {
    if (!acesso.empresaId) return;
    const atual = mesAtual();
    if (recalcular && acesso.gerencia) {
      const r = await supabase.rpc("kpi_atualizar", { p_periodo: atual });
      if (r.error) setErro(r.error.message);
      const ant = somaMeses(atual, -1);
      const { count } = await supabase.from("kpi_medicoes").select("kpi_id", { count: "exact", head: true }).eq("periodo", ant);
      if (!count) await supabase.rpc("kpi_atualizar", { p_periodo: ant });
    }
    const janela = janelaMeses(ate, meses);
    const [k, c, m] = await Promise.all([
      supabase.from("kpis").select("*").order("ordem").order("criado_em"),
      supabase.from("kpi_catalogo").select("*").order("ordem"),
      supabase.from("kpi_medicoes").select("*").gte("periodo", janela[0]).lte("periodo", janela[janela.length - 1]),
    ]);
    if (k.error) setErro(k.error.message);
    setKpis((k.data ?? []) as Kpi[]);
    setCatalogo(Object.fromEntries(((c.data ?? []) as Catalogo[]).map((x) => [x.chave, x])));
    setMedicoes((m.data ?? []) as Medicao[]);
    setCarregado(true);
  }, [supabase, acesso.empresaId, acesso.gerencia, ate, meses]);

  useEffect(() => { carregar(true); }, [carregar]);

  const medicao = useCallback((kpiId: string, periodo: string) =>
    medicoes.find((m) => m.kpi_id === kpiId && m.periodo === periodo), [medicoes]);

  return { kpis, catalogo, medicoes, medicao, carregado, erro, recarregar: () => carregar(false), recalcular: () => carregar(true) };
}

export function SeloFarol({ f, compacto = false }: { f: Farol; compacto?: boolean }) {
  const s = FAROL[f];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${s.cls}`} title={s.label}>
      <span aria-hidden>{s.icone}</span>{!compacto && s.label}
      {compacto && <span className="sr-only">{s.label}</span>}
    </span>
  );
}

// Tendência: uma série, linha 2px em tinta neutra, meta tracejada na mesma
// imagem (número sem referência não diz se é bom), último ponto marcado.
// Tooltip nativo por ponto (alvo maior que o ponto).
export function Tendencia({ kpi, serie, largura = 112, altura = 32 }: {
  kpi: Kpi; serie: { periodo: string; valor: number | null }[]; largura?: number; altura?: number;
}) {
  const pts = serie.filter((p) => p.valor != null) as { periodo: string; valor: number }[];
  if (pts.length === 0) return <span className="text-[11px] text-gray-300">sem histórico</span>;
  const vals = pts.map((p) => p.valor).concat(kpi.meta != null ? [kpi.meta] : []);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const pad = 5;
  const x = (i: number) => pad + (i * (largura - 2 * pad)) / Math.max(serie.length - 1, 1);
  const y = (v: number) => altura - pad - ((v - min) * (altura - 2 * pad)) / (max - min);
  const idx = (p: { periodo: string }) => serie.findIndex((s) => s.periodo === p.periodo);
  const caminho = pts.map((p) => `${x(idx(p)).toFixed(1)},${y(p.valor).toFixed(1)}`).join(" ");
  const ultimo = pts[pts.length - 1];
  return (
    <svg width={largura} height={altura} viewBox={`0 0 ${largura} ${altura}`} className="overflow-visible text-gray-500" role="img"
      aria-label={`Tendência de ${kpi.nome}: ${pts.map((p) => `${rotuloMes(p.periodo, true)} ${formatarValor(p.valor, kpi.unidade)}`).join(", ")}`}>
      {kpi.meta != null && (
        <line x1={pad} x2={largura - pad} y1={y(kpi.meta)} y2={y(kpi.meta)} stroke="currentColor" strokeOpacity={0.45} strokeWidth={1} strokeDasharray="3 3" />
      )}
      {pts.length > 1 && <polyline points={caminho} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
      <circle cx={x(idx(ultimo))} cy={y(ultimo.valor)} r={4} fill="currentColor" stroke="white" strokeWidth={2} />
      {pts.map((p) => (
        <circle key={p.periodo} cx={x(idx(p))} cy={y(p.valor)} r={9} fill="transparent">
          <title>{`${rotuloMes(p.periodo)}: ${formatarValor(p.valor, kpi.unidade)}${kpi.meta != null ? ` (meta ${formatarValor(kpi.meta, kpi.unidade)})` : ""}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export { farol };
