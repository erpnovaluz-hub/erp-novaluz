"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePode } from "@/components/AcessoProvider";
import { normalizar } from "@/lib/planilha";
import { DESTINOS, type DestinoTipo } from "@/lib/almox";
import { catLabel, type Ferramenta } from "@/lib/ferramentas";
import LeitorQr from "@/components/ferramentas/LeitorQr";

type Opcao = { id: string; nome: string };

// Cautela: colaborador + destino + previsão de devolução + ferramentas disponíveis.
export default function CautelaNova() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const params = useSearchParams();
  const podeEditar = usePode("estoque", "editar");
  const [disponiveis, setDisponiveis] = useState<Ferramenta[]>([]);
  const [escolhidas, setEscolhidas] = useState<string[]>(() => (params.get("f") ?? "").split(",").filter(Boolean));
  const [equipe, setEquipe] = useState<Opcao[]>([]);
  const [destinos, setDestinos] = useState<Record<DestinoTipo, Opcao[]>>({ os: [], obra: [], setor: [] });
  const [colab, setColab] = useState("");
  const [destTipo, setDestTipo] = useState<DestinoTipo | "">("");
  const [destId, setDestId] = useState("");
  const [previsao, setPrevisao] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); });
  const [obs, setObs] = useState("");
  const [busca, setBusca] = useState("");
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("ferramentas").select("*").eq("status", "disponivel").order("codigo").range(0, 9999),
      supabase.from("vw_equipe").select("id, nome").eq("ativo", true).order("nome").range(0, 4999),
      supabase.from("ordens_servico").select("id, numero, titulo").in("status", ["a_fazer", "em_andamento"]).range(0, 999),
      supabase.from("obras_servicos").select("id, local").in("status", ["planejada", "em_execucao"]).range(0, 999),
      supabase.from("centros_custo").select("id, nome").eq("ativo", true).order("nome"),
    ]).then(([f, e, o, ob, cc]) => {
      setDisponiveis((f.data ?? []) as Ferramenta[]);
      setEquipe(e.data ?? []);
      setDestinos({
        os: ((o.data ?? []) as any[]).map((x) => ({ id: x.id, nome: [x.numero, x.titulo].filter(Boolean).join(" · ") })),
        obra: ((ob.data ?? []) as any[]).map((x) => ({ id: x.id, nome: x.local || "(obra)" })),
        setor: cc.data ?? [],
      });
    });
  }, [supabase]);

  const porId = useMemo(() => Object.fromEntries(disponiveis.map((f) => [f.id, f])), [disponiveis]);
  const lista = escolhidas.map((id) => porId[id]).filter(Boolean) as Ferramenta[];
  const sugestoes = useMemo(() => {
    const q = normalizar(busca);
    if (q.length < 2) return [];
    return disponiveis.filter((f) => !escolhidas.includes(f.id)
      && [f.codigo, f.descricao, f.marca, f.modelo, f.numero_serie].some((x) => normalizar(x).includes(q))).slice(0, 8);
  }, [busca, disponiveis, escolhidas]);

  const lido = useCallback((codigo: string) => {
    setLendo(false);
    const f = disponiveis.find((x) => x.codigo === codigo);
    if (!f) { setErro(`${codigo}: não está disponível (ou não existe).`); return; }
    setErro(null);
    setEscolhidas((l) => (l.includes(f.id) ? l : [...l, f.id]));
  }, [disponiveis]);

  const ok = colab && destTipo && destId && lista.length > 0;

  async function confirmar() {
    if (!ok) return;
    setGravando(true); setErro(null);
    const { data, error } = await supabase.rpc("cautelar_ferramentas", { p: {
      colaborador_id: colab, destino_tipo: destTipo, os_id: destTipo === "os" ? destId : null,
      obra_id: destTipo === "obra" ? destId : null, centro_custo_id: destTipo === "setor" ? destId : null,
      previsao_devolucao: previsao || null, observacao: obs, ferramentas: lista.map((f) => f.id),
    } });
    setGravando(false);
    if (error) { setErro(error.message); return; }
    router.push(`/estoque/cautela/${(data as any).id}?novo=1`);
  }

  if (!podeEditar) return <div className="card mx-auto mt-10 max-w-md p-6 text-center text-sm text-gray-500">Só o almoxarifado registra cautelas.</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">📤 Nova cautela de ferramentas</h1>
        <p className="text-sm text-gray-500">Registra quem levou, para onde e até quando. Gera o termo de cautela para assinatura.</p>
      </div>

      <div className="card space-y-4 p-4">
        <label className="block"><span className="lbl">Quem está levando *</span>
          <select className="inp" value={colab} onChange={(e) => setColab(e.target.value)}>
            <option value="">— colaborador —</option>
            {equipe.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </label>
        <div>
          <span className="lbl">Para onde *</span>
          <div className="grid grid-cols-3 gap-2">
            {DESTINOS.map((d) => (
              <button key={d.key} type="button" onClick={() => { setDestTipo(d.key); setDestId(""); }}
                className={`rounded-lg border py-2 text-sm ${destTipo === d.key ? "border-brand-600 bg-brand-50 font-medium text-brand-700" : "border-gray-200 text-gray-600"}`}>
                {d.icon} {d.label}
              </button>
            ))}
          </div>
          {destTipo && (
            <select className="inp mt-2" value={destId} onChange={(e) => setDestId(e.target.value)}>
              <option value="">— escolher —</option>
              {destinos[destTipo].map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="lbl">Devolver até</span>
            <input type="date" className="inp" value={previsao} onChange={(e) => setPrevisao(e.target.value)} />
          </label>
          <label className="block"><span className="lbl">Observação</span>
            <input className="inp" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="opcional" />
          </label>
        </div>

        <div>
          <span className="lbl">Ferramentas * <span className="font-normal text-gray-400">(só aparecem as disponíveis)</span></span>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input className="inp" placeholder="Buscar por código, nome, série…" value={busca} onChange={(e) => setBusca(e.target.value)} />
              {sugestoes.length > 0 && (
                <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border bg-white shadow-lg">
                  {sugestoes.map((f) => (
                    <li key={f.id}>
                      <button type="button" className="w-full px-3 py-2.5 text-left text-sm hover:bg-gray-100"
                        onClick={() => { setEscolhidas((l) => [...l, f.id]); setBusca(""); }}>
                        <span className="mr-2 font-mono text-xs text-gray-500">{f.codigo}</span>{f.descricao}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button type="button" className="btn-ghost shrink-0 ring-1 ring-gray-200" onClick={() => setLendo(true)}>📷</button>
          </div>
          {lista.length > 0 && (
            <ul className="mt-2 divide-y rounded-lg border">
              {lista.map((f) => (
                <li key={f.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="font-mono text-xs text-gray-500">{f.codigo}</span>
                  <span className="min-w-0 flex-1 truncate">{f.descricao}<span className="ml-2 text-xs text-gray-400">{catLabel(f.categoria)}</span></span>
                  <button type="button" className="px-1 text-gray-300 hover:text-red-500" onClick={() => setEscolhidas((l) => l.filter((x) => x !== f.id))} aria-label="Remover">✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {erro && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}
        <button className="btn-primary w-full py-3" disabled={!ok || gravando} onClick={confirmar}>
          {gravando ? "Registrando…" : `Registrar cautela${lista.length ? ` (${lista.length} ferramenta${lista.length > 1 ? "s" : ""})` : ""}`}
        </button>
      </div>
      {lendo && <LeitorQr onLido={lido} onFechar={() => setLendo(false)} />}
    </div>
  );
}
