"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePode } from "@/components/AcessoProvider";
import DocHeader from "@/components/DocHeader";
import PrintButton from "@/components/PrintButton";
import Badge from "@/components/Badge";
import { formatDate, formatDateTime } from "@/lib/format";
import { ESTADOS_DEVOLUCAO, catLabel } from "@/lib/ferramentas";

type Item = {
  id: string; ferramenta_id: string; estado_saida: string | null; devolvido_em: string | null;
  estado_devolucao: string | null; obs_devolucao: string | null;
  ferramentas: { codigo: string; descricao: string; categoria: string; marca: string | null; modelo: string | null; numero_serie: string | null } | null;
};
const STATUS_CAUTELA = [
  { value: "aberta", label: "Em aberto", color: "blue" },
  { value: "parcial", label: "Devolvida em parte", color: "amber" },
  { value: "devolvida", label: "Devolvida", color: "green" },
];

// Termo de cautela (impresso para assinatura) + devolução item a item.
export default function CautelaDocumento({ id, novo }: { id: string; novo?: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const podeEditar = usePode("estoque", "editar");
  const [c, setC] = useState<any>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [colab, setColab] = useState("");
  const [destino, setDestino] = useState("");
  const [marcados, setMarcados] = useState<Record<string, { estado: string; obs: string }>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(novo ? "Cautela registrada. Imprima o termo para o colaborador assinar." : null);
  const [gravando, setGravando] = useState(false);

  const carregar = useCallback(async () => {
    const [k, it] = await Promise.all([
      supabase.from("cautelas").select("*").eq("id", id).maybeSingle(),
      supabase.from("cautela_itens").select("*, ferramentas(codigo, descricao, categoria, marca, modelo, numero_serie)").eq("cautela_id", id),
    ]);
    setC(k.data);
    setItens(((it.data ?? []) as Item[]).sort((a, b) => (a.ferramentas?.codigo ?? "").localeCompare(b.ferramentas?.codigo ?? "")));
    if (k.data) {
      const e = await supabase.from("vw_equipe").select("nome").eq("id", k.data.colaborador_id).maybeSingle();
      setColab(e.data?.nome ?? "");
      const d = k.data.destino_tipo === "os" ? (await supabase.from("ordens_servico").select("numero, titulo").eq("id", k.data.os_id).maybeSingle()).data
        : k.data.destino_tipo === "obra" ? (await supabase.from("obras_servicos").select("local").eq("id", k.data.obra_id).maybeSingle()).data
        : (await supabase.from("centros_custo").select("nome").eq("id", k.data.centro_custo_id).maybeSingle()).data;
      setDestino(d ? [(d as any).numero, (d as any).titulo, (d as any).local, (d as any).nome].filter(Boolean).join(" · ") : "");
    }
  }, [supabase, id]);
  useEffect(() => { carregar(); }, [carregar]);

  const abertos = itens.filter((i) => !i.devolvido_em);

  async function devolver() {
    const lista = Object.entries(marcados).map(([cautela_item_id, v]) => ({ cautela_item_id, estado: v.estado, observacao: v.obs }));
    if (!lista.length) return;
    if (lista.some((x) => x.estado === "extraviada") && !window.confirm("Há ferramenta marcada como NÃO devolvida (extraviada). Confirmar?")) return;
    setGravando(true); setErro(null);
    const { error } = await supabase.rpc("devolver_ferramentas", { p: { itens: lista } });
    setGravando(false);
    if (error) { setErro(error.message); return; }
    setMarcados({});
    setOk(`${lista.length} devolução(ões) registrada(s).`);
    carregar();
  }

  if (!c) return <div className="p-8 text-center text-sm text-gray-400">Carregando…</div>;
  const destRot = c.destino_tipo === "os" ? "OS" : c.destino_tipo === "obra" ? "Obra" : "Setor";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Link href="/estoque/ferramentas" className="hover:text-gray-700">Ferramentas</Link> <span>/</span>
          <Link href="/estoque/cautela" className="hover:text-gray-700">Cautelas</Link> <span>/</span>
          <span className="text-gray-600">{c.numero}</span>
        </div>
        <PrintButton label="Imprimir termo" />
      </div>

      {ok && <div className="no-print rounded-lg bg-green-50 p-3 text-sm text-green-700">{ok}</div>}

      {/* devolução */}
      {podeEditar && abertos.length > 0 && (
        <div className="no-print rounded-xl border border-blue-200 bg-blue-50/60 p-4">
          <p className="mb-2 text-sm font-semibold text-blue-900">↩️ Registrar devolução</p>
          <ul className="divide-y divide-blue-100 text-sm">
            {abertos.map((i) => {
              const m = marcados[i.id];
              return (
                <li key={i.id} className="flex flex-wrap items-center gap-2 py-2">
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input type="checkbox" className="h-5 w-5" checked={!!m}
                      onChange={(e) => setMarcados((x) => { const n = { ...x }; if (e.target.checked) n[i.id] = { estado: "bom", obs: "" }; else delete n[i.id]; return n; })} />
                    <span className="font-mono text-xs text-gray-500">{i.ferramentas?.codigo}</span>
                    <span className="truncate">{i.ferramentas?.descricao}</span>
                  </label>
                  {m && (
                    <>
                      <select className="inp w-auto py-1" value={m.estado} onChange={(e) => setMarcados((x) => ({ ...x, [i.id]: { ...m, estado: e.target.value } }))}>
                        {ESTADOS_DEVOLUCAO.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                      <input className="inp w-full py-1 sm:w-48" placeholder="observação" value={m.obs}
                        onChange={(e) => setMarcados((x) => ({ ...x, [i.id]: { ...m, obs: e.target.value } }))} />
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          {erro && <p className="mt-2 text-sm text-red-600">{erro}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button className="btn-primary" disabled={gravando || Object.keys(marcados).length === 0} onClick={devolver}>
              {gravando ? "Registrando…" : `Confirmar devolução (${Object.keys(marcados).length})`}
            </button>
            <button className="text-xs text-blue-800 underline" onClick={() => setMarcados(Object.fromEntries(abertos.map((i) => [i.id, { estado: "bom", obs: "" }])))}>marcar todas (bom estado)</button>
          </div>
        </div>
      )}

      {/* termo */}
      <div className="doc rounded-xl bg-white p-6 text-gray-800 shadow-sm sm:p-8 print:p-0 print:shadow-none">
        <DocHeader titulo="TERMO DE CAUTELA DE FERRAMENTAS" numero={c.numero} subtitulo={formatDateTime(c.data_saida)} />
        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Campo r="Colaborador responsável" v={colab} />
          <Campo r={`Destino (${destRot})`} v={destino} />
          <Campo r="Data de retirada" v={formatDate(c.data_saida)} />
          <Campo r="Devolver até" v={c.previsao_devolucao ? formatDate(c.previsao_devolucao) : "—"} />
          <div className="no-print"><Badge value={c.status} options={STATUS_CAUTELA} /></div>
          {c.observacao && <div className="col-span-2"><Campo r="Observação" v={c.observacao} /></div>}
        </div>

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b-2 border-gray-300 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2 pr-2">Código</th><th className="py-2 pr-2">Ferramenta / equipamento</th><th className="py-2 pr-2">Marca · modelo · série</th>
              <th className="py-2 pr-2">Estado</th><th className="py-2">Devolução</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => (
              <tr key={i.id} className="border-b border-gray-100 align-top">
                <td className="py-2 pr-2 font-mono text-xs">{i.ferramentas?.codigo}</td>
                <td className="py-2 pr-2">{i.ferramentas?.descricao}<p className="text-[11px] text-gray-400">{catLabel(i.ferramentas?.categoria)}</p></td>
                <td className="py-2 pr-2 text-xs text-gray-600">{[i.ferramentas?.marca, i.ferramentas?.modelo, i.ferramentas?.numero_serie && `S/N ${i.ferramentas.numero_serie}`].filter(Boolean).join(" · ") || "—"}</td>
                <td className="py-2 pr-2 text-xs">{i.estado_saida ?? "—"}</td>
                <td className="py-2 text-xs">
                  {i.devolvido_em
                    ? <>{formatDate(i.devolvido_em)} · <b>{ESTADOS_DEVOLUCAO.find((e) => e.value === i.estado_devolucao)?.label ?? i.estado_devolucao}</b>{i.obs_devolucao ? ` · ${i.obs_devolucao}` : ""}</>
                    : <span className="text-gray-400">____/____/______</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-6 text-xs leading-relaxed text-gray-600">
          Declaro ter recebido as ferramentas/equipamentos acima, em perfeitas condições de uso, ficando sob minha guarda e
          responsabilidade para uso exclusivo nas atividades da empresa no destino indicado. Comprometo-me a devolvê-los na data
          prevista, no mesmo estado de conservação, e a comunicar imediatamente qualquer dano, perda ou extravio.
        </p>

        <div className="mt-14 grid grid-cols-2 gap-10 text-center text-xs text-gray-600">
          <div className="border-t border-gray-400 pt-1">Entregue por (almoxarifado)</div>
          <div className="border-t border-gray-400 pt-1">{colab || "Colaborador"} — responsável</div>
        </div>
        <div className="mt-12 grid grid-cols-2 gap-10 text-center text-xs text-gray-600">
          <div className="border-t border-gray-400 pt-1">Devolução recebida por (almoxarifado)</div>
          <div className="border-t border-gray-400 pt-1">Data da devolução: ____/____/______</div>
        </div>
      </div>
    </div>
  );
}

function Campo({ r, v }: { r: string; v: any }) {
  return <div><p className="text-xs text-gray-400">{r}</p><p className="font-medium text-gray-800">{v || "—"}</p></div>;
}
