"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/format";
import { numeroBR } from "@/lib/planilha";
import { usePode } from "@/components/AcessoProvider";

// Conferência com o banco: informa o saldo real, o sistema lança a diferença no extrato.
export default function AjustarSaldo({ conta }: { conta: { id: string; nome: string; saldo_atual: number } }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const podeEditar = usePode("financeiro", "editar");
  const [aberto, setAberto] = useState(false);
  const [saldo, setSaldo] = useState("");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);

  if (!podeEditar) return null;

  const atual = Number(conta.saldo_atual ?? 0);
  const real = numeroBR(saldo);
  const valido = real != null && !Number.isNaN(real);
  const dif = valido ? Math.round((real - atual) * 100) / 100 : 0;

  function fechar() { setAberto(false); setSaldo(""); setMotivo(""); setErro(null); }

  async function salvar() {
    if (!valido) { setErro("Informe o saldo real."); return; }
    if (dif === 0) { fechar(); return; }
    setGravando(true); setErro(null);
    const { error } = await supabase.rpc("ajustar_saldo_conta", { p_conta: conta.id, p_saldo_real: real, p_motivo: motivo.trim() || null });
    setGravando(false);
    if (error) { setErro(error.message); return; }
    fechar();
    router.refresh();
  }

  if (!aberto) {
    return <button className="no-print text-xs text-brand-700 hover:underline" onClick={() => setAberto(true)}>Ajustar saldo</button>;
  }

  return (
    <div className="no-print mt-2 w-full rounded-lg border border-brand-200 bg-brand-50/40 p-3 text-sm">
      <p className="mb-2 font-medium text-brand-900">Ajustar saldo · {conta.nome}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <span className="lbl">Saldo no sistema</span>
          <p className="py-2 tabular-nums">{formatCurrency(atual)}</p>
        </div>
        <label className="block"><span className="lbl">Saldo real (banco)</span>
          <input autoFocus inputMode="decimal" className="inp" value={saldo} onChange={(e) => setSaldo(e.target.value)} placeholder="0,00"
            onKeyDown={(e) => { if (e.key === "Enter") salvar(); if (e.key === "Escape") fechar(); }} />
        </label>
        <label className="block"><span className="lbl">Motivo (opcional)</span>
          <input className="inp" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="tarifa, rendimento, conferência…" />
        </label>
      </div>
      {valido && dif !== 0 && (
        <p className={`mt-2 text-xs ${dif > 0 ? "text-green-700" : "text-red-600"}`}>
          Vai lançar um {dif > 0 ? "crédito" : "débito"} de {formatCurrency(Math.abs(dif))} no extrato como "Ajuste de saldo".
        </p>
      )}
      {valido && dif === 0 && <p className="mt-2 text-xs text-gray-500">Saldo já confere — nada a ajustar.</p>}
      {erro && <p className="mt-2 text-red-600">{erro}</p>}
      <div className="mt-3 flex gap-2">
        <button className="btn-primary" disabled={gravando || !valido} onClick={salvar}>{gravando ? "Gravando…" : "✓ Confirmar ajuste"}</button>
        <button className="btn-ghost" onClick={fechar}>Cancelar</button>
      </div>
    </div>
  );
}
