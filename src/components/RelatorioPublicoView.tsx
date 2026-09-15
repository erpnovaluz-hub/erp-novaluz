"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

/** Dropdown de múltipla seleção com checkboxes. */
function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function toggle(opt: string) {
    const next = new Set(selected);
    if (next.has(opt)) next.delete(opt);
    else next.add(opt);
    onChange(next);
  }

  const resumo = selected.size === 0 ? "Todos" : `${selected.size} selecionado(s)`;

  return (
    <div ref={ref} className="relative print:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-[180px] items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
      >
        <span className="truncate">
          <span className="text-gray-500">{label}:</span> {resumo}
        </span>
        <span className="text-gray-400">▾</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-full min-w-[220px] overflow-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs font-medium uppercase text-gray-400">{label}</span>
            {selected.size > 0 && (
              <button
                type="button"
                onClick={() => onChange(new Set())}
                className="text-xs text-brand-600 hover:underline"
              >
                Limpar
              </button>
            )}
          </div>
          {options.length === 0 ? (
            <p className="px-2 py-2 text-sm text-gray-400">Sem opções</p>
          ) : (
            options.map((opt) => (
              <label
                key={opt}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  checked={selected.has(opt)}
                  onChange={() => toggle(opt)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600"
                />
                <span className="truncate">{opt}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

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
  const [servSel, setServSel] = useState<Set<string>>(new Set());
  const [colSel, setColSel] = useState<Set<string>>(new Set());
  const [pecaSel, setPecaSel] = useState<Set<string>>(new Set());

  const servicoOpts = useMemo(
    () => [...new Set(rows.map((r) => r.servico).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [rows],
  );
  const colaboradorOpts = useMemo(
    () => [...new Set(rows.map((r) => r.colaborador).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [rows],
  );
  const pecaOpts = useMemo(
    () =>
      [...new Set(rows.map((r) => r.peca_nome).filter((p): p is string => !!p))].sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
    [rows],
  );

  const filtradas = useMemo(
    () =>
      rows.filter(
        (r) =>
          (servSel.size === 0 || servSel.has(r.servico)) &&
          (colSel.size === 0 || colSel.has(r.colaborador)) &&
          (pecaSel.size === 0 || (r.peca_nome != null && pecaSel.has(r.peca_nome))),
      ),
    [rows, servSel, colSel, pecaSel],
  );

  const ordenadas = useMemo(() => {
    const arr = [...filtradas];
    arr.sort((a, b) => {
      const va = a[sortCol] as any, vb = b[sortCol] as any;
      const na = typeof va === "number", nb = typeof vb === "number";
      const cmp = na && nb ? va - vb : String(va ?? "").localeCompare(String(vb ?? ""), "pt-BR");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtradas, sortCol, sortDir]);

  function orderBy(c: Col) {
    if (sortCol === c) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(c); setSortDir("asc"); }
  }

  const tot = filtradas.reduce(
    (a, r) => ({
      q: a.q + Number(r.quantidade || 0),
      peso: a.peso + Number(r.peso_total || 0),
      valor: a.valor + Number(r.valor_total || 0),
    }),
    { q: 0, peso: 0, valor: 0 },
  );

  const periodo = de || ate ? `${de ? formatDate(de) : "…"} a ${ate ? formatDate(ate) : "…"}` : "Todo o período";
  const temFiltro = servSel.size > 0 || colSel.size > 0 || pecaSel.size > 0;

  const chips: { label: string; onRemove: () => void }[] = [
    ...[...servSel].map((s) => ({
      label: `Serviço: ${s}`,
      onRemove: () => setServSel((prev) => { const n = new Set(prev); n.delete(s); return n; }),
    })),
    ...[...colSel].map((c) => ({
      label: `Funcionário: ${c}`,
      onRemove: () => setColSel((prev) => { const n = new Set(prev); n.delete(c); return n; }),
    })),
    ...[...pecaSel].map((p) => ({
      label: `Peça: ${p}`,
      onRemove: () => setPecaSel((prev) => { const n = new Set(prev); n.delete(p); return n; }),
    })),
  ];

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

      <div className="mb-3 flex flex-wrap items-start gap-3 print:hidden">
        <MultiSelect label="Serviço" options={servicoOpts} selected={servSel} onChange={setServSel} />
        <MultiSelect label="Funcionário" options={colaboradorOpts} selected={colSel} onChange={setColSel} />
        <MultiSelect label="Peça" options={pecaOpts} selected={pecaSel} onChange={setPecaSel} />
        {temFiltro && (
          <button
            type="button"
            onClick={() => { setServSel(new Set()); setColSel(new Set()); setPecaSel(new Set()); }}
            className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {chips.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {chips.map((c, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700"
            >
              {c.label}
              <button
                type="button"
                onClick={c.onRemove}
                className="text-brand-400 hover:text-brand-700 print:hidden"
                aria-label={`Remover ${c.label}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-6 text-sm text-gray-500">
        <span>{filtradas.length} lançamento(s){temFiltro ? ` de ${rows.length}` : ""}</span>
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
