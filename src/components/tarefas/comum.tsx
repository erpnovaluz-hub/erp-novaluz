"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import { iniciais, type Pessoa } from "@/lib/tarefas";

// Pessoas da empresa que podem receber tarefas (usuários ativos com login).
export function useEquipe() {
  const supabase = useMemo(() => createClient(), []);
  const { empresaId } = useAcesso();
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  useEffect(() => {
    if (!empresaId) return;
    supabase.from("perfis").select("id, nome, email, ativo").eq("empresa_consultora_id", empresaId).neq("papel", "super")
      .order("nome").then(({ data }) => setPessoas(((data ?? []) as any[]).filter((p) => p.ativo !== false)));
  }, [supabase, empresaId]);
  const porId = useMemo(() => Object.fromEntries(pessoas.map((p) => [p.id, p])) as Record<string, Pessoa>, [pessoas]);
  return { pessoas, porId };
}

const PALETA = ["#0d9488", "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#65a30d", "#0891b2", "#9333ea"];

export function Avatar({ pessoa, size = 24 }: { pessoa?: Pessoa | null; size?: number }) {
  if (!pessoa) {
    return (
      <span className="inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-gray-300 text-[10px] text-gray-400"
        style={{ width: size, height: size }} title="Sem responsável">?</span>
    );
  }
  const cor = PALETA[[...pessoa.id].reduce((s, c) => s + c.charCodeAt(0), 0) % PALETA.length];
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: cor, fontSize: size * 0.4 }} title={pessoa.nome ?? pessoa.email ?? ""}>
      {iniciais(pessoa)}
    </span>
  );
}

export function Check({ feito, onClick, size = 18 }: { feito: boolean; onClick: () => void; size?: number }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label={feito ? "Reabrir tarefa" : "Concluir tarefa"}
      className={`alvo-toque inline-flex shrink-0 items-center justify-center rounded-full border transition ${feito ? "border-green-600 bg-green-600 text-white" : "border-gray-300 text-transparent hover:border-green-600 hover:text-green-600"}`}
      style={{ width: size, height: size, fontSize: size * 0.6 }}>
      ✓
    </button>
  );
}
