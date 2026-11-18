"use client";

import { useState } from "react";

type Acao = {
  id: string;
  ferramenta: string;
  faixa: string;
  justificativa: string | null;
  parametros: Record<string, any> | null;
  criado_em: string;
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
function valorDe(a: Acao): number | null {
  const p = a.parametros || {};
  const v = p.custo_estimado ?? p.custo_unitario;
  return typeof v === "number" ? v : null;
}

export default function FilaAprovacao({ inicial }: { inicial: Acao[] }) {
  const [acoes, setAcoes] = useState<Acao[]>(inicial);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);

  const amarelas = acoes.filter((a) => a.faixa === "amarela");
  const vermelhas = acoes.filter((a) => a.faixa === "vermelha");

  function toggle(id: string) {
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function remover(ids: string[]) {
    setAcoes((as) => as.filter((a) => !ids.includes(a.id)));
    setSel((s) => {
      const n = new Set(s);
      ids.forEach((i) => n.delete(i));
      return n;
    });
  }

  async function aprovarLote(ids: string[]) {
    if (ids.length === 0 || ocupado) return;
    setOcupado(true);
    try {
      const r = await fetch("/api/agente/aprovar-lote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao_ids: ids }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return alert(data?.error ?? "Falha ao aprovar.");
      const ok = (data.resultados ?? []).filter((x: any) => x.status === "executada").map((x: any) => x.id);
      const falhas = (data.resultados ?? []).filter((x: any) => x.erro);
      remover(ok);
      if (falhas.length) alert(falhas.map((f: any) => `• ${f.erro}`).join("\n"));
    } finally {
      setOcupado(false);
    }
  }

  async function decidir(id: string, decisao: "confirmar" | "cancelar") {
    if (ocupado) return;
    setOcupado(true);
    try {
      const r = await fetch("/api/agente/decidir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao_id: id, decisao }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return alert(data?.error ?? "Falha.");
      remover([id]);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Para aprovar ({amarelas.length})</h2>
          {amarelas.length > 0 && (
            <div className="flex gap-2">
              <button onClick={() => aprovarLote([...sel])} disabled={ocupado || sel.size === 0} className="rounded-lg border px-3 py-1 text-xs disabled:opacity-40">
                Aprovar selecionadas ({sel.size})
              </button>
              <button onClick={() => aprovarLote(amarelas.map((a) => a.id))} disabled={ocupado} className="rounded-lg bg-green-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">
                Aprovar tudo
              </button>
            </div>
          )}
        </div>
        {amarelas.length === 0 && <p className="text-sm text-gray-400">Nada pendente.</p>}
        <div className="space-y-2">
          {amarelas.map((a) => {
            const v = valorDe(a);
            return (
              <div key={a.id} className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2">
                <input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} className="mt-1" />
                <div className="flex-1 text-sm">
                  <p>{a.justificativa ?? a.ferramenta}</p>
                  {v !== null && v > 0 && <p className="text-sm font-bold text-amber-900">Valor: {brl(v)}</p>}
                </div>
                <button onClick={() => decidir(a.id, "cancelar")} disabled={ocupado} className="text-xs text-gray-500 hover:text-red-600">Cancelar</button>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Exigem confirmação individual ({vermelhas.length})</h2>
        <p className="mb-2 text-xs text-gray-400">Ações de maior risco (ex.: faturar, baixar título, receber pedido) nunca entram em “Aprovar tudo”.</p>
        {vermelhas.length === 0 && <p className="text-sm text-gray-400">Nenhuma.</p>}
        <div className="space-y-2">
          {vermelhas.map((a) => {
            const v = valorDe(a);
            return (
              <div key={a.id} className="rounded-lg border border-red-300 bg-red-50 p-2 text-sm">
                <p>{a.justificativa ?? a.ferramenta}</p>
                {v !== null && v > 0 && <p className="font-bold text-red-900">Valor: {brl(v)}</p>}
                <div className="mt-1 flex gap-2">
                  <button onClick={() => decidir(a.id, "confirmar")} disabled={ocupado} className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">Confirmar</button>
                  <button onClick={() => decidir(a.id, "cancelar")} disabled={ocupado} className="text-xs text-gray-500 hover:text-red-600">Cancelar</button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
