import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/format";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";
const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

export default async function FluxoPage({ searchParams }: { searchParams: { ano?: string } }) {
  const supabase = createClient();
  const [{ data: fluxo }, { data: contas }] = await Promise.all([
    supabase.from("vw_fluxo_mensal").select("*"),
    supabase.from("contas_bancarias").select("nome, tipo, saldo_atual").eq("ativo", true).order("nome"),
  ]);

  const linhas = (fluxo ?? []) as any[];
  const saldoContas = (contas ?? []).reduce((s: number, c: any) => s + Number(c.saldo_atual ?? 0), 0);

  const anos = Array.from(new Set(linhas.map((l) => (l.mes ?? "").slice(0, 4)).filter(Boolean))).sort().reverse();
  // padrão: ano atual se tiver dados; senão o ano com mais movimento realizado; senão o mais recente
  const anoAtual = String(new Date().getFullYear());
  const realizadoPorAno: Record<string, number> = {};
  for (const l of linhas) {
    const a = (l.mes ?? "").slice(0, 4);
    realizadoPorAno[a] = (realizadoPorAno[a] || 0) + Number(l.entradas || 0) + Number(l.saidas || 0);
  }
  const anoComMovimento = Object.entries(realizadoPorAno).sort((a, b) => b[1] - a[1])[0]?.[0];
  const ano = searchParams.ano ?? (anos.includes(anoAtual) && realizadoPorAno[anoAtual] ? anoAtual : (anoComMovimento ?? anos[0] ?? anoAtual));
  const doAno = linhas.filter((l) => (l.mes ?? "").slice(0, 4) === ano).sort((a, b) => a.mes.localeCompare(b.mes));

  let acum = 0;
  const meses = doAno.map((l) => {
    const liquido = Number(l.entradas || 0) - Number(l.saidas || 0);
    acum += liquido;
    return { ...l, liquido, acum };
  });

  const totEnt = doAno.reduce((s, l) => s + Number(l.entradas || 0), 0);
  const totSai = doAno.reduce((s, l) => s + Number(l.saidas || 0), 0);
  const totRec = doAno.reduce((s, l) => s + Number(l.a_receber || 0), 0);
  const totPag = doAno.reduce((s, l) => s + Number(l.a_pagar || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">💵 Fluxo de caixa · {ano}</h1>
          <p className="text-sm text-gray-500">Realizado (pago) e previsto (em aberto), por mês</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="no-print flex flex-wrap gap-1">
            {anos.map((a) => (
              <Link key={a} href={`/financeiro/fluxo?ano=${a}`} className={`rounded-lg px-3 py-1.5 text-sm ${a === ano ? "bg-brand-600 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"}`}>{a}</Link>
            ))}
          </div>
          <PrintButton />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card t="Saldo em contas" v={formatCurrency(saldoContas)} />
        <Card t="Entradas no ano" v={formatCurrency(totEnt)} cor="text-green-600" />
        <Card t="Saídas no ano" v={formatCurrency(totSai)} cor="text-red-600" />
        <Card t="Líquido realizado" v={formatCurrency(totEnt - totSai)} cor={totEnt - totSai >= 0 ? "text-green-600" : "text-red-600"} />
      </div>

      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Mês</th>
              <th className="px-4 py-2 text-right">Entradas</th>
              <th className="px-4 py-2 text-right">Saídas</th>
              <th className="px-4 py-2 text-right">Líquido</th>
              <th className="px-4 py-2 text-right">Saldo acum.</th>
              <th className="px-4 py-2 text-right">A receber (aberto)</th>
              <th className="px-4 py-2 text-right">A pagar (aberto)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {meses.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Sem lançamentos neste ano.</td></tr>
            ) : meses.map((m) => (
              <tr key={m.mes} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-medium">{MESES[parseInt(m.mes.slice(5, 7)) - 1]}/{m.mes.slice(2, 4)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-green-600">{formatCurrency(m.entradas)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-red-600">{formatCurrency(m.saidas)}</td>
                <td className={`px-4 py-2 text-right tabular-nums font-medium ${m.liquido >= 0 ? "text-green-700" : "text-red-600"}`}>{formatCurrency(m.liquido)}</td>
                <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatCurrency(m.acum)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-500">{formatCurrency(m.a_receber)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-500">{formatCurrency(m.a_pagar)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
            <tr>
              <td className="px-4 py-2">Total</td>
              <td className="px-4 py-2 text-right tabular-nums text-green-600">{formatCurrency(totEnt)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-red-600">{formatCurrency(totSai)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(totEnt - totSai)}</td>
              <td />
              <td className="px-4 py-2 text-right tabular-nums text-gray-500">{formatCurrency(totRec)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-500">{formatCurrency(totPag)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Contas</h2>
        <div className="card divide-y divide-gray-100">
          {(contas ?? []).length === 0 ? <p className="p-4 text-sm text-gray-400">Nenhuma conta.</p> :
            (contas ?? []).map((c: any, i: number) => (
              <div key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-gray-700">{c.nome} <span className="text-xs text-gray-400">({c.tipo})</span></span>
                <span className="font-medium">{formatCurrency(c.saldo_atual)}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

function Card({ t, v, cor = "text-gray-900" }: { t: string; v: string; cor?: string }) {
  return <div className="card p-4"><p className="text-xs text-gray-500">{t}</p><p className={`mt-1 text-xl font-semibold ${cor}`}>{v}</p></div>;
}
