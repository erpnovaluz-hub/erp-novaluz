"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/format";
import { calcularFolha, contarDsrPerdidos, ultimoDiaMes, type FolhaCalc, type Ponto } from "@/lib/folha";
import PrintButton from "@/components/PrintButton";

type Colab = { id: string; nome: string; cargo: string | null };
type Tipo = { id: string; nome: string };
const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const MESES_C = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

type Item = { label: string; valor: number };

export default function DemonstrativoFolha() {
  const supabase = useMemo(() => createClient(), []);
  const hoje = new Date();
  const [ano, setAno] = useState(String(hoje.getFullYear()));
  const [mes, setMes] = useState(String(hoje.getMonth() + 1).padStart(2, "0"));
  const [colaboradorId, setColaboradorId] = useState("");

  const [colabs, setColabs] = useState<Colab[]>([]);
  const [lanc, setLanc] = useState<any | null>(null);
  const [proventos, setProventos] = useState<Item[]>([]);
  const [descontos, setDescontos] = useState<Item[]>([]);
  const [calc, setCalc] = useState<FolhaCalc | null>(null);
  const [carregando, setCarregando] = useState(true);

  const competencia = `${ano}-${mes}-01`;
  const anos = useMemo(() => Array.from({ length: 6 }, (_, i) => String(hoje.getFullYear() - 3 + i)), [hoje]);
  const colab = useMemo(() => colabs.find((c) => c.id === colaboradorId), [colabs, colaboradorId]);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("ano")) setAno(p.get("ano")!);
    if (p.get("mes")) setMes(p.get("mes")!);
    if (p.get("colab")) setColaboradorId(p.get("colab")!);
  }, []);

  useEffect(() => {
    supabase.from("colaboradores").select("id, nome, cargo").eq("ativo", true).order("nome").range(0, 4999)
      .then(({ data }) => {
        setColabs(data ?? []);
        if (!colaboradorId && data && data.length) setColaboradorId(data[0].id);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  const carregar = useCallback(async () => {
    if (!colaboradorId) return;
    setCarregando(true);
    const { data: lancs } = await supabase
      .from("folha_lancamentos").select("*").eq("colaborador_id", colaboradorId).eq("competencia", competencia).limit(1);
    const l = lancs && lancs[0];
    if (!l) { setLanc(null); setCalc(null); setProventos([]); setDescontos([]); setCarregando(false); return; }

    const [tpRes, bnRes] = await Promise.all([
      supabase.from("folha_tipos_beneficio").select("id, nome").order("ordem").range(0, 999),
      supabase.from("folha_lancamento_beneficios").select("tipo_beneficio_id, valor").eq("lancamento_id", l.id),
    ]);
    const tipoNome = Object.fromEntries((tpRes.data ?? []).map((t: Tipo) => [t.id, t.nome]));
    const bens = (bnRes.data ?? []).map((b: any) => ({ label: tipoNome[b.tipo_beneficio_id] ?? "Benefício", valor: Number(b.valor) }));
    const totalBeneficios = bens.reduce((s, b) => s + b.valor, 0);

    const dsrDias = contarDsrPerdidos((l.ponto ?? {}) as Ponto);
    const c = calcularFolha({
      salario: Number(l.salario_liquido), pctAdiantamento: Number(l.pct_adiantamento ?? 40),
      heUtilHoras: Number(l.he_util_horas), heUtilPct: Number(l.he_util_pct ?? 63), heDomingoHoras: Number(l.he_domingo_horas),
      faltas: Number(l.faltas ?? 0), descHoras: Number(l.desc_horas), descValor: Number(l.desc_valor),
      bonificacao: Number(l.bonificacao), adicional: Number(l.adicional), abonoFamilia: Number(l.abono_familia),
      beneficios: totalBeneficios,
      dsrDias,
    });

    const prov: Item[] = [
      { label: "Salário base", valor: Number(l.salario_liquido) },
      { label: `Horas extras ${Number(l.he_util_pct ?? 63)}% (${Number(l.he_util_horas) || 0}h)`, valor: c.extraUtil },
      { label: `Horas extras 100% (${Number(l.he_domingo_horas) || 0}h)`, valor: c.extraDomingo },
      { label: "Bonificação / produção", valor: Number(l.bonificacao) },
      { label: "Adicional", valor: Number(l.adicional) },
      { label: "Abono família", valor: Number(l.abono_familia) },
      ...bens,
    ].filter((i) => i.valor !== 0);

    const desc: Item[] = [
      { label: `Faltas (${Number(l.faltas ?? 0)} dia(s))`, valor: c.descontoFaltas },
      { label: `DSR sobre faltas (${c.dsrDias} DSR)`, valor: c.descontoDSR },
      { label: `Horas descontadas (${Number(l.desc_horas) || 0}h)`, valor: c.descontoHoras },
      { label: "Outros descontos", valor: Number(l.desc_valor) },
    ].filter((i) => i.valor !== 0);

    setLanc(l); setCalc(c); setProventos(prov); setDescontos(desc); setCarregando(false);
  }, [supabase, colaboradorId, competencia]);

  useEffect(() => { carregar(); }, [carregar]);

  const totalProventos = proventos.reduce((s, i) => s + i.valor, 0);
  const totalDescontos = descontos.reduce((s, i) => s + i.valor, 0);

  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">📄 Demonstrativo</h1>
        <div className="flex items-center gap-2">
          <select className="inp !w-auto py-1.5" value={colaboradorId} onChange={(e) => setColaboradorId(e.target.value)}>
            {colabs.length === 0 && <option value="">Nenhum colaborador ativo</option>}
            {colabs.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <select className="inp !w-auto py-1.5" value={mes} onChange={(e) => setMes(e.target.value)}>
            {MESES_C.map((mn, i) => <option key={i} value={String(i + 1).padStart(2, "0")}>{mn}</option>)}
          </select>
          <select className="inp !w-auto py-1.5" value={ano} onChange={(e) => setAno(e.target.value)}>
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <PrintButton />
        </div>
      </div>

      {carregando ? (
        <div className="card px-4 py-16 text-center text-gray-400">Carregando…</div>
      ) : !lanc || !calc ? (
        <div className="card px-4 py-16 text-center text-gray-400">
          Sem lançamento para {colab?.nome} em {MESES[+mes - 1]}/{ano}. Lance na <a className="text-brand-600 hover:underline" href={`/rh/calculadora?colab=${colaboradorId}&mes=${mes}&ano=${ano}`}>Calculadora</a>.
        </div>
      ) : (
        <div className="card mx-auto max-w-3xl p-6 print:shadow-none">
          {/* cabeçalho */}
          <div className="mb-5 flex items-start justify-between border-b border-gray-200 pb-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Demonstrativo de Pagamento</h2>
              <p className="text-sm text-gray-500">Competência: {MESES[+mes - 1]} de {ano}</p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-gray-900">{colab?.nome}</p>
              {colab?.cargo && <p className="text-sm text-gray-500">{colab.cargo}</p>}
            </div>
          </div>

          {/* proventos / descontos */}
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-green-700">Proventos</h3>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-50">
                  {proventos.map((i, k) => (
                    <tr key={k}><td className="py-1.5 text-gray-600">{i.label}</td><td className="py-1.5 text-right tabular-nums text-gray-900">{formatCurrency(i.valor)}</td></tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 font-semibold"><td className="py-2 text-gray-700">Total proventos</td><td className="py-2 text-right tabular-nums text-green-700">{formatCurrency(totalProventos)}</td></tr>
                </tfoot>
              </table>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-700">Descontos</h3>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-50">
                  {descontos.length === 0 ? (
                    <tr><td className="py-1.5 text-gray-400">Sem descontos</td><td className="py-1.5 text-right tabular-nums text-gray-400">—</td></tr>
                  ) : descontos.map((i, k) => (
                    <tr key={k}><td className="py-1.5 text-gray-600">{i.label}</td><td className="py-1.5 text-right tabular-nums text-gray-900">{formatCurrency(i.valor)}</td></tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 font-semibold"><td className="py-2 text-gray-700">Total descontos</td><td className="py-2 text-right tabular-nums text-red-700">{formatCurrency(totalDescontos)}</td></tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* líquido */}
          <div className="mt-5 flex items-center justify-between rounded-lg bg-brand-600 px-4 py-3 text-white">
            <span className="font-medium">Líquido do mês</span>
            <span className="text-xl font-bold tabular-nums">{formatCurrency(calc.totalMes)}</span>
          </div>

          {/* forma de pagamento */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-amber-50 p-3">
              <p className="text-xs text-amber-700">Adiantamento · vence 15/{mes}/{ano.slice(2)} (dia 15)</p>
              <p className="text-lg font-bold tabular-nums text-amber-900">{formatCurrency(calc.adiantamento)}</p>
            </div>
            <div className="rounded-lg bg-blue-50 p-3">
              <p className="text-xs text-blue-700">Fechamento · vence {ultimoDiaMes(competencia).slice(8)}/{mes}/{ano.slice(2)}</p>
              <p className="text-lg font-bold tabular-nums text-blue-900">{formatCurrency(calc.fechamento)}</p>
            </div>
          </div>

          {/* fechamento em camadas (para pagar em dias diferentes) */}
          <div className="mt-3 rounded-lg border border-blue-200 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-700">Fechamento em camadas</p>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-gray-600">1) Só saldo de salário <span className="text-xs text-gray-400">(60% − descontos)</span></span><span className="tabular-nums text-gray-900">{formatCurrency(calc.fechSoSalario)}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">2) + horas extras / proventos</span><span className="tabular-nums text-gray-900">{formatCurrency(calc.fechSalarioExtras)}</span></div>
              <div className="flex justify-between border-t border-gray-100 pt-1 font-semibold"><span className="text-gray-700">3) + benefícios (total)</span><span className="tabular-nums text-blue-700">{formatCurrency(calc.fechamento)}</span></div>
            </div>
          </div>

          <p className="mt-4 text-center text-[11px] text-gray-400">
            Hora {formatCurrency(calc.valorHora)} (÷220) · dia {formatCurrency(calc.valorDia)} (÷30)
            {calc.descontoDSR > 0 && <> · DSR = {calc.dsrDias} semana(s) com falta × 1 diária</>}.
            Documento interno de conferência — não substitui o holerite oficial.
          </p>
        </div>
      )}
    </div>
  );
}
