"use client";

import { useMemo, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/format";
import PrintButton from "@/components/PrintButton";

type Linha = {
  data: string;
  peca_nome: string | null;
  servico: string;
  quantidade: number;
  peso_total: number;
  colaborador: string;
  valor_unit: number | string | null;
  valor_total: number | string | null;
};

type Col = "data" | "peca_nome" | "servico" | "quantidade" | "peso_total" | "colaborador" | "valor_unit" | "valor_total";

const nf = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

const COLS: { key: Col; label: string; num?: boolean }[] = [
  { key: "data", label: "Data" },
  { key: "peca_nome", label: "Peça" },
  { key: "servico", label: "Serviço" },
  { key: "quantidade", label: "Qtd", num: true },
  { key: "peso_total", label: "Peso", num: true },
  { key: "colaborador", label: "Funcionário" },
  { key: "valor_unit", label: "V. unit serviço", num: true },
  { key: "valor_total", label: "Valor total", num: true },
];

export default function RelatorioPublicoView({
  empresaNome,
  clienteNome,
  de,
  ate,
  rows,
}: {
  empresaNome: string;
  clienteNome: string;
  de: string;
  ate: string;
  rows: Linha[];
}) {
  const [sortCol, setSortCol] = useState<Col>("data");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const ordenadas = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const va = a[sortCol] as any, vb = b[sortCol] as any;
      const na = typeof va === "number", nb = typeof vb === "number";
      const cmp = na && nb ? va - vb : String(va ?? "").localeCompare(String(vb ?? ""), "pt-BR");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortCol, sortDir]);

  function orderBy(c: Col) {
    if (sortCol === c) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(c); setSortDir("asc"); }
  }

  const tot = rows.reduce(
    (a, r) => ({
      q: a.q + Number(r.quantidade || 0),
      peso: a.peso + Number(r.peso_total || 0),
      valor: a.valor + Number(r.valor_total || 0),
    }),
    { q: 0, peso: 0, valor: 0 },
  );

  const periodo = de || ate ? `${de ? formatDate(de) : "…"} a ${ate ? formatDate(ate) : "…"}` : "Todo o período";

  return (
    <div className="mx-auto min-h-screen max-w-6xl bg-white p-4 md:p-8">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">📄 Relatório de produção</h1>
          {empresaNome && <p className="text-sm text-gray-500">{empresaNome}</p>}
          <p className="mt-1 text-sm text-gray-600">
            Cliente: <b className="text-gray-900">{clienteNome}</b> · Período: <b className="text-gray-900">{periodo}</b>
          </p>
        </div>
        <PrintButton />
      </div>

      <div className="mb-3 flex flex-wrap gap-6 text-sm text-gray-500">
        <span>{rows.length} lançamento(s)</span>
        <span>Peça (qtd): <b className="text-gray-900">{nf(tot.q)}</b></span>
        <span>Peso: <b className="text-gray-900">{nf(tot.peso)} kg</b></span>
        <span>Valor: <b className="text-brand-600">{formatCurrency(tot.valor)}</b></span>
      </div>

      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  className={`cursor-pointer select-none px-3 py-2 hover:bg-gray-100 ${c.num ? "text-right" : ""}`}
                  onClick={() => orderBy(c.key)}
                >
                  {c.label}{sortCol === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {ordenadas.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Nenhum lançamento neste período.</td></tr>
            ) : ordenadas.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{formatDate(r.data)}</td>
                <td className="px-3 py-2">{r.peca_nome ?? "—"}</td>
                <td className="px-3 py-2 text-gray-600">{r.servico}</td>
                <td className="px-3 py-2 text-right tabular-nums">{nf(Number(r.quantidade || 0))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{nf(Number(r.peso_total || 0))}</td>
                <td className="px-3 py-2 text-gray-600">{r.colaborador}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.valor_unit)}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatCurrency(r.valor_total)}</td>
              </tr>
            ))}
          </tbody>
          {ordenadas.length > 0 && (
            <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={3}>Totais</td>
                <td className="px-3 py-2 text-right tabular-nums">{nf(tot.q)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{nf(tot.peso)}</td>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2 text-right tabular-nums text-brand-600">{formatCurrency(tot.valor)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-4 text-center text-xs text-gray-400">Relatório gerado pelo sistema · somente leitura</p>
    </div>
  );
}
