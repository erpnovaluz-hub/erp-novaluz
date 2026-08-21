import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/format";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";
const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

export default async function GerencialPage({ searchParams }: { searchParams: { ano?: string } }) {
  const supabase = createClient();

  const [
    { data: dre }, { data: titAbertos }, { data: contas },
    { count: nClientes }, { data: os }, { data: saldosEst },
  ] = await Promise.all([
    supabase.from("vw_dre").select("competencia, grupo_dre, natureza, tipo, total"),
    supabase.from("vw_titulos_resumo").select("tipo, total").eq("status", "aberto"),
    supabase.from("contas_bancarias").select("saldo_atual").eq("ativo", true),
    supabase.from("clientes").select("*", { count: "exact", head: true }).eq("status", "ativo"),
    supabase.from("ordens_servico").select("status, custo_estimado"),
    supabase.from("saldos_estoque").select("quantidade, produtos(custo_medio, estoque_minimo)"),
  ]);

  const anos = Array.from(new Set((dre ?? []).map((r: any) => (r.competencia ?? "").slice(0, 4)).filter(Boolean))).sort().reverse();
  const ano = searchParams.ano ?? anos[0] ?? String(new Date().getFullYear());
  const doAno = (dre ?? []).filter((r: any) => (r.competencia ?? "").slice(0, 4) === ano);

  const soma = (g: string, nat?: string) => doAno.filter((r: any) => r.grupo_dre === g && (!nat || r.natureza === nat)).reduce((s: number, r: any) => s + Number(r.total || 0), 0);
  const receita = soma("receita"), deducao = soma("deducao"), custo = soma("custo");
  const despOp = soma("despesa_operacional"), despFin = soma("despesa_financeira");
  const outrasR = soma("outras", "receita"), outrasD = soma("outras", "despesa");
  const receitaLiq = receita - deducao, lucroBruto = receitaLiq - custo;
  const resultado = lucroBruto - despOp - despFin + outrasR - outrasD;

  const receitasAno = doAno.filter((r: any) => r.tipo === "receber").reduce((s: number, r: any) => s + Number(r.total || 0), 0);
  const despesasAno = doAno.filter((r: any) => r.tipo === "pagar").reduce((s: number, r: any) => s + Number(r.total || 0), 0);

  const aReceber = (titAbertos ?? []).filter((t: any) => t.tipo === "receber").reduce((s: number, t: any) => s + Number(t.total || 0), 0);
  const aPagar = (titAbertos ?? []).filter((t: any) => t.tipo === "pagar").reduce((s: number, t: any) => s + Number(t.total || 0), 0);
  const saldo = (contas ?? []).reduce((s: number, c: any) => s + Number(c.saldo_atual || 0), 0);

  // evolução mensal
  const meses = MESES.map((nome, i) => {
    const mm = String(i + 1).padStart(2, "0");
    const linhas = doAno.filter((r: any) => (r.competencia ?? "").slice(5, 7) === mm);
    return {
      nome,
      rec: linhas.filter((r: any) => r.tipo === "receber").reduce((s: number, r: any) => s + Number(r.total || 0), 0),
      desp: linhas.filter((r: any) => r.tipo === "pagar").reduce((s: number, r: any) => s + Number(r.total || 0), 0),
    };
  });
  const maxMes = Math.max(1, ...meses.map((m) => Math.max(m.rec, m.desp)));

  // operação
  const valorEstoque = (saldosEst ?? []).reduce((s: number, r: any) => s + Number(r.quantidade) * Number(r.produtos?.custo_medio ?? 0), 0);
  const abaixoMin = (saldosEst ?? []).filter((r: any) => Number(r.produtos?.estoque_minimo ?? 0) > 0 && Number(r.quantidade) < Number(r.produtos.estoque_minimo)).length;
  const osStatus = (os ?? []).reduce((m: Record<string, number>, r: any) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});
  const custoOs = (os ?? []).reduce((s: number, r: any) => s + Number(r.custo_estimado || 0), 0);

  return (
    <div className="space-y-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">📊 Dashboard Gerencial · {ano}</h1>
          <p className="text-sm text-gray-500">Acumulado do ano em todas as áreas</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="no-print flex gap-1">
            {anos.map((a) => (
              <Link key={a} href={`/gerencial?ano=${a}`} className={`rounded-lg px-3 py-1.5 text-sm ${a === ano ? "bg-brand-600 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"}`}>{a}</Link>
            ))}
          </div>
          <PrintButton />
        </div>
      </div>

      {/* Financeiro do ano */}
      <Secao titulo="Financeiro (acumulado do ano)">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi t="Receitas no ano" v={formatCurrency(receitasAno)} cor="text-green-600" />
          <Kpi t="Despesas no ano" v={formatCurrency(despesasAno)} cor="text-red-600" />
          <Kpi t="Resultado no ano" v={formatCurrency(receitasAno - despesasAno)} cor={receitasAno - despesasAno >= 0 ? "text-green-600" : "text-red-600"} />
          <Kpi t="Saldo em contas" v={formatCurrency(saldo)} />
        </div>
        <div className="mt-3 flex flex-wrap gap-6 text-sm text-gray-500">
          <span>A receber (aberto): <b className="text-green-600">{formatCurrency(aReceber)}</b></span>
          <span>A pagar (aberto): <b className="text-red-600">{formatCurrency(aPagar)}</b></span>
        </div>
      </Secao>

      {/* Evolução mensal */}
      <Secao titulo="Evolução mensal (receitas × despesas)">
        <div className="card p-4">
          <div className="space-y-2">
            {meses.map((m) => (
              <div key={m.nome} className="flex items-center gap-3 text-xs">
                <span className="w-8 shrink-0 text-gray-500">{m.nome}</span>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="h-3 rounded bg-green-500" style={{ width: `${(m.rec / maxMes) * 100}%` }} />
                    <span className="tabular-nums text-gray-500">{formatCurrency(m.rec)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-3 rounded bg-red-400" style={{ width: `${(m.desp / maxMes) * 100}%` }} />
                    <span className="tabular-nums text-gray-500">{formatCurrency(m.desp)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded bg-green-500" /> Receitas</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded bg-red-400" /> Despesas</span>
          </div>
        </div>
      </Secao>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* DRE do ano */}
        <Secao titulo="DRE resumido do ano">
          <div className="card divide-y divide-gray-100 p-2">
            <Linha r="Receita líquida" v={receitaLiq} sub />
            <Linha r="(–) Custos diretos" v={-custo} />
            <Linha r="= Lucro bruto" v={lucroBruto} sub />
            <Linha r="(–) Despesas operacionais" v={-despOp} />
            <Linha r="(–) Despesas financeiras" v={-despFin} />
            <Linha r="= Resultado líquido" v={resultado} total />
          </div>
        </Secao>

        {/* Comercial + Operação */}
        <div className="space-y-6">
          <Secao titulo="Comercial & Estoque">
            <div className="grid grid-cols-2 gap-4">
              <Kpi t="Clientes ativos" v={String(nClientes ?? 0)} />
              <Kpi t="Valor em estoque" v={formatCurrency(valorEstoque)} />
              <Kpi t="Itens abaixo do mínimo" v={String(abaixoMin)} cor={abaixoMin > 0 ? "text-red-600" : "text-gray-900"} />
              <Kpi t="Custo estimado das OS" v={formatCurrency(custoOs)} />
            </div>
          </Secao>
          <Secao titulo="Ordens de Serviço">
            <div className="card divide-y divide-gray-100">
              {[["a_fazer", "A fazer"], ["em_andamento", "Em andamento"], ["concluido", "Concluído"], ["cancelado", "Cancelado"]].map(([k, l]) => (
                <div key={k} className="flex justify-between px-4 py-2 text-sm">
                  <span className="text-gray-600">{l}</span><span className="font-medium">{osStatus[k] ?? 0}</span>
                </div>
              ))}
            </div>
          </Secao>
        </div>
      </div>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 border-b border-gray-200 pb-1 text-sm font-semibold uppercase tracking-wide text-gray-500">{titulo}</h2>
      {children}
    </section>
  );
}
function Kpi({ t, v, cor = "text-gray-900" }: { t: string; v: string; cor?: string }) {
  return <div className="card p-4"><p className="text-xs text-gray-500">{t}</p><p className={`mt-1 text-xl font-semibold ${cor}`}>{v}</p></div>;
}
function Linha({ r, v, sub, total }: { r: string; v: number; sub?: boolean; total?: boolean }) {
  const cls = total ? "font-bold" : sub ? "font-semibold" : "text-gray-700";
  const cor = v < 0 ? "text-red-600" : total || sub ? "text-green-700" : "text-gray-800";
  return <div className={`flex justify-between px-3 py-2 ${sub || total ? "bg-gray-50" : ""}`}><span className={cls}>{r}</span><span className={`${cls} ${cor} tabular-nums`}>{formatCurrency(v)}</span></div>;
}
