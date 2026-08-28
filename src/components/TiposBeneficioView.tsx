"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Tipo = { id: string; nome: string; ativo: boolean; ordem: number };

export default function TiposBeneficioView() {
  const supabase = useMemo(() => createClient(), []);
  const [tipos, setTipos] = useState<Tipo[]>([]);
  const [novo, setNovo] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    const { data, error } = await supabase.from("folha_tipos_beneficio").select("*").order("ordem").order("nome");
    if (error) setErro(error.message);
    setTipos(data ?? []); setCarregando(false);
  }, [supabase]);

  useEffect(() => { carregar(); }, [carregar]);

  async function adicionar() {
    const nome = novo.trim();
    if (!nome) return;
    const ordem = (tipos.reduce((m, t) => Math.max(m, t.ordem), 0) || 0) + 1;
    const { error } = await supabase.from("folha_tipos_beneficio").insert({ nome, ordem });
    if (error) { setErro(error.message); return; }
    setNovo(""); carregar();
  }
  async function renomear(t: Tipo) {
    const nome = prompt("Nome do benefício:", t.nome)?.trim();
    if (!nome || nome === t.nome) return;
    const { error } = await supabase.from("folha_tipos_beneficio").update({ nome }).eq("id", t.id);
    if (error) { setErro(error.message); return; }
    carregar();
  }
  async function alternar(t: Tipo) {
    const { error } = await supabase.from("folha_tipos_beneficio").update({ ativo: !t.ativo }).eq("id", t.id);
    if (error) { setErro(error.message); return; }
    carregar();
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 flex items-center gap-2 text-xl font-semibold text-gray-900">🎁 Tipos de benefício</h1>
      <p className="mb-4 text-sm text-gray-500">
        Cada tipo vira uma coluna na Folha do mês. Desative os que não usa (não some o histórico já lançado).
      </p>

      {erro && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      <form onSubmit={(e) => { e.preventDefault(); adicionar(); }} className="mb-4 flex gap-2">
        <input className="inp flex-1" placeholder="Novo benefício (ex.: Vale-combustível)" value={novo} onChange={(e) => setNovo(e.target.value)} />
        <button className="btn-primary" type="submit">+ Adicionar</button>
      </form>

      <div className="card divide-y divide-gray-100">
        {carregando ? (
          <div className="px-4 py-10 text-center text-gray-400">Carregando…</div>
        ) : tipos.length === 0 ? (
          <div className="px-4 py-10 text-center text-gray-400">Nenhum benefício cadastrado.</div>
        ) : (
          tipos.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className={`flex-1 ${t.ativo ? "text-gray-900" : "text-gray-400 line-through"}`}>{t.nome}</span>
              <button className="text-sm text-gray-500 hover:text-gray-800" onClick={() => renomear(t)}>renomear</button>
              <button className={`text-sm ${t.ativo ? "text-amber-600 hover:text-amber-700" : "text-green-600 hover:text-green-700"}`} onClick={() => alternar(t)}>
                {t.ativo ? "desativar" : "ativar"}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
