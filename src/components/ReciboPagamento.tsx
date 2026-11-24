"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/format";
import { valorPorExtenso } from "@/lib/extenso";
import { useEmissora } from "@/lib/useEmissora";
import DocHeader from "@/components/DocHeader";
import { FORMA_PAGAMENTO } from "@/lib/entities";

type Row = Record<string, any>;

const MESES_LONGOS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto",
  "Setembro", "Outubro", "Novembro", "Dezembro"];

/** "2026-11" → "Novembro/2026" */
export function nomeMes(chave: string) {
  if (!chave) return "Sem data";
  const [a, m] = chave.split("-");
  return `${MESES_LONGOS[parseInt(m) - 1]}/${a}`;
}

/** Agrupa títulos por mês (AAAA-MM) do campo de data escolhido, mantendo a ordem da lista. */
export function agruparPorMes(rows: Row[], campo: string): { chave: string; itens: Row[]; total: number }[] {
  const mapa = new Map<string, Row[]>();
  for (const r of rows) {
    const chave = String(r[campo] ?? r.vencimento ?? "").slice(0, 7);
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave)!.push(r);
  }
  return Array.from(mapa, ([chave, itens]) => ({
    chave, itens, total: itens.reduce((s, r) => s + Number(r.valor || 0), 0),
  }));
}

function dataPorExtenso(iso: string) {
  if (!iso) return "";
  const [a, m, d] = iso.split("-");
  return `${parseInt(d)} de ${MESES_LONGOS[parseInt(m) - 1].toLowerCase()} de ${a}`;
}

/** Sugere o recebedor: fornecedor comum a todos, ou o prefixo "Fulano | …" da descrição. */
function sugerirRecebedor(titulos: Row[], fornNome: Record<string, string>) {
  const forns = new Set(titulos.map((t) => t.fornecedor_id).filter(Boolean));
  if (forns.size === 1 && titulos.every((t) => t.fornecedor_id)) return fornNome[[...forns][0]] ?? "";
  const prefixos = new Set(titulos.map((t) => String(t.descricao ?? "").split("|")[0].trim().toLowerCase()));
  if (prefixos.size === 1 && String(titulos[0]?.descricao ?? "").includes("|")) {
    const p = String(titulos[0].descricao).split("|")[0].trim();
    return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
  }
  return "";
}

export default function ReciboPagamento({
  titulos, campoMes, contas, fornecedores, catNome, subNome, onClose, onBaixado,
}: {
  titulos: Row[];
  campoMes: "competencia" | "vencimento";
  contas: { id: string; nome: string }[];
  fornecedores: { id: string; nome: string }[];
  catNome: Record<string, string>;
  subNome: Record<string, string>;
  onClose: () => void;
  onBaixado: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const EMISSORA = useEmissora();
  const hoje = new Date().toISOString().slice(0, 10);
  const fornNome = useMemo(() => Object.fromEntries(fornecedores.map((f) => [f.id, f.nome])), [fornecedores]);

  const validos = useMemo(() => titulos.filter((t) => t.status !== "cancelado"), [titulos]);
  const emAberto = validos.filter((t) => t.status === "aberto");
  const cancelados = titulos.length - validos.length;

  const [data, setData] = useState(hoje);
  const [recebedor, setRecebedor] = useState(() => sugerirRecebedor(validos, fornNome));
  const [docRecebedor, setDocRecebedor] = useState("");
  const [cidade, setCidade] = useState("");
  const [darBaixa, setDarBaixa] = useState(emAberto.length > 0);
  const [contaId, setContaId] = useState(() => {
    const comuns = new Set(validos.map((t) => t.conta_bancaria_id).filter(Boolean));
    return comuns.size === 1 ? [...comuns][0] as string : "";
  });
  const [forma, setForma] = useState(() => {
    const fs = new Set(validos.map((t) => t.forma_pagamento).filter(Boolean));
    return fs.size === 1 ? [...fs][0] as string : "";
  });
  const [umPorMes, setUmPorMes] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [baixados, setBaixados] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  const grupos = useMemo(() => agruparPorMes(validos, campoMes), [validos, campoMes]);
  const totalGeral = grupos.reduce((s, g) => s + g.total, 0);
  const formaLabel = FORMA_PAGAMENTO.find((o) => o.value === forma)?.label ?? "";

  async function confirmar() {
    setErro(null);
    if (!validos.length) { setErro("Nenhum título válido selecionado."); return; }
    if (!data) { setErro("Informe a data do recibo."); return; }
    if (darBaixa && emAberto.length && baixados === 0) {
      if (!contaId) { setErro("Escolha a conta da baixa."); return; }
      setSalvando(true);
      const payload: Row = { status: "pago", data_pagamento: data, conta_bancaria_id: contaId };
      if (forma) payload.forma_pagamento = forma;
      const { error } = await supabase.from("titulos_financeiros").update(payload).in("id", emAberto.map((t) => t.id));
      setSalvando(false);
      if (error) { setErro(error.message); return; }
      setBaixados(emAberto.length);
    }
    setTimeout(() => window.print(), 100);
  }

  function fechar() {
    if (baixados) onBaixado(); else onClose();
  }

  // blocos do documento: um recibo só (com seções por mês) ou um recibo por mês
  const documentos = umPorMes
    ? grupos.map((g) => ({ chave: g.chave, grupos: [g], total: g.total }))
    : [{ chave: "todos", grupos, total: totalGeral }];

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-black/40 print:static print:overflow-visible print:bg-white">
      <div className="mx-auto my-6 flex max-w-4xl flex-col gap-4 px-4 print:m-0 print:max-w-none print:p-0">
        {/* painel de opções (não imprime) */}
        <div className="no-print card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Recibo de pagamento · {validos.length} título(s) · {formatCurrency(totalGeral)}</h2>
            <button className="text-gray-400 hover:text-gray-700" onClick={fechar} aria-label="Fechar">✕</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="lbl">Data do recibo / pagamento</label>
              <input className="inp" type="date" value={data} onChange={(e) => setData(e.target.value)} disabled={baixados > 0} />
            </div>
            <div>
              <label className="lbl">Recebedor (quem assina)</label>
              <input className="inp" value={recebedor} onChange={(e) => setRecebedor(e.target.value)} placeholder="Nome de quem recebeu" />
            </div>
            <div>
              <label className="lbl">CPF/CNPJ do recebedor</label>
              <input className="inp" value={docRecebedor} onChange={(e) => setDocRecebedor(e.target.value)} placeholder="opcional" />
            </div>
            <div>
              <label className="lbl">Forma de pagamento</label>
              <select className="inp" value={forma} onChange={(e) => setForma(e.target.value)} disabled={baixados > 0}>
                <option value="">—</option>
                {FORMA_PAGAMENTO.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="lbl">Cidade</label>
              <input className="inp" value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="opcional" />
            </div>
            <div className="flex flex-col justify-end gap-1 text-sm text-gray-700">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4" checked={umPorMes} onChange={(e) => setUmPorMes(e.target.checked)} disabled={grupos.length < 2} />
                Um recibo por mês (página separada)
              </label>
            </div>
          </div>

          <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm">
            {baixados > 0 ? (
              <p className="text-green-700">✓ Baixa feita em {baixados} título(s) com data {formatDate(data)}.</p>
            ) : emAberto.length === 0 ? (
              <p className="text-gray-500">Todos os títulos selecionados já estão pagos — o recibo será só impresso.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-gray-700">
                  <input type="checkbox" className="h-4 w-4" checked={darBaixa} onChange={(e) => setDarBaixa(e.target.checked)} />
                  Dar baixa em {emAberto.length} título(s) em aberto na data do recibo
                </label>
                {darBaixa && (
                  <select className="inp !w-auto py-1.5" value={contaId} onChange={(e) => setContaId(e.target.value)}>
                    <option value="">Conta da baixa…</option>
                    {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                )}
              </div>
            )}
            {cancelados > 0 && <p className="mt-1 text-xs text-gray-400">{cancelados} cancelado(s) ficaram fora do recibo.</p>}
          </div>

          {erro && <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-ghost ring-1 ring-gray-200" onClick={fechar}>{baixados ? "Concluir" : "Cancelar"}</button>
            <button className="btn-primary" onClick={confirmar} disabled={salvando}>
              {salvando ? "Salvando…" : darBaixa && emAberto.length && !baixados ? "Dar baixa e imprimir" : "🖨️ Imprimir recibo"}
            </button>
          </div>
        </div>

        {/* documento(s) — é o que vai para o papel */}
        {documentos.map((doc, i) => (
          <div key={doc.chave} className={`doc bg-white p-8 shadow print:p-0 print:shadow-none ${i > 0 ? "page-break" : ""}`}>
            <DocHeader titulo="RECIBO DE PAGAMENTO" subtitulo={umPorMes ? `Referência: ${nomeMes(doc.chave)}` : undefined} />

            <div className="mt-6 flex justify-end">
              <div className="rounded-lg border-2 border-gray-800 px-4 py-2 text-lg font-bold tabular-nums">
                {formatCurrency(doc.total)}
              </div>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-gray-800">
              Recebi de <b>{EMISSORA.nome}</b>{EMISSORA.cnpj ? <>, CNPJ {EMISSORA.cnpj}</> : null}, a importância de{" "}
              <b>{formatCurrency(doc.total)}</b> ({valorPorExtenso(doc.total)}){formaLabel ? <>, paga via <b>{formaLabel}</b></> : null},
              referente {doc.grupos.length > 1 ? "aos pagamentos abaixo discriminados, separados por mês" : `ao(s) pagamento(s) abaixo discriminado(s)`}.
            </p>

            <table className="mt-5 w-full border-collapse text-xs">
              <thead>
                <tr className="border-b-2 border-gray-400 text-left uppercase tracking-wide text-gray-500">
                  <th className="py-1 pr-2">Descrição</th>
                  <th className="py-1 pr-2">Categoria</th>
                  <th className="py-1 pr-2 text-right">{campoMes === "competencia" ? "Competência" : "Vencimento"}</th>
                  <th className="py-1 text-right">Valor</th>
                </tr>
              </thead>
              {doc.grupos.map((g) => (
                <tbody key={g.chave}>
                  {doc.grupos.length > 1 && (
                    <tr><td colSpan={4} className="bg-gray-100 px-1 py-1 font-semibold text-gray-700">{nomeMes(g.chave)}</td></tr>
                  )}
                  {g.itens.map((t) => (
                    <tr key={t.id} className="border-b border-gray-200">
                      <td className="py-1 pr-2">{t.descricao}</td>
                      <td className="py-1 pr-2 text-gray-500">
                        {catNome[t.categoria_id] ?? "—"}{t.subcategoria_id && subNome[t.subcategoria_id] ? ` › ${subNome[t.subcategoria_id]}` : ""}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">{formatDate(t[campoMes] ?? t.vencimento)}</td>
                      <td className="py-1 text-right tabular-nums">{formatCurrency(t.valor)}</td>
                    </tr>
                  ))}
                  {doc.grupos.length > 1 && (
                    <tr className="font-semibold">
                      <td colSpan={3} className="py-1 pr-2 text-right text-gray-600">Subtotal {nomeMes(g.chave)}</td>
                      <td className="py-1 text-right tabular-nums">{formatCurrency(g.total)}</td>
                    </tr>
                  )}
                </tbody>
              ))}
              <tfoot>
                <tr className="border-t-2 border-gray-400 font-bold">
                  <td colSpan={3} className="py-1 pr-2 text-right">Total</td>
                  <td className="py-1 text-right tabular-nums">{formatCurrency(doc.total)}</td>
                </tr>
              </tfoot>
            </table>

            <p className="mt-8 text-sm text-gray-800">{[cidade, dataPorExtenso(data)].filter(Boolean).join(", ")}.</p>

            <div className="mx-auto mt-16 w-80 border-t border-gray-800 pt-1 text-center text-sm">
              <p className="font-medium">{recebedor || " "}</p>
              {docRecebedor && <p className="text-xs text-gray-500">CPF/CNPJ {docRecebedor}</p>}
              <p className="text-xs text-gray-500">Recebedor</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
