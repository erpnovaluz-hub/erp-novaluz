import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CustosObraPage() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vw_custo_obra")
    .select("obra_id, local, custo_orcado, custo_material, custo_mao_obra, custo_real, saldo_orcamento, clientes(nome)")
    .order("custo_real", { ascending: false });

  const rows = (data ?? []) as any[];

  return (
    <div>
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">🧮 Custos por obra / OS</h1>
        <p className="text-sm text-gray-500">fonte: vw_custo_obra (material de produção + mão de obra) × custo orçado</p>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error.message}</div>}

      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Obra</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3 text-right">Material</th>
              <th className="px-4 py-3 text-right">Mão de obra</th>
              <th className="px-4 py-3 text-right">Custo real</th>
              <th className="px-4 py-3 text-right">Orçado</th>
              <th className="px-4 py-3 text-right">Saldo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Nenhuma obra com custo ainda.</td></tr>
            ) : (
              rows.map((r) => {
                const estourou = Number(r.saldo_orcamento) < 0;
                return (
                  <tr key={r.obra_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">{r.local ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{r.clientes?.nome ?? "—"}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(r.custo_material)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(r.custo_mao_obra)}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(r.custo_real)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(r.custo_orcado)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${estourou ? "text-red-600" : "text-green-600"}`}>
                      {formatCurrency(r.saldo_orcamento)}
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
