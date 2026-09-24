"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { numeroBR } from "@/lib/planilha";
import { DESTINOS, qtdBR, type DestinoTipo } from "@/lib/almox";

type Item = { id: string; produto_id: string; quantidade: number; quantidade_atendida: number };
type Opcao = { id: string; nome: string };

// Almoxarifado entrega o que tem da requisição: gera um vale de saída (VS) ligado a ela.
export default function AtenderRequisicao({ req, itens, prodNome, onAtendido }: {
  req: Record<string, any>; itens: Item[]; prodNome: Record<string, string>; onAtendido: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [depositos, setDepositos] = useState<Opcao[]>([]);
  const [deposito, setDeposito] = useState("");
  const [saldos, setSaldos] = useState<Record<string, number>>({});
  const [equipe, setEquipe] = useState<Opcao[]>([]);
  const [destinos, setDestinos] = useState<Record<DestinoTipo, Opcao[]>>({ os: [], obra: [], setor: [] });
  const [colab, setColab] = useState("");
  const [destTipo, setDestTipo] = useState<DestinoTipo | "">(req.destino_tipo ?? "");
  const [destId, setDestId] = useState<string>(req.os_id ?? req.obra_id ?? req.centro_custo_id ?? "");
  const [qtd, setQtd] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const [feito, setFeito] = useState<{ id: string; numero: string } | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from("depositos").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("vw_equipe").select("id, nome").eq("ativo", true).order("nome").range(0, 4999),
      supabase.from("ordens_servico").select("id, numero, titulo").in("status", ["a_fazer", "em_andamento"]).range(0, 999),
      supabase.from("obras_servicos").select("id, local").in("status", ["planejada", "em_execucao"]).range(0, 999),
      supabase.from("centros_custo").select("id, nome").eq("ativo", true).order("nome"),
    ]).then(([d, e, o, ob, cc]) => {
      setDepositos(d.data ?? []);
      let salvo = ""; try { salvo = localStorage.getItem("almox.deposito") ?? ""; } catch {}
      setDeposito((d.data ?? []).some((x) => x.id === salvo) ? salvo : d.data?.[0]?.id ?? "");
      setEquipe(e.data ?? []);
      setDestinos({
        os: ((o.data ?? []) as any[]).map((x) => ({ id: x.id, nome: [x.numero, x.titulo].filter(Boolean).join(" · ") })),
        obra: ((ob.data ?? []) as any[]).map((x) => ({ id: x.id, nome: x.local || "(obra)" })),
        setor: cc.data ?? [],
      });
    });
  }, [supabase]);

  // saldos do depósito escolhido; sugere entregar o que der (mín. entre pendente e saldo)
  useEffect(() => {
    if (!deposito) return;
    supabase.from("saldos_estoque").select("produto_id, quantidade").eq("deposito_id", deposito).range(0, 19999).then(({ data }) => {
      const s = Object.fromEntries(((data ?? []) as any[]).map((r) => [r.produto_id, Number(r.quantidade)]));
      setSaldos(s);
      setQtd(Object.fromEntries(itens.map((it) => {
        const pend = Number(it.quantidade) - Number(it.quantidade_atendida);
        const sug = Math.max(0, Math.min(pend, s[it.produto_id] ?? 0));
        return [it.id, sug ? String(sug).replace(".", ",") : ""];
      })));
    });
  }, [supabase, deposito, itens]);

  const pendentes = itens.filter((it) => Number(it.quantidade) > Number(it.quantidade_atendida));
  const entregar = pendentes.map((it) => ({ it, q: numeroBR(qtd[it.id]) ?? 0 })).filter((x) => x.q > 0);
  const excede = entregar.filter(({ it, q }) => q > Number(it.quantidade) - Number(it.quantidade_atendida) || q > (saldos[it.produto_id] ?? 0));
  const ok = deposito && colab && destTipo && destId && entregar.length > 0 && excede.length === 0;

  async function atender() {
    if (!ok) return;
    setGravando(true); setErro(null);
    const { data, error } = await supabase.rpc("atender_requisicao", { p: {
      requisicao_id: req.id, deposito_id: deposito, colaborador_id: colab, destino_tipo: destTipo,
      os_id: destTipo === "os" ? destId : null, obra_id: destTipo === "obra" ? destId : null,
      centro_custo_id: destTipo === "setor" ? destId : null,
      itens: entregar.map(({ it, q }) => ({ item_id: it.id, quantidade: q })),
    } });
    setGravando(false);
    if (error) { setErro(error.message); return; }
    setFeito(data as any);
    onAtendido();
  }

  if (pendentes.length === 0) return null;

  return (
    <div className="no-print mb-4 rounded-xl border border-green-200 bg-green-50/60 p-4">
      <p className="mb-3 text-sm font-semibold text-green-900">📦 Atender pelo estoque</p>
      {feito && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-white p-3 text-sm">
          ✓ Entregue no vale <b>{feito.numero}</b>.
          <Link href={`/estoque/vale/${feito.id}`} className="font-medium text-brand-700 hover:underline">🖨️ Imprimir vale</Link>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="lbl">Depósito</span>
          <select className="inp" value={deposito} onChange={(e) => setDeposito(e.target.value)}>
            {depositos.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
          </select>
        </label>
        <label className="block"><span className="lbl">Quem retira *</span>
          <select className="inp" value={colab} onChange={(e) => setColab(e.target.value)}>
            <option value="">— colaborador —</option>
            {equipe.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-3">
        <span className="lbl">Destino *</span>
        <div className="flex flex-wrap gap-2">
          <div className="grid flex-1 grid-cols-3 gap-2">
            {DESTINOS.map((d) => (
              <button key={d.key} type="button" onClick={() => { setDestTipo(d.key); setDestId(""); }}
                className={`rounded-lg border bg-white py-1.5 text-sm ${destTipo === d.key ? "border-brand-600 font-medium text-brand-700" : "border-gray-200 text-gray-600"}`}>
                {d.icon} {d.label}
              </button>
            ))}
          </div>
          {destTipo && (
            <select className="inp sm:w-64" value={destId} onChange={(e) => setDestId(e.target.value)}>
              <option value="">— escolher —</option>
              {destinos[destTipo].map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          )}
        </div>
      </div>

      <table className="mt-3 w-full text-sm">
        <thead className="text-left text-xs uppercase text-gray-500">
          <tr><th className="py-1.5">Material</th><th className="py-1.5 text-right">Pendente</th><th className="py-1.5 text-right">Em estoque</th><th className="py-1.5 text-right">Entregar</th></tr>
        </thead>
        <tbody className="divide-y divide-green-100">
          {pendentes.map((it) => {
            const pend = Number(it.quantidade) - Number(it.quantidade_atendida);
            const saldo = saldos[it.produto_id] ?? 0;
            const q = numeroBR(qtd[it.id]) ?? 0;
            const ruim = q > pend || q > saldo;
            return (
              <tr key={it.id}>
                <td className="py-1.5 pr-2">{prodNome[it.produto_id] ?? "—"}</td>
                <td className="py-1.5 text-right tabular-nums">{qtdBR(pend)}</td>
                <td className={`py-1.5 text-right tabular-nums ${saldo > 0 ? "text-gray-700" : "text-gray-400"}`}>{qtdBR(saldo)}</td>
                <td className="py-1.5 text-right">
                  <input inputMode="decimal" className={`inp w-20 py-1 text-right ${ruim ? "border-red-400 text-red-700" : ""}`}
                    value={qtd[it.id] ?? ""} placeholder="0" onChange={(e) => setQtd((m) => ({ ...m, [it.id]: e.target.value }))} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {erro && <p className="mt-2 text-sm text-red-600">{erro}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={!ok || gravando} onClick={atender}>
          {gravando ? "Registrando…" : `Entregar ${entregar.length} item(ns) e gerar vale`}
        </button>
        <span className="text-xs text-gray-500">O que não for entregue continua pendente para compra.</span>
      </div>
    </div>
  );
}
