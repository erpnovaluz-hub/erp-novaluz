"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso, usePode } from "@/components/AcessoProvider";
import Badge from "@/components/Badge";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { ESTADOS, EVENTO_ICON, STATUS_FERR, catLabel, urlEtiqueta, type Ferramenta } from "@/lib/ferramentas";
import FerramentaForm from "@/components/ferramentas/FerramentaForm";
import QrCode from "@/components/ferramentas/QrCode";

type Evento = { id: string; tipo: string; data: string; descricao: string | null; custo: number | null; colaborador_id: string | null; cautela_id: string | null };

export default function FerramentaDetalhe({ id }: { id: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { gerencia, empresaId } = useAcesso();
  const podeEditar = usePode("estoque", "editar");
  const [f, setF] = useState<Ferramenta | null>(null);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [equipe, setEquipe] = useState<Record<string, string>>({});
  const [foto, setFoto] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const inputFoto = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    const [a, b, e] = await Promise.all([
      supabase.from("vw_ferramentas_local").select("*").eq("id", id).maybeSingle(),
      supabase.from("ferramenta_eventos").select("*").eq("ferramenta_id", id).order("data", { ascending: false }).limit(200),
      supabase.from("vw_equipe").select("id, nome").range(0, 4999),
    ]);
    setF(a.data as Ferramenta | null);
    setEventos((b.data ?? []) as Evento[]);
    setEquipe(Object.fromEntries(((e.data ?? []) as any[]).map((x) => [x.id, x.nome])));
    if (a.data?.foto_caminho) {
      const { data } = await supabase.storage.from("anexos").createSignedUrl(a.data.foto_caminho, 3600);
      setFoto(data?.signedUrl ?? null);
    } else setFoto(null);
    setCarregando(false);
  }, [supabase, id]);
  useEffect(() => { carregar(); }, [carregar]);

  async function acao(acao: string, pergunta?: string, obrigatorio = false, comCusto = false) {
    let descricao: string | null = null;
    if (pergunta) {
      descricao = window.prompt(pergunta);
      if (descricao === null || (obrigatorio && !descricao.trim())) return;
    }
    let custo: number | null = null;
    if (comCusto && gerencia) {
      const c = window.prompt("Custo da manutenção em R$ (opcional):");
      custo = c && c.trim() ? Number(c.replace(/\./g, "").replace(",", ".")) || null : null;
    }
    const { error } = await supabase.rpc("movimentar_ferramenta", { p_ferramenta: id, p_acao: acao, p_descricao: descricao, p_custo: custo, p_proxima: null });
    if (error) { setMsg({ ok: false, t: error.message }); return; }
    setMsg({ ok: true, t: "Registrado." });
    carregar();
  }

  async function enviarFoto(arq: File | undefined) {
    if (!arq || !empresaId) return;
    const caminho = `${empresaId}/ferramentas/${id}/${crypto.randomUUID()}.${(arq.name.split(".").pop() || "jpg").toLowerCase()}`;
    const up = await supabase.storage.from("anexos").upload(caminho, arq, { contentType: arq.type || undefined });
    if (up.error) { setMsg({ ok: false, t: up.error.message }); return; }
    const antiga = f?.foto_caminho;
    const { error } = await supabase.from("ferramentas").update({ foto_caminho: caminho }).eq("id", id);
    if (error) { setMsg({ ok: false, t: error.message }); return; }
    if (antiga) await supabase.storage.from("anexos").remove([antiga]);
    carregar();
  }

  if (carregando) return <div className="p-8 text-center text-sm text-gray-400">Carregando…</div>;
  if (!f) return <div className="card mx-auto mt-10 max-w-md p-6 text-center text-sm text-gray-500">Ferramenta não encontrada. <Link href="/estoque/ferramentas" className="text-brand-600">voltar</Link></div>;

  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link href="/estoque/ferramentas" className="hover:text-gray-700">Ferramentas</Link> <span>/</span> <span className="text-gray-600">{f.codigo}</span>
      </div>

      {msg && <div className={`rounded-lg p-3 text-sm ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg.t}</div>}

      <div className="card p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row">
          <button type="button" onClick={() => podeEditar && inputFoto.current?.click()}
            className="flex h-40 w-full shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-100 text-sm text-gray-400 sm:h-36 sm:w-36"
            title={podeEditar ? "Trocar foto" : undefined}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {foto ? <img src={foto} alt={f.descricao} className="h-full w-full object-cover" /> : podeEditar ? "📷 Adicionar foto" : "sem foto"}
          </button>
          <input ref={inputFoto} type="file" accept="image/*" className="hidden" onChange={(e) => enviarFoto(e.target.files?.[0])} />

          <div className="min-w-0 flex-1">
            <p className="font-mono text-sm text-gray-500">{f.codigo}</p>
            <h1 className="text-xl font-semibold text-gray-900">{f.descricao}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge value={f.status} options={STATUS_FERR} />
              <span className="text-xs text-gray-500">{catLabel(f.categoria)} · estado {ESTADOS.find((e) => e.value === f.estado)?.label.toLowerCase()}</span>
            </div>
            {f.status === "em_uso" && (
              <div className={`mt-3 rounded-lg p-3 text-sm ${f.atrasada ? "bg-red-50 text-red-800" : "bg-blue-50 text-blue-900"}`}>
                👷 Com <b>{f.com_colaborador_nome ?? "—"}</b>{f.destino_nome && <> em <b>{f.destino_nome}</b></>} desde {formatDate(f.data_saida)}
                {f.previsao_devolucao && <> · devolver até <b>{formatDate(f.previsao_devolucao)}</b>{f.atrasada && " ⚠ atrasada"}</>}
                {f.cautela_id && <> · <Link href={`/estoque/cautela/${f.cautela_id}`} className="underline">{f.cautela_numero}</Link></>}
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-center gap-1">
            <QrCode texto={urlEtiqueta(f.codigo)} tamanho={96} />
            <Link href={`/estoque/ferramentas/etiquetas?ids=${f.id}`} className="text-xs text-brand-600 hover:underline">🏷️ etiqueta</Link>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-4 text-sm sm:grid-cols-4">
          <Campo r="Marca / modelo" v={[f.marca, f.modelo].filter(Boolean).join(" ")} />
          <Campo r="Nº de série" v={f.numero_serie} />
          <Campo r="Guardada em" v={f.deposito_nome} />
          <Campo r="Aquisição" v={f.data_aquisicao ? formatDate(f.data_aquisicao) : null} />
          {gerencia && <Campo r="Valor" v={f.valor_aquisicao != null ? formatCurrency(f.valor_aquisicao) : null} />}
          <Campo r="Próx. manutenção" v={f.proxima_manutencao ? formatDate(f.proxima_manutencao) : null}
            cor={f.proxima_manutencao && f.proxima_manutencao < hoje ? "text-red-600" : undefined} />
          <Campo r="Periodicidade" v={f.periodicidade_dias ? `a cada ${f.periodicidade_dias} dias` : null} />
        </dl>
        {f.observacao && <p className="mt-3 text-sm text-gray-600">{f.observacao}</p>}

        {podeEditar && (
          <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
            {f.status === "disponivel" && <Link href={`/estoque/cautela/nova?f=${f.id}`} className="btn-primary text-sm">📤 Cautelar</Link>}
            {f.status === "em_uso" && f.cautela_id && <Link href={`/estoque/cautela/${f.cautela_id}`} className="btn-primary text-sm">↩️ Registrar devolução</Link>}
            {f.status === "disponivel" && <button className="btn-ghost text-sm ring-1 ring-gray-200" onClick={() => acao("enviar_manutencao", "O que precisa de manutenção / onde vai ser feita?")}>🛠️ Enviar p/ manutenção</button>}
            {f.status === "manutencao" && <button className="btn-ghost text-sm ring-1 ring-gray-200" onClick={() => acao("retornar_manutencao", "O que foi feito? (opcional)", false, true)}>✅ Voltou da manutenção</button>}
            {(f.status === "extraviada" || f.status === "baixada") && <button className="btn-ghost text-sm ring-1 ring-gray-200" onClick={() => acao("reativar", "Observação (ex.: foi encontrada)")}>♻️ Reativar</button>}
            <button className="btn-ghost text-sm ring-1 ring-gray-200" onClick={() => setEditando(true)}>✏️ Editar</button>
            {f.status !== "baixada" && f.status !== "extraviada" && (
              <>
                <button className="btn-ghost text-sm text-red-500" onClick={() => acao("extraviar", "Descreva o extravio (onde/quando sumiu):", true)}>Extravio</button>
                {f.status !== "em_uso" && <button className="btn-ghost text-sm text-red-500" onClick={() => acao("baixar", "Motivo da baixa (quebrou sem conserto, vendida…):", true)}>Dar baixa</button>}
              </>
            )}
          </div>
        )}
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Histórico</h2>
        <ol className="card divide-y divide-gray-100">
          {eventos.map((e) => (
            <li key={e.id} className="flex gap-3 px-4 py-2.5 text-sm">
              <span className="text-lg leading-none">{EVENTO_ICON[e.tipo] ?? "•"}</span>
              <div className="min-w-0 flex-1">
                <p className="text-gray-800">{e.descricao}{e.colaborador_id && equipe[e.colaborador_id] ? ` · ${equipe[e.colaborador_id]}` : ""}</p>
                <p className="text-xs text-gray-400">{formatDateTime(e.data)}{gerencia && e.custo ? ` · ${formatCurrency(e.custo)}` : ""}</p>
              </div>
              {e.cautela_id && <Link href={`/estoque/cautela/${e.cautela_id}`} className="shrink-0 text-xs text-brand-600 hover:underline">cautela</Link>}
            </li>
          ))}
        </ol>
      </section>

      {editando && <FerramentaForm registro={f} onFechar={() => setEditando(false)} onSalvo={() => { setEditando(false); carregar(); router.refresh(); }} />}
    </div>
  );
}

function Campo({ r, v, cor }: { r: string; v: string | null | undefined; cor?: string }) {
  return <div><dt className="text-xs text-gray-400">{r}</dt><dd className={`font-medium ${cor ?? "text-gray-800"}`}>{v || "—"}</dd></div>;
}
