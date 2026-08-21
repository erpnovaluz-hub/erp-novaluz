import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/format";
import ReportHeader from "@/components/ReportHeader";

export const dynamic = "force-dynamic";

const fmtKg = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + " kg";

export default async function RelatorioGerencial() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: perfil } = await supabase
    .from("perfis").select("empresas_consultoras(nome)").eq("id", user?.id ?? "").maybeSingle();
  const empresa = (perfil as any)?.empresas_consultoras?.nome ?? "";

  const [
    { count: nClientes }, { data: resumoTit }, { data: contas },
    { data: dre }, { data: prod }, { data: os },
  ] = await Promise.all([
    supabase.from("clientes").select("*", { count: "exact", head: true }).eq("status", "ativo"),
    supabase.from("vw_titulos_resumo").select("*"),
    supabase.from("contas_bancarias").select("saldo_atual").eq("ativo", true),
    supabase.from("vw_dre").select("*"),
    supabase.from("vw_producao_cliente").select("peso_total, valor_total"),
    supabase.from("ordens_servico").select("status"),
  ]);

  const abertos = (resumoTit ?? []).filter((r: any) => r.status === "aberto");
  const aReceber = abertos.filter((r: any) => r.tipo === "receber").reduce((s: number, r: any) => s + Number(r.total || 0), 0);
  const aPagar = abertos.filter((r: any) => r.tipo === "pagar").reduce((s: number, r: any) => s + Number(r.total || 0), 0);
  const saldo = (contas ?? []).reduce((s: number, c: any) => s + Number(c.saldo_atual || 0), 0);

  // DRE do último ano com dados
  const anos = Array.from(new Set((dre ?? []).map((r: any) => r.competencia?.slice(0, 4)).filter(Boolean))).sort();
  const ano = anos[anos.length - 1] ?? String(new Date().getFullYear());
  const doAno = (dre ?? []).filter((r: any) => r.competencia?.slice(0, 4) === ano);
  const soma = (g: string, nat?: string) => doAno.filter((r: any) => r.grupo_dre === g && (!nat || r.natureza === nat)).reduce((s: number, r: any) => s + Number(r.total || 0), 0);
  const receita = soma("receita"); const deducao = soma("deducao"); const custo = soma("custo");
  const despOp = soma("despesa_operacional"); const despFin = soma("despesa_financeira");
  const outrasR = soma("outras", "receita"); const outrasD = soma("outras", "despesa");
  const receitaLiq = receita - deducao; const lucroBruto = receitaLiq - custo;
  const resultado = lucroBruto - despOp - despFin + outrasR - outrasD;

  const pesoProd = (prod ?? []).reduce((s: number, r: any) => s + Number(r.peso_total || 0), 0);
  const valorProd = (prod ?? []).reduce((s: number, r: any) => s + Number(r.valor_total || 0), 0);

  const osStatus = (os ?? []).reduce((m: Record<string, number>, r: any) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});
  const osLabels: Record<string, string> = { a_fazer: "A fazer", em_andamento: "Em andamento", concluido: "Concluído", cancelado: "Cancelado" };

  return (
    <div className="space-y-6">
      <ReportHeader titulo="Relatório Gerencial" subtitulo="Visão executiva da operação" empresa={empresa} />

      <Secao titulo="Indicadores gerais">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi t="Clientes ativos" v={String(nClientes ?? 0)} />
          <Kpi t="Saldo em contas" v={formatCurrency(saldo)} />
          <Kpi t="A receber (aberto)" v={formatCurrency(aReceber)} cor="text-green-600" />
          <Kpi t="A pagar (aberto)" v={formatCurrency(aPagar)} cor="text-red-600" />
        </div>
      </Secao>

      <Secao titulo={`DRE resumido · ${ano}`}>
        <div className="card divide-y divide-gray-100 p-2">
          <Linha r="Receita líquida" v={receitaLiq} sub />
          <Linha r="(–) Custos diretos" v={-custo} />
          <Linha r="= Lucro bruto" v={lucroBruto} sub />
          <Linha r="(–) Despesas operacionais" v={-despOp} />
          <Linha r="(–) Despesas financeiras" v={-despFin} />
          <Linha r="= Resultado líquido" v={resultado} total />
        </div>
      </Secao>

      <div className="grid gap-6 lg:grid-cols-2">
        <Secao titulo="Produção (Impacto)">
          <div className="grid grid-cols-2 gap-4">
            <Kpi t="Peso total" v={fmtKg(pesoProd)} />
            <Kpi t="Valor total" v={formatCurrency(valorProd)} cor="text-brand-600" />
          </div>
        </Secao>

        <Secao titulo="Ordens de Serviço">
          <div className="card divide-y divide-gray-100">
            {Object.keys(osLabels).map((k) => (
              <div key={k} className="flex justify-between px-4 py-2 text-sm">
                <span className="text-gray-600">{osLabels[k]}</span>
                <span className="font-medium">{osStatus[k] ?? 0}</span>
              </div>
            ))}
          </div>
        </Secao>
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
  return (
    <div className={`flex justify-between px-3 py-2 ${sub || total ? "bg-gray-50" : ""}`}>
      <span className={cls}>{r}</span><span className={`${cls} ${cor} tabular-nums`}>{formatCurrency(v)}</span>
    </div>
  );
}
