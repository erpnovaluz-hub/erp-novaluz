"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useEmissora } from "@/lib/useEmissora";
import DocHeader from "@/components/DocHeader";
import PrintButton from "@/components/PrintButton";
import { formatDate } from "@/lib/format";

const ETAPAS: [string, string][] = [["antes", "Antes"], ["durante", "Durante a execução"], ["depois", "Depois / entrega"]];

// Relatório de execução para o cliente (impresso): SEM valores. Termina com termo de aceite.
export default function RelatorioExecucao({ id }: { id: string }) {
  const supabase = useMemo(() => createClient(), []);
  const EMISSORA = useEmissora();
  const [d, setD] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const { data: os } = await supabase.from("ordens_servico").select("*").eq("id", id).maybeSingle();
      if (!os) { setD({ vazio: true }); return; }
      const [cli, resp, ativ, ins, chk, fot, hist, apont, equipe, prods] = await Promise.all([
        os.cliente_id ? supabase.from("clientes").select("nome, cnpj").eq("id", os.cliente_id).maybeSingle() : Promise.resolve({ data: null }),
        os.responsavel_id ? supabase.from("perfis").select("nome").eq("id", os.responsavel_id).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from("atividades_os").select("descricao, conclusao_pct, colaborador_id").eq("os_id", id).order("data_inicio", { ascending: true, nullsFirst: false }),
        supabase.from("insumos_os").select("descricao, quantidade, produto_id").eq("os_id", id).order("descricao"),
        supabase.from("os_checklist").select("item, feito").eq("os_id", id).order("ordem"),
        supabase.from("os_fotos").select("etapa, caminho, legenda").eq("os_id", id).eq("no_relatorio", true).order("criado_em"),
        supabase.from("os_historico").select("para, data").eq("os_id", id).order("data"),
        supabase.from("os_apontamentos").select("colaborador_id").eq("os_id", id).range(0, 4999),
        supabase.from("vw_equipe").select("id, nome").range(0, 4999),
        supabase.from("produtos").select("id, unidade").range(0, 19999),
      ]);
      const fotos = (fot.data ?? []) as any[];
      let urls: Record<string, string> = {};
      if (fotos.length) {
        const { data } = await supabase.storage.from("anexos").createSignedUrls(fotos.map((f) => f.caminho), 3600);
        urls = Object.fromEntries((data ?? []).map((s: any) => [s.path, s.signedUrl]));
      }
      const nomeEq = Object.fromEntries(((equipe.data ?? []) as any[]).map((e) => [e.id, e.nome]));
      const idsEquipe = new Set<string>([
        ...((apont.data ?? []) as any[]).map((a) => a.colaborador_id),
        ...((ativ.data ?? []) as any[]).map((a) => a.colaborador_id).filter(Boolean),
      ]);
      const h = (hist.data ?? []) as any[];
      const inicio = h.find((x) => x.para === "em_andamento")?.data ?? null;
      // material líquido por produto: saídas menos devoluções (linhas negativas)
      const unidade = Object.fromEntries(((prods.data ?? []) as any[]).map((p) => [p.id, p.unidade]));
      const agg = new Map<string, { nome: string; qtd: number; un: string }>();
      for (const i of (ins.data ?? []) as any[]) {
        const nome = String(i.descricao).replace(/ · (devolução )?V[SD]-\d{4}-\d+$/, "");
        const k = i.produto_id ?? nome;
        const x = agg.get(k) ?? { nome, qtd: 0, un: unidade[i.produto_id] ?? "" };
        x.qtd += Number(i.quantidade || 0);
        agg.set(k, x);
      }
      const materiais = Array.from(agg.values()).filter((m) => m.qtd > 0).sort((a, b) => a.nome.localeCompare(b.nome));
      setD({ materiais,
        os, cliente: cli.data, resp: (resp.data as any)?.nome ?? os.responsavel, atividades: ativ.data ?? [],
        insumos: ins.data ?? [], unidade: Object.fromEntries(((prods.data ?? []) as any[]).map((p) => [p.id, p.unidade])),
        checklist: chk.data ?? [], fotos, urls, inicio, equipe: Array.from(idsEquipe).map((i) => nomeEq[i]).filter(Boolean).sort(),
      });
    })();
  }, [supabase, id]);

  if (!d) return <p className="text-gray-400">Carregando…</p>;
  if (d.vazio) return <p className="text-gray-400">OS não encontrada. <Link href="/os" className="text-brand-600">voltar</Link></p>;
  const { os } = d;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/os/${id}`} className="text-sm text-gray-500 hover:text-gray-800">← voltar à OS</Link>
        <PrintButton label="Imprimir relatório" />
      </div>
      <p className="no-print mb-3 text-xs text-gray-500">Só saem as fotos marcadas com “relatório” na OS. Espere as fotos carregarem antes de imprimir.</p>

      <div className="doc rounded-xl bg-white p-6 text-gray-800 shadow-sm sm:p-8 print:p-0 print:shadow-none">
        <DocHeader titulo="RELATÓRIO DE EXECUÇÃO DE SERVIÇO" numero={os.numero ?? undefined} subtitulo={os.titulo} />

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="mb-1 text-[11px] font-semibold uppercase text-gray-400">Cliente</p>
            <p className="font-medium">{d.cliente?.nome ?? "—"}</p>
            {d.cliente?.cnpj && <p className="text-xs text-gray-500">CNPJ {d.cliente.cnpj}</p>}
            {os.local && <p className="text-xs text-gray-500">Local: {os.local}</p>}
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3">
            <Campo r="Responsável" v={d.resp} />
            <Campo r="Início" v={d.inicio ? formatDate(d.inicio) : "—"} />
            <Campo r="Conclusão" v={os.data_realizado ? formatDate(os.data_realizado) : "em andamento"} />
            <Campo r="Prazo" v={formatDate(os.prazo)} />
          </div>
        </div>

        {(os.motivo || os.como_sera_feito) && (
          <Bloco t="Serviço">
            {os.motivo && <p><b>Objetivo:</b> {os.motivo}</p>}
            {os.como_sera_feito && <p className="mt-1"><b>Execução:</b> {os.como_sera_feito}</p>}
          </Bloco>
        )}

        {d.atividades.length > 0 && (
          <Bloco t="Atividades realizadas">
            <ul className="space-y-0.5">
              {d.atividades.map((a: any, k: number) => (
                <li key={k} className="flex gap-2"><span>{Number(a.conclusao_pct) >= 100 ? "✔" : "◻"}</span><span className="flex-1">{a.descricao}</span><span className="text-gray-500">{Number(a.conclusao_pct || 0)}%</span></li>
              ))}
            </ul>
          </Bloco>
        )}

        {d.equipe.length > 0 && <Bloco t="Equipe">{d.equipe.join(" · ")}</Bloco>}

        {d.materiais.length > 0 && (
          <Bloco t="Materiais aplicados">
            <table className="w-full text-sm">
              <tbody>
                {d.materiais.map((m: any, k: number) => (
                  <tr key={k} className="border-b border-gray-100">
                    <td className="py-1 pr-2">{m.nome}</td>
                    <td className="py-1 text-right tabular-nums">{m.qtd.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} {m.un}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Bloco>
        )}

        {d.checklist.length > 0 && (
          <Bloco t="Checklist de execução">
            <ul className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
              {d.checklist.map((c: any, k: number) => <li key={k}>{c.feito ? "☑" : "☐"} {c.item}</li>)}
            </ul>
          </Bloco>
        )}

        {ETAPAS.map(([etapa, rot]) => {
          const fs = d.fotos.filter((f: any) => f.etapa === etapa);
          if (!fs.length) return null;
          return (
            <Bloco key={etapa} t={`Registro fotográfico — ${rot}`}>
              <div className="grid grid-cols-2 gap-3">
                {fs.map((f: any, k: number) => (
                  <figure key={k} className="break-inside-avoid">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={d.urls[f.caminho]} alt={f.legenda ?? rot} className="aspect-[4/3] w-full rounded border object-cover" />
                    {f.legenda && <figcaption className="mt-0.5 text-xs text-gray-600">{f.legenda}</figcaption>}
                  </figure>
                ))}
              </div>
            </Bloco>
          );
        })}

        <div className="mt-8 break-inside-avoid rounded-lg border border-gray-300 p-4 text-sm">
          <p className="font-semibold">TERMO DE ACEITE</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-700">
            Declaro que os serviços descritos neste relatório, referentes à {os.numero ? `OS ${os.numero}` : "ordem de serviço"},
            foram executados e entregues, e que recebi o local/equipamento nas condições registradas acima.
            Eventuais pendências estão anotadas abaixo.
          </p>
          <p className="mt-3 text-xs text-gray-500">Pendências / observações do cliente:</p>
          <div className="mt-1 h-14 border-b border-dashed border-gray-300" />
          <div className="mt-12 grid grid-cols-2 gap-10 text-center text-xs text-gray-600">
            <div className="border-t border-gray-400 pt-1">Cliente — nome, cargo e assinatura<br />Data: ____/____/______</div>
            <div className="border-t border-gray-400 pt-1">{d.resp ?? "Responsável técnico"} — {EMISSORA.nome}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Campo({ r, v }: { r: string; v: any }) {
  return <div><p className="text-[11px] uppercase text-gray-400">{r}</p><p className="font-medium text-gray-800">{v || "—"}</p></div>;
}
function Bloco({ t, children }: { t: string; children: React.ReactNode }) {
  return (
    <div className="mt-5 break-inside-avoid text-sm">
      <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-brand-700">{t}</h3>
      {children}
    </div>
  );
}
