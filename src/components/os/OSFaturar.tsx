"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { numeroBR } from "@/lib/planilha";

// Faturamento SUGERIDO: a gerência confere e confirma; só então nascem os títulos a receber.
export default function OSFaturar({ os, onFaturado }: { os: Record<string, any>; onFaturado: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [categorias, setCategorias] = useState<{ id: string; nome: string }[]>([]);
  const [valor, setValor] = useState(os.valor_venda != null ? String(os.valor_venda).replace(".", ",") : "");
  const [parcelas, setParcelas] = useState("1");
  const [venc, setVenc] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); });
  const [categoria, setCategoria] = useState("");
  const [descricao, setDescricao] = useState(`Faturamento ${[os.numero, os.titulo].filter(Boolean).join(" — ")}`);
  const [titulos, setTitulos] = useState<any[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);

  useEffect(() => {
    supabase.from("categorias_financeiras").select("id, nome").eq("natureza", "receita").order("nome")
      .then(({ data }) => { setCategorias(data ?? []); setCategoria((c) => c || data?.[0]?.id || ""); });
    if (os.status === "faturada") {
      supabase.from("titulos_financeiros").select("id, descricao, valor, vencimento, status").eq("referencia_id", os.id).eq("tipo", "receber").order("vencimento")
        .then(({ data }) => setTitulos(data ?? []));
    }
  }, [supabase, os.id, os.status]);

  const v = numeroBR(valor);
  const n = Math.max(1, Math.min(60, Number(parcelas) || 1));

  async function faturar() {
    if (v == null || Number.isNaN(v) || v <= 0) { setErro("Informe o valor."); return; }
    if (!confirm(`Gerar ${n} título(s) a receber somando ${formatCurrency(v)} e marcar a OS como faturada?`)) return;
    setGravando(true); setErro(null);
    const { error } = await supabase.rpc("faturar_os", { p: {
      os_id: os.id, valor: v, parcelas: n, primeiro_vencimento: venc, categoria_id: categoria || null, descricao,
    } });
    setGravando(false);
    if (error) { setErro(error.message); return; }
    onFaturado();
  }

  if (os.status === "faturada") {
    return (
      <section className="card border-green-200 bg-green-50/50 p-4 text-sm">
        <p className="font-semibold text-green-900">💵 Faturada{os.faturada_em ? ` em ${formatDateTime(os.faturada_em)}` : ""}</p>
        <ul className="mt-2 divide-y divide-green-100">
          {titulos.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-1.5">
              <span className="min-w-0 flex-1 truncate">{t.descricao}</span>
              <span className="text-xs text-gray-500">vence {formatDate(t.vencimento)}</span>
              <span className="w-24 text-right font-medium tabular-nums">{formatCurrency(t.valor)}</span>
              <span className={`text-xs ${t.status === "pago" ? "text-green-700" : "text-gray-500"}`}>{t.status === "pago" ? "recebido" : "em aberto"}</span>
            </li>
          ))}
        </ul>
        <Link href="/financeiro/receber" className="mt-2 inline-block text-xs text-brand-700 hover:underline">ver em Contas a Receber →</Link>
      </section>
    );
  }
  if (os.status !== "concluido") return null;

  const parcela = v && !Number.isNaN(v) ? v / n : 0;
  return (
    <section className="card border-brand-200 bg-brand-50/40 p-4 text-sm">
      <p className="mb-3 font-semibold text-brand-900">💵 Faturar esta OS <span className="font-normal text-gray-500">· confira e confirme</span></p>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block"><span className="lbl">Valor total</span>
          <input inputMode="decimal" className="inp" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
        </label>
        <label className="block"><span className="lbl">Parcelas</span>
          <input type="number" min={1} max={60} className="inp" value={parcelas} onChange={(e) => setParcelas(e.target.value)} />
        </label>
        <label className="block"><span className="lbl">1º vencimento</span>
          <input type="date" className="inp" value={venc} onChange={(e) => setVenc(e.target.value)} />
        </label>
        <label className="block"><span className="lbl">Categoria (receita)</span>
          <select className="inp" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="">—</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
      </div>
      <input className="inp mt-3" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
      {n > 1 && parcela > 0 && <p className="mt-2 text-xs text-gray-600">{n}× de ~{formatCurrency(parcela)}, vencendo todo mês a partir de {formatDate(venc)}.</p>}
      {os.valor_venda == null && <p className="mt-2 text-xs text-amber-700">A OS não tem valor de venda: informe o valor a faturar.</p>}
      {erro && <p className="mt-2 text-red-600">{erro}</p>}
      <button className="btn-primary mt-3" disabled={gravando} onClick={faturar}>{gravando ? "Gerando…" : "✓ Confirmar faturamento"}</button>
    </section>
  );
}
