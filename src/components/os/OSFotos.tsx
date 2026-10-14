"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso, usePode } from "@/components/AcessoProvider";
import { comprimirImagem } from "@/lib/imagem";
import { formatDateTime } from "@/lib/format";

type Foto = { id: string; etapa: "antes" | "durante" | "depois"; caminho: string; legenda: string | null; no_relatorio: boolean; criado_em: string };
const ETAPAS = [
  { key: "antes", label: "Antes" },
  { key: "durante", label: "Durante" },
  { key: "depois", label: "Depois" },
] as const;

// Fotos da OS por etapa. No celular o botão abre a câmera; a foto é reduzida antes de subir.
export default function OSFotos({ osId }: { osId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const { empresaId } = useAcesso();
  const podeEditar = usePode("os", "editar");
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [etapa, setEtapa] = useState<Foto["etapa"]>("antes");
  const [enviando, setEnviando] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("os_fotos").select("*").eq("os_id", osId).order("criado_em");
    const lista = (data ?? []) as Foto[];
    setFotos(lista);
    if (lista.length) {
      const { data: assinadas } = await supabase.storage.from("anexos").createSignedUrls(lista.map((f) => f.caminho), 3600);
      setUrls(Object.fromEntries((assinadas ?? []).map((s: any) => [s.path, s.signedUrl])));
    }
  }, [supabase, osId]);
  useEffect(() => { carregar(); }, [carregar]);

  async function enviar(arquivos: FileList | null) {
    if (!arquivos?.length || !empresaId) return;
    setErro(null);
    const lista = Array.from(arquivos);
    setEnviando(lista.length);
    for (const arq of lista) {
      const blob = await comprimirImagem(arq);
      const ext = blob.type === "image/jpeg" ? "jpg" : (arq.name.split(".").pop() || "jpg").toLowerCase();
      const caminho = `${empresaId}/os/${osId}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("anexos").upload(caminho, blob, { contentType: blob.type || arq.type || undefined });
      if (up.error) { setErro(up.error.message); continue; }
      const { error } = await supabase.from("os_fotos").insert({ os_id: osId, etapa, caminho });
      if (error) { await supabase.storage.from("anexos").remove([caminho]); setErro(error.message); }
      setEnviando((n) => n - 1);
    }
    setEnviando(0);
    if (input.current) input.current.value = "";
    carregar();
  }

  async function atualizar(f: Foto, campos: Partial<Foto>) {
    setFotos((l) => l.map((x) => (x.id === f.id ? { ...x, ...campos } : x)));
    const { error } = await supabase.from("os_fotos").update(campos).eq("id", f.id);
    if (error) { setErro(error.message); carregar(); }
  }

  async function excluir(f: Foto) {
    if (!confirm("Excluir esta foto?")) return;
    const { error } = await supabase.from("os_fotos").delete().eq("id", f.id);
    if (error) { setErro(error.message); return; }
    await supabase.storage.from("anexos").remove([f.caminho]);
    carregar();
  }

  const daEtapa = fotos.filter((f) => f.etapa === etapa);

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">📷 Fotos · {fotos.length}</h2>
        <div className="flex gap-1">
          {ETAPAS.map((e) => (
            <button key={e.key} onClick={() => setEtapa(e.key)}
              className={`rounded-full px-3 py-1 text-xs ${etapa === e.key ? "bg-brand-600 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200"}`}>
              {e.label} ({fotos.filter((f) => f.etapa === e.key).length})
            </button>
          ))}
        </div>
      </div>
      {erro && <p className="mb-2 text-sm text-red-600">{erro}</p>}
      <div className="card p-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {daEtapa.map((f) => (
            <figure key={f.id} className="group overflow-hidden rounded-lg border bg-gray-50">
              <a href={urls[f.caminho]} target="_blank" rel="noopener noreferrer" className="block aspect-[4/3] bg-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {urls[f.caminho] && <img src={urls[f.caminho]} alt={f.legenda ?? "foto da OS"} className="h-full w-full object-cover" loading="lazy" />}
              </a>
              <figcaption className="space-y-1 p-2">
                {podeEditar ? (
                  <input className="w-full border-0 bg-transparent p-0 text-xs focus:ring-0" placeholder="legenda…" defaultValue={f.legenda ?? ""}
                    onBlur={(e) => e.target.value !== (f.legenda ?? "") && atualizar(f, { legenda: e.target.value || null })} />
                ) : <p className="text-xs text-gray-700">{f.legenda}</p>}
                <div className="flex items-center gap-2 text-[10px] text-gray-400">
                  <span className="flex-1">{formatDateTime(f.criado_em)}</span>
                  {podeEditar && (
                    <>
                      <label className="flex items-center gap-1" title="Sai no relatório de execução">
                        <input type="checkbox" checked={f.no_relatorio} onChange={(e) => atualizar(f, { no_relatorio: e.target.checked })} /> relatório
                      </label>
                      <button className="text-gray-300 hover:text-red-500" onClick={() => excluir(f)}>excluir</button>
                    </>
                  )}
                </div>
              </figcaption>
            </figure>
          ))}
          {podeEditar && (
            <button onClick={() => input.current?.click()} disabled={enviando > 0}
              className="flex aspect-[4/3] flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-brand-400 hover:text-brand-700">
              <span className="text-2xl">📷</span>
              {enviando > 0 ? `Enviando ${enviando}…` : `Foto de "${ETAPAS.find((e) => e.key === etapa)?.label}"`}
            </button>
          )}
        </div>
        {!podeEditar && daEtapa.length === 0 && <p className="py-4 text-center text-sm text-gray-400">Sem fotos nesta etapa.</p>}
        <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => enviar(e.target.files)} />
      </div>
    </section>
  );
}
