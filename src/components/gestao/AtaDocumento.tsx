"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import DocHeader from "@/components/DocHeader";
import PrintButton from "@/components/PrintButton";
import { useEquipe } from "@/components/tarefas/comum";
import {
  SITUACOES, STATUS_REUNIAO, dataHoraCurta, dataLonga, tipoLabel,
  type Decisao, type Encaminhamento, type ItemPauta, type Participante, type Reuniao, type Revisao,
} from "@/lib/ritmo";

// Ata impressa: só o que gera ação (presentes, pendências revisadas, decisões,
// encaminhamentos, pontos em aberto) + linhas de assinatura dos presentes.
export default function AtaDocumento({ id }: { id: string }) {
  const supabase = useMemo(() => createClient(), []);
  const { porId } = useEquipe();
  const [r, setR] = useState<Reuniao | null>(null);
  const [part, setPart] = useState<Participante[]>([]);
  const [pauta, setPauta] = useState<ItemPauta[]>([]);
  const [dec, setDec] = useState<Decisao[]>([]);
  const [enc, setEnc] = useState<Encaminhamento[]>([]);
  const [rev, setRev] = useState<(Revisao & { enc?: Encaminhamento })[]>([]);
  const [naoAchou, setNaoAchou] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("reunioes").select("*").eq("id", id).maybeSingle();
      if (!data) { setNaoAchou(true); return; }
      const [p, pa, de, en, rv] = await Promise.all([
        supabase.from("reuniao_participantes").select("*").eq("reuniao_id", id),
        supabase.from("reuniao_pauta").select("*").eq("reuniao_id", id).order("ordem"),
        supabase.from("reuniao_decisoes").select("*").eq("reuniao_id", id).order("ordem"),
        supabase.from("reuniao_encaminhamentos").select("*").eq("reuniao_id", id).order("ordem"),
        supabase.from("reuniao_revisoes").select("*").eq("reuniao_id", id),
      ]);
      const revs = (rv.data ?? []) as Revisao[];
      const ids = revs.map((x) => x.encaminhamento_id);
      const encRev = ids.length ? (((await supabase.from("reuniao_encaminhamentos").select("*").in("id", ids)).data ?? []) as Encaminhamento[]) : [];
      setR(data as Reuniao);
      setPart((p.data ?? []) as Participante[]);
      setPauta((pa.data ?? []) as ItemPauta[]);
      setDec((de.data ?? []) as Decisao[]);
      setEnc((en.data ?? []) as Encaminhamento[]);
      setRev(revs.map((x) => ({ ...x, enc: encRev.find((e) => e.id === x.encaminhamento_id) })));
    })();
  }, [supabase, id]);

  if (naoAchou) return <p className="p-8 text-center text-sm text-gray-500">Reunião não encontrada ou confidencial.</p>;
  if (!r) return <p className="p-8 text-center text-sm text-gray-400">Carregando…</p>;

  const nome = (pid?: string | null) => (pid && (porId[pid]?.nome || porId[pid]?.email)) || "—";
  const presentes = part.filter((p) => p.presenca === "presente");
  const ausentes = part.filter((p) => p.presenca === "ausente");
  const emAberto = pauta.filter((p) => p.status === "adiado" || (r.status !== "realizada" && p.status === "aceito"));
  const discutidos = pauta.filter((p) => p.status === "discutido");
  const decNum = (did: string | null) => { const i = dec.findIndex((x) => x.id === did); return i >= 0 ? `D${i + 1}` : ""; };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-3 flex items-center justify-between">
        <Link href={`/gestao/reunioes/${id}`} className="text-sm text-brand-700 hover:underline">← Voltar à reunião</Link>
        <PrintButton />
      </div>

      <div className="doc card bg-white p-6 text-sm text-gray-800 print:p-0">
        <DocHeader titulo="ATA DE REUNIÃO" subtitulo={`${tipoLabel(r.tipo)} · ${dataLonga(r.data_hora)}`} />

        {r.confidencial && (
          <p className="mt-3 rounded border-2 border-purple-600 py-1 text-center text-xs font-bold tracking-widest text-purple-700">CONFIDENCIAL — circulação restrita aos participantes</p>
        )}
        {r.status !== "realizada" && (
          <p className="mt-3 rounded bg-amber-50 py-1 text-center text-xs font-semibold text-amber-700">RASCUNHO — ata ainda não fechada ({STATUS_REUNIAO[r.status].label})</p>
        )}

        <table className="mt-4 w-full text-sm">
          <tbody>
            <tr><td className="w-32 py-0.5 text-gray-500">Reunião</td><td className="font-semibold">{r.titulo}</td></tr>
            <tr><td className="py-0.5 text-gray-500">Data / local</td><td>{dataHoraCurta(r.data_hora)}{r.local ? ` · ${r.local}` : ""} · {r.duracao_min} min</td></tr>
            <tr><td className="py-0.5 text-gray-500">Conduzida por</td><td>{nome(r.conduzida_por)}</td></tr>
            <tr><td className="py-0.5 text-gray-500">Presentes</td><td>{presentes.map((p) => nome(p.perfil_id)).join(", ") || "—"}</td></tr>
            {ausentes.length > 0 && <tr><td className="py-0.5 text-gray-500">Ausentes</td><td>{ausentes.map((p) => nome(p.perfil_id)).join(", ")}</td></tr>}
          </tbody>
        </table>

        {rev.length > 0 && (
          <Bloco titulo="Pendências da reunião anterior">
            <ul className="space-y-1">
              {rev.map((x) => (
                <li key={x.encaminhamento_id}>
                  <b>{x.situacao === "feito" ? "✔" : x.situacao === "nao_feito" ? "✘" : x.situacao === "replanejado" ? "↻" : "⊘"}</b>{" "}
                  {x.enc?.o_que} — {nome(x.enc?.dono_id)} — <i>{SITUACOES.find((s) => s.key === x.situacao)?.label}</i>
                  {x.novo_prazo && <> · novo prazo {dataLonga(x.novo_prazo + "T12:00:00")}</>}
                  {x.motivo && <> · motivo: {x.motivo}</>}
                </li>
              ))}
            </ul>
          </Bloco>
        )}

        {discutidos.length > 0 && (
          <Bloco titulo="Assuntos tratados">
            <ol className="list-decimal space-y-0.5 pl-5">{discutidos.map((p) => <li key={p.id}>{p.titulo}</li>)}</ol>
          </Bloco>
        )}

        <Bloco titulo="Decisões">
          {dec.length === 0 ? <p className="text-gray-400">Nenhuma decisão registrada.</p> : (
            <ul className="space-y-1">{dec.map((x, i) => <li key={x.id}><b>D{i + 1}.</b> {x.texto}</li>)}</ul>
          )}
        </Bloco>

        <Bloco titulo="Encaminhamentos">
          {enc.length === 0 ? <p className="text-gray-400">Nenhum encaminhamento.</p> : (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b-2 border-gray-300 text-left">
                  <th className="py-1 pr-2">#</th><th className="py-1 pr-2">O quê</th><th className="py-1 pr-2">Dono</th>
                  <th className="py-1 pr-2">Prazo</th><th className="py-1">Evidência</th>
                </tr>
              </thead>
              <tbody>
                {enc.map((e, i) => (
                  <tr key={e.id} className="border-b align-top">
                    <td className="py-1 pr-2 font-semibold">E{i + 1}{e.decisao_id ? <span className="block text-[10px] font-normal text-gray-400">{decNum(e.decisao_id)}</span> : null}</td>
                    <td className="py-1 pr-2">
                      {e.o_que}{e.cancelado && <i className="text-gray-400"> (cancelado)</i>}
                      {e.partes?.map((p, j) => (
                        <span key={j} className="block text-gray-500">├─ {p.o_que} → {nome(p.responsavel_id ?? e.dono_id)}{p.prazo ? ` · ${dataLonga(p.prazo + "T12:00:00")}` : ""}</span>
                      ))}
                    </td>
                    <td className="py-1 pr-2">{nome(e.dono_id)}</td>
                    <td className="py-1 pr-2 whitespace-nowrap">{dataLonga(e.prazo + "T12:00:00")}</td>
                    <td className="py-1">{e.evidencia}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Bloco>

        {emAberto.length > 0 && (
          <Bloco titulo="Pontos em aberto (voltam na próxima reunião)">
            <ul className="list-disc space-y-0.5 pl-5">{emAberto.map((p) => <li key={p.id}>{p.titulo}</li>)}</ul>
          </Bloco>
        )}

        {r.observacoes && <Bloco titulo="Observações"><p>{r.observacoes}</p></Bloco>}

        <div className="mt-10 grid grid-cols-2 gap-x-10 gap-y-10 break-inside-avoid">
          {presentes.map((p) => (
            <div key={p.perfil_id} className="border-t border-gray-500 pt-1 text-center text-xs">{nome(p.perfil_id)}</div>
          ))}
        </div>
        {r.ata_fechada_em && <p className="mt-6 text-[10px] text-gray-400">Ata fechada no sistema em {new Date(r.ata_fechada_em).toLocaleString("pt-BR")}.</p>}
      </div>
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mt-5 break-inside-avoid">
      <h2 className="mb-1 border-b border-gray-300 pb-0.5 text-xs font-bold uppercase tracking-wide text-gray-600">{titulo}</h2>
      {children}
    </div>
  );
}
