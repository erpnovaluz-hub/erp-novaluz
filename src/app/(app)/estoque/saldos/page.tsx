import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SaldosPage() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("saldos_estoque")
    .select("quantidade, produtos(nome, unidade, custo_medio, estoque_minimo), depositos(nome)")
    .order("quantidade", { ascending: false });

  const rows = (data ?? []) as any[];
  const valorTotal = rows.reduce((s, r) => s + Number(r.quantidade) * Number(r.produtos?.custo_medio ?? 0), 0);

  return (
    <div>
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">📊 Saldos de estoque</h1>
          <p className="text-sm text-gray-500">fonte: saldos_estoque · custo médio: produtos</p>
        </div>
        <div className="card px-4 py-2 text-right">
          <p className="text-xs text-gray-500">Valor total em estoque</p>
          <p className="text-lg font-semibold text-gray-900">{formatCurrency(valorTotal)}</p>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error.message}</div>}

      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Produto</th>
              <th className="px-4 py-3">Depósito</th>
              <th className="px-4 py-3 text-right">Saldo</th>
              <th className="px-4 py-3 text-right">Custo médio</th>
              <th className="px-4 py-3 text-right">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">Sem saldos ainda.</td></tr>
            ) : (
              rows.map((r, i) => {
                const abaixoMin = Number(r.quantidade) < Number(r.produtos?.estoque_minimo ?? 0);
                return (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      {r.produtos?.nome ?? "—"}
                      {abaixoMin && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700">abaixo do mínimo</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{r.depositos?.nome ?? "—"}</td>
                    <td className="px-4 py-3 text-right">{Number(r.quantidade)} {r.produtos?.unidade ?? ""}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(r.produtos?.custo_medio)}</td>
                    <td className="px-4 py-3 text-right font-medium">
                      {formatCurrency(Number(r.quantidade) * Number(r.produtos?.custo_medio ?? 0))}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
