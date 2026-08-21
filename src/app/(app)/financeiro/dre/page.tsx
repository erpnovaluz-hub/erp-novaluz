import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/format";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";
const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

type Row = { competencia: string; grupo_dre: string; natureza: string | null; tipo: string; total: number };

export default async function DrePage({ searchParams }: { searchParams: { ano?: string } }) {
  const supabase = createClient();
  const { data } = await supabase.from("vw_dre").select("*");
  const rows = (data ?? []) as Row[];

  const anos = Array.from(new Set(rows.map((r) => r.competencia?.slice(0, 4)).filter(Boolean))).sort().reverse();
  const ano = searchParams.ano ?? anos[0] ?? String(new Date().getFullYear());

  const soma = (mm: string, g: string, nat?: string) =>
    rows.filter((r) => r.competencia?.slice(0, 4) === ano && r.competencia?.slice(5, 7) === mm && r.grupo_dre === g && (!nat || r.natureza === nat))
      .reduce((s, r) => s + Number(r.total || 0), 0);

  // valores por mês (01..12) + total
  const cols = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
  const calc = (mm: string) => {
    const receita = soma(mm, "receita"), deducao = soma(mm, "deducao"), custo = soma(mm, "custo");
    const despOp = soma(mm, "despesa_operacional"), despFin = soma(mm, "despesa_financeira");
    const outrasR = soma(mm, "outras", "receita"), outrasD = soma(mm, "outras", "despesa");
    const receitaLiq = receita - deducao, lucroBruto = receitaLiq - custo, resultadoOp = lucroBruto - despOp;
    const resultado = resultadoOp - despFin + outrasR - outrasD;
    return { receita, deducao, custo, despOp, despFin, outras: outrasR - outrasD, receitaLiq, lucroBruto, resultadoOp, resultado };
  };
  const porMes = cols.map(calc);
  const total = porMes.reduce((a, m) => {
    const o: any = {}; for (const k of Object.keys(m)) o[k] = (a[k] || 0) + (m as any)[k]; return o;
  }, {} as any);

  const LINHAS: { rot: string; k: string; sinal?: number; sub?: boolean; tot?: boolean }[] = [
    { rot: "Receita bruta", k: "receita" },
    { rot: "(–) Deduções", k: "deducao", sinal: -1 },
    { rot: "= Receita líquida", k: "receitaLiq", sub: true },
    { rot: "(–) Custos diretos", k: "custo", sinal: -1 },
    { rot: "= Lucro bruto", k: "lucroBruto", sub: true },
    { rot: "(–) Despesas operacionais", k: "despOp", sinal: -1 },
    { rot: "= Resultado operacional", k: "resultadoOp", sub: true },
    { rot: "(–) Despesas financeiras", k: "despFin", sinal: -1 },
    { rot: "(+/–) Outras", k: "outras" },
    { rot: "= RESULTADO LÍQUIDO", k: "resultado", tot: true },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">📈 DRE mensal · {ano}</h1>
          <p className="text-sm text-gray-500">Por competência · fonte: titulos_financeiros × categorias</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="no-print flex gap-1">
            {anos.map((a) => (
              <Link key={a} href={`/financeiro/dre?ano=${a}`} className={`rounded-lg px-3 py-1.5 text-sm ${a === ano ? "bg-brand-600 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"}`}>{a}</Link>
            ))}
          </div>
          <PrintButton />
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="sticky left-0 bg-gray-50 px-3 py-2 text-left">Conta</th>
              {MESES.map((m) => <th key={m} className="px-2 py-2 text-right">{m}</th>)}
              <th className="px-3 py-2 text-right font-bold">Ano</th>
            </tr>
          </thead>
          <tbody>
            {LINHAS.map((l) => (
              <tr key={l.k} className={`${l.sub || l.tot ? "bg-gray-50 font-semibold" : ""} ${l.tot ? "border-t-2 border-brand-600 text-base" : "border-t border-gray-100"}`}>
                <td className="sticky left-0 whitespace-nowrap bg-inherit px-3 py-1.5 text-left">{l.rot}</td>
                {porMes.map((m, i) => {
                  const v = (m as any)[l.k] * (l.sinal ?? 1);
                  return <td key={i} className={`px-2 py-1.5 text-right tabular-nums ${v < 0 ? "text-red-600" : ""}`}>{v ? formatCurrency(v) : "—"}</td>;
                })}
                <td className={`px-3 py-1.5 text-right font-bold tabular-nums ${(total[l.k] * (l.sinal ?? 1)) < 0 ? "text-red-600" : "text-brand-700"}`}>
                  {formatCurrency(total[l.k] * (l.sinal ?? 1))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
