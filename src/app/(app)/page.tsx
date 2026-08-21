import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { coletarAlertas, type Alerta } from "@/lib/alertas";
import { formatCurrency } from "@/lib/format";
import Badge from "@/components/Badge";

export const dynamic = "force-dynamic";

const ETAPAS = [
  { value: "prospeccao", label: "Prospecção", color: "gray" },
  { value: "proposta_enviada", label: "Proposta enviada", color: "blue" },
  { value: "negociacao", label: "Negociação", color: "amber" },
  { value: "fechado_ganho", label: "Ganho", color: "green" },
  { value: "fechado_perdido", label: "Perdido", color: "red" },
];

const NIVEL_STYLE: Record<Alerta["nivel"], string> = {
  alto: "border-red-300 bg-red-50 text-red-800",
  medio: "border-amber-300 bg-amber-50 text-amber-800",
  info: "border-blue-300 bg-blue-50 text-blue-800",
};

export default async function Dashboard() {
  const supabase = createClient();
  const agora = new Date();
  const mesAtual = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
  const mesNome = agora.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  const [
    { count: nClientes }, { data: oport }, { count: nTarefas },
    { data: contas }, { data: titulosAbertos }, { data: dre },
    { data: saldosEst }, { count: nOsAbertas }, { data: prod },
  ] = await Promise.all([
    supabase.from("clientes").select("*", { count: "exact", head: true }).eq("status", "ativo"),
    supabase.from("oportunidades").select("etapa, valor_estimado"),
    supabase.from("tarefas_followup").select("*", { count: "exact", head: true }).in("status", ["aberta", "em_andamento"]),
    supabase.from("contas_bancarias").select("saldo_atual").eq("ativo", true),
    supabase.from("vw_titulos_resumo").select("tipo, total").eq("status", "aberto"),
    supabase.from("vw_dre").select("competencia, tipo, total"),
    supabase.from("saldos_estoque").select("quantidade, produtos(custo_medio, estoque_minimo)"),
    supabase.from("ordens_servico").select("*", { count: "exact", head: true }).in("status", ["a_fazer", "em_andamento"]),
    supabase.from("vw_producao_cliente").select("valor_total"),
  ]);

  // comercial
  const pipelineAberto = (oport ?? [])
    .filter((o: any) => !["fechado_ganho", "fechado_perdido"].includes(o.etapa))
    .reduce((s: number, o: any) => s + (Number(o.valor_estimado) || 0), 0);
  const temOport = (oport ?? []).length > 0;
  const porEtapa = ETAPAS.map((e) => ({
    ...e,
    qtd: (oport ?? []).filter((o: any) => o.etapa === e.value).length,
    valor: (oport ?? []).filter((o: any) => o.etapa === e.value).reduce((s: number, o: any) => s + (Number(o.valor_estimado) || 0), 0),
  }));

  // financeiro (dados reais em titulos_financeiros / vw_dre)
  const saldoContas = (contas ?? []).reduce((s: number, c: any) => s + Number(c.saldo_atual ?? 0), 0);
  const aReceber = (titulosAbertos ?? []).filter((t: any) => t.tipo === "receber").reduce((s: number, t: any) => s + Number(t.total), 0);
  const aPagar = (titulosAbertos ?? []).filter((t: any) => t.tipo === "pagar").reduce((s: number, t: any) => s + Number(t.total), 0);
  const doMes = (dre ?? []).filter((r: any) => (r.competencia ?? "").slice(0, 7) === mesAtual);
  const receitasMes = doMes.filter((r: any) => r.tipo === "receber").reduce((s: number, r: any) => s + Number(r.total || 0), 0);
  const despesasMes = doMes.filter((r: any) => r.tipo === "pagar").reduce((s: number, r: any) => s + Number(r.total || 0), 0);
  const resultadoMes = receitasMes - despesasMes;

  // operação
  const valorEstoque = (saldosEst ?? []).reduce((s: number, r: any) => s + Number(r.quantidade) * Number(r.produtos?.custo_medio ?? 0), 0);
  const abaixoMin = (saldosEst ?? []).filter((r: any) => Number(r.produtos?.estoque_minimo ?? 0) > 0 && Number(r.quantidade) < Number(r.produtos.estoque_minimo)).length;
  const valorProd = (prod ?? []).reduce((s: number, r: any) => s + Number(r.valor_total || 0), 0);

  const alertas = await coletarAlertas();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Painel</h1>
        <p className="text-sm text-gray-500">Visão geral da MSFORT · dados ao vivo do Supabase</p>
      </div>

      {/* Alertas */}
      <section>
        <SectionTitle icon="🔔" texto={`Alertas proativos (${alertas.length})`} />
        {alertas.length === 0 ? (
          <div className="card p-6 text-center text-sm text-gray-400">Nenhum alerta no momento. 🎉</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {alertas.map((a, i) => (
              <Link key={i} href={a.entidade ? `/e/${a.entidade}` : "#"} className={`block rounded-xl border p-4 transition hover:shadow-sm ${NIVEL_STYLE[a.nivel]}`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{a.titulo}</span>
                  <span className="text-[10px] uppercase opacity-70">{a.nivel}</span>
                </div>
                <p className="mt-1 text-sm">{a.detalhe}</p>
                <p className="mt-2 text-[11px] opacity-60">fonte: {a.fonte}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Financeiro */}
      <section>
        <SectionTitle icon="💰" texto={`Financeiro · ${mesNome}`} href="/financeiro/fluxo" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi titulo="Saldo em contas" valor={formatCurrency(saldoContas)} fonte="contas_bancarias" />
          <Kpi titulo="A receber (aberto)" valor={formatCurrency(aReceber)} fonte="titulos_financeiros" cor="text-green-600" />
          <Kpi titulo="A pagar (aberto)" valor={formatCurrency(aPagar)} fonte="titulos_financeiros" cor="text-red-600" />
          <Kpi titulo="Resultado do mês" valor={formatCurrency(resultadoMes)} fonte="vw_dre" cor={resultadoMes >= 0 ? "text-green-600" : "text-red-600"} />
        </div>
        <div className="mt-3 flex flex-wrap gap-6 text-sm text-gray-500">
          <span>Receitas do mês: <b className="text-green-600">{formatCurrency(receitasMes)}</b></span>
          <span>Despesas do mês: <b className="text-red-600">{formatCurrency(despesasMes)}</b></span>
        </div>
      </section>

      {/* Operação */}
      <section>
        <SectionTitle icon="📦" texto="Operação" href="/estoque/saldos" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi titulo="Valor em estoque" valor={formatCurrency(valorEstoque)} fonte="saldos_estoque" />
          <Kpi titulo="Itens abaixo do mínimo" valor={String(abaixoMin)} fonte="saldos_estoque" cor={abaixoMin > 0 ? "text-red-600" : "text-gray-900"} />
          <Kpi titulo="OS abertas" valor={String(nOsAbertas ?? 0)} fonte="ordens_servico" />
          <Kpi titulo="Produção (valor)" valor={formatCurrency(valorProd)} fonte="producao" />
        </div>
      </section>

      {/* Comercial */}
      <section>
        <SectionTitle icon="🤝" texto="Comercial (CRM)" href="/e/clientes" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <Kpi titulo="Clientes ativos" valor={String(nClientes ?? 0)} fonte="clientes" />
          <Kpi titulo="Pipeline aberto" valor={formatCurrency(pipelineAberto)} fonte="oportunidades" />
          <Kpi titulo="Follow-ups abertos" valor={String(nTarefas ?? 0)} fonte="tarefas_followup" />
        </div>
        {temOport && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {porEtapa.map((e) => (
              <div key={e.value} className="card p-4">
                <Badge value={e.value} options={ETAPAS} />
                <p className="mt-3 text-2xl font-semibold text-gray-900">{e.qtd}</p>
                <p className="text-xs text-gray-500">{formatCurrency(e.valor)}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SectionTitle({ icon, texto, href }: { icon: string; texto: string; href?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between border-b border-gray-200 pb-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
        <span>{icon}</span> {texto}
      </h2>
      {href && <Link href={href} className="text-xs text-brand-600 hover:underline">ver →</Link>}
    </div>
  );
}

function Kpi({ titulo, valor, fonte, cor = "text-gray-900" }: { titulo: string; valor: string; fonte: string; cor?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-gray-500">{titulo}</p>
      <p className={`mt-1 text-2xl font-semibold ${cor}`}>{valor}</p>
      <p className="mt-1 text-[10px] text-gray-400">fonte: {fonte}</p>
    </div>
  );
}
