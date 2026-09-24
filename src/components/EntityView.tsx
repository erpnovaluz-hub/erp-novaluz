"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getEntity, type FieldDef } from "@/lib/entities";
import { formatCurrency, formatDate, formatDateTime, formatPercent } from "@/lib/format";
import Badge from "@/components/Badge";
import EntityForm from "@/components/EntityForm";
import { useAcesso } from "@/components/AcessoProvider";
import { areaDaRota, podeArea } from "@/lib/permissoes";

type Row = Record<string, any>;
type RefMap = Record<string, { value: string; label: string }[]>;

export default function EntityView({ entityKey }: { entityKey: string }) {
  const entity = getEntity(entityKey)!;
  const supabase = useMemo(() => createClient(), []);
  const acesso = useAcesso();
  const podeEditar = podeArea(acesso, areaDaRota(`/e/${entityKey}`), "editar");
  const verValores = acesso.gerencia;   // valores em R$ (custos, preços, salários): só gerência
  const PAGE_SIZE = 50;
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0); // base 0
  const [refOptions, setRefOptions] = useState<RefMap>({});
  const [refLabels, setRefLabels] = useState<Record<string, Record<string, string>>>({});
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Row | null | undefined>(undefined); // undefined=fechado

  const refFields = useMemo(() => entity.fields.filter((f) => f.type === "ref"), [entity]);

  const carregarRefs = useCallback(async () => {
    const opts: RefMap = {};
    const labels: Record<string, Record<string, string>> = {};
    for (const f of refFields) {
      const t = f.ref!.table;
      const lf = f.ref!.labelField;
      // carrega rótulos em blocos de 1000 (contorna o teto do PostgREST)
      const map: Record<string, string> = {};
      const arr: { value: string; label: string }[] = [];
      for (let de = 0; ; de += 1000) {
        const { data } = await supabase.from(t).select(`id, ${lf}`).order(lf, { ascending: true }).range(de, de + 999);
        if (!data || data.length === 0) break;
        for (const r of data as any[]) { map[r.id] = r[lf] ?? r.id; arr.push({ value: r.id, label: r[lf] ?? r.id }); }
        if (data.length < 1000) break;
      }
      opts[f.key] = arr;
      labels[f.key] = map;
    }
    setRefOptions(opts);
    setRefLabels(labels);
  }, [refFields, supabase]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    const de = pagina * PAGE_SIZE;
    let q = supabase.from(entity.key).select("*", { count: "exact" });
    if (buscaAtiva.trim() && entity.searchField) q = q.ilike(entity.searchField, `%${buscaAtiva.trim()}%`);
    if (entity.orderBy) q = q.order(entity.orderBy.column, { ascending: entity.orderBy.ascending ?? true });
    const { data, error, count } = await q.range(de, de + PAGE_SIZE - 1);
    if (error) setErro(error.message);
    setRows(data ?? []);
    setTotal(count ?? 0);
    setCarregando(false);
  }, [entity, supabase, pagina, buscaAtiva]);

  useEffect(() => { carregarRefs(); }, [carregarRefs]);
  useEffect(() => { carregar(); }, [carregar]);

  async function excluir(row: Row) {
    if (!confirm(`Excluir este registro de ${entity.label.toLowerCase()}?`)) return;
    const { error } = await supabase.from(entity.key).delete().eq("id", row.id);
    if (error) return alert(error.message);
    carregar();
  }

  function aplicarBusca(e: React.FormEvent) {
    e.preventDefault();
    setPagina(0);
    setBuscaAtiva(busca);
  }

  const filtradas = rows;
  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function renderCell(field: FieldDef, row: Row) {
    const v = row[field.key];
    if (field.type === "ref") {
      const nome = refLabels[field.key]?.[v];
      return nome ? <span className="text-gray-700">{nome}</span> : <span className="text-gray-400">—</span>;
    }
    if (field.type === "select") return <Badge value={v} options={field.options} />;
    if (field.type === "boolean") return v ? "Sim" : "Não";
    if (field.type === "currency") return formatCurrency(v);
    if (field.type === "percent") return formatPercent(v);
    if (field.type === "date") return formatDate(v);
    if (field.type === "datetime") return formatDateTime(v);
    return v ?? <span className="text-gray-400">—</span>;
  }

  const colFields = entity.listColumns
    .map((c) => entity.fields.find((f) => f.key === c))
    .filter(Boolean)
    .filter((f) => verValores || f!.type !== "currency") as FieldDef[];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">
            <span>{entity.icon}</span> {entity.labelPlural}
          </h1>
          <p className="text-sm text-gray-500">{total} registro(s)</p>
        </div>
        <div className="flex items-center gap-2">
          {entity.searchField && (
            <form onSubmit={aplicarBusca} className="flex items-center gap-2">
              <input
                className="inp w-48"
                placeholder="Buscar… (Enter)"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
              {buscaAtiva && (
                <button type="button" className="btn-ghost text-xs" onClick={() => { setBusca(""); setBuscaAtiva(""); setPagina(0); }}>limpar</button>
              )}
            </form>
          )}
          {podeEditar && <button className="btn-primary" onClick={() => setEditando(null)}>+ Novo</button>}
        </div>
      </div>

      {erro && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      {/* celular: cartões (título em destaque + demais colunas em pares rótulo/valor) */}
      <div className="card divide-y divide-gray-100 overflow-hidden sm:hidden print:hidden">
        {carregando ? (
          <p className="px-4 py-10 text-center text-sm text-gray-400">Carregando…</p>
        ) : filtradas.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-gray-400">Nenhum registro.</p>
        ) : filtradas.map((row) => {
          const tituloF = colFields.find((f) => f.key === entity.titleField) ?? colFields[0];
          const resto = colFields.filter((f) => f !== tituloF);
          return (
            <div key={row.id} className={`px-4 py-3 ${podeEditar ? "active:bg-gray-50" : ""}`} onClick={() => podeEditar && setEditando(row)}>
              <p className="font-medium text-gray-900">{tituloF ? renderCell(tituloF, row) : "—"}</p>
              {resto.length > 0 && (
                <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  {resto.map((f) => (
                    <div key={f.key} className="min-w-0">
                      <dt className="text-gray-400">{f.label}</dt>
                      <dd className="truncate text-gray-700">{renderCell(f, row)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {(entity.docRoute || podeEditar) && (
                <div className="mt-2 flex gap-4 text-xs">
                  {entity.docRoute && (
                    <Link href={`${entity.docRoute}/${row.id}`} className="text-brand-600" onClick={(e) => e.stopPropagation()}>🖨️ documento</Link>
                  )}
                  {podeEditar && <button className="ml-auto text-red-500" onClick={(e) => { e.stopPropagation(); excluir(row); }}>Excluir</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* computador: tabela */}
      <div className="card hidden overflow-hidden sm:block print:block">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                {colFields.map((f) => (
                  <th key={f.key} className="whitespace-nowrap px-4 py-3">{f.label}</th>
                ))}
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {carregando ? (
                <tr><td colSpan={colFields.length + 1} className="px-4 py-10 text-center text-gray-400">Carregando…</td></tr>
              ) : filtradas.length === 0 ? (
                <tr><td colSpan={colFields.length + 1} className="px-4 py-10 text-center text-gray-400">Nenhum registro.</td></tr>
              ) : (
                filtradas.map((row) => (
                  <tr key={row.id} className={podeEditar ? "cursor-pointer hover:bg-gray-50" : "hover:bg-gray-50"} onClick={() => podeEditar && setEditando(row)}>
                    {colFields.map((f) => (
                      <td key={f.key} className="whitespace-nowrap px-4 py-3">{renderCell(f, row)}</td>
                    ))}
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {entity.docRoute && (
                        <Link href={`${entity.docRoute}/${row.id}`} className="mr-3 text-brand-600 hover:underline" onClick={(e) => e.stopPropagation()}>🖨️ documento</Link>
                      )}
                      {podeEditar && <button className="text-red-500 hover:underline" onClick={(e) => { e.stopPropagation(); excluir(row); }}>Excluir</button>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {total > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-gray-500">
            {pagina * PAGE_SIZE + 1}–{Math.min((pagina + 1) * PAGE_SIZE, total)} de {total}
          </span>
          <div className="flex items-center gap-2">
            <button className="btn-ghost" disabled={pagina === 0} onClick={() => setPagina((p) => Math.max(0, p - 1))}>← Anterior</button>
            <span className="text-gray-500">pág. {pagina + 1}/{totalPaginas}</span>
            <button className="btn-ghost" disabled={pagina + 1 >= totalPaginas} onClick={() => setPagina((p) => p + 1)}>Próxima →</button>
          </div>
        </div>
      )}

      {editando !== undefined && (
        <EntityForm
          entity={entity}
          registro={editando}
          refOptions={refOptions}
          onClose={() => setEditando(undefined)}
          onSaved={() => {
            setEditando(undefined);
            carregar();
          }}
        />
      )}
    </div>
  );
}
