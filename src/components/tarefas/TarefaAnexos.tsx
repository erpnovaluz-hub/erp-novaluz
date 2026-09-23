"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import { formatDateTime } from "@/lib/format";
import type { Pessoa } from "@/lib/tarefas";

type Anexo = { id: string; caminho: string; nome: string; tamanho: number | null; tipo_mime: string | null; enviado_por: string | null; criado_em: string };

const LIMITE = 20 * 1024 * 1024;   // igual ao bucket (0042)

function tamanho(b: number | null) {
  if (!b) return "";
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
function icone(mime: string | null) {
  if (!mime) return "📎";
  if (mime.startsWith("image/")) return "🖼️";
  if (mime === "application/pdf") return "📕";
  if (mime.includes("sheet") || mime.includes("excel")) return "📊";
  if (mime.includes("word")) return "📝";
  return "📎";
}

// Arquivos da tarefa (fotos da obra, NF, desenho…). Bucket privado: abre por URL assinada.
export default function TarefaAnexos({ tarefaId, porId }: { tarefaId: string; porId: Record<string, Pessoa> }) {
  const supabase = useMemo(() => createClient(), []);
  const { userId, empresaId, gerencia } = useAcesso();
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("tarefa_anexos").select("*").eq("tarefa_id", tarefaId).order("criado_em");
    setAnexos((data ?? []) as Anexo[]);
  }, [supabase, tarefaId]);

  useEffect(() => { carregar(); }, [carregar]);

  async function enviar(files: FileList | null) {
    if (!files?.length || !empresaId) return;
    setEnviando(true); setErro(null);
    for (const f of Array.from(files)) {
      if (f.size > LIMITE) { setErro(`"${f.name}" passa de 20 MB.`); continue; }
      const limpo = f.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_");
      const caminho = `${empresaId}/${tarefaId}/${crypto.randomUUID()}-${limpo}`;
      const up = await supabase.storage.from("anexos").upload(caminho, f, { contentType: f.type || undefined });
      if (up.error) { setErro(up.error.message); continue; }
      const { error } = await supabase.from("tarefa_anexos").insert({
        tarefa_id: tarefaId, caminho, nome: f.name, tamanho: f.size, tipo_mime: f.type || null, enviado_por: userId,
      });
      if (error) { await supabase.storage.from("anexos").remove([caminho]); setErro(error.message); }
    }
    setEnviando(false);
    if (input.current) input.current.value = "";
    carregar();
  }

  async function abrir(a: Anexo) {
    const { data, error } = await supabase.storage.from("anexos").createSignedUrl(a.caminho, 300);
    if (error || !data) { setErro(error?.message ?? "Não foi possível abrir o arquivo."); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function excluir(a: Anexo) {
    if (!confirm(`Excluir o anexo "${a.nome}"?`)) return;
    const { error } = await supabase.from("tarefa_anexos").delete().eq("id", a.id);
    if (error) { setErro(error.message); return; }
    await supabase.storage.from("anexos").remove([a.caminho]);
    carregar();
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
      onDragLeave={() => setArrastando(false)}
      onDrop={(e) => { e.preventDefault(); setArrastando(false); enviar(e.dataTransfer.files); }}>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm text-gray-500">Anexos {anexos.length > 0 && <span className="text-gray-400">· {anexos.length}</span>}</p>
        <button className="text-sm text-brand-600 hover:underline" onClick={() => input.current?.click()} disabled={enviando}>
          {enviando ? "Enviando…" : "+ Anexar arquivo"}
        </button>
        <input ref={input} type="file" multiple className="hidden" onChange={(e) => enviar(e.target.files)} />
      </div>
      {erro && <p className="mb-1 text-sm text-red-600">{erro}</p>}
      {anexos.length === 0 ? (
        <div className={`rounded-lg border border-dashed px-3 py-3 text-center text-xs ${arrastando ? "border-brand-400 bg-brand-50 text-brand-700" : "text-gray-400"}`}>
          Arraste arquivos aqui (até 20 MB cada)
        </div>
      ) : (
        <ul className={`divide-y rounded-lg border ${arrastando ? "ring-2 ring-brand-300" : ""}`}>
          {anexos.map((a) => (
            <li key={a.id} className="group flex items-center gap-2 px-3 py-2 text-sm">
              <span>{icone(a.tipo_mime)}</span>
              <button className="min-w-0 flex-1 truncate text-left text-brand-700 hover:underline" onClick={() => abrir(a)} title={a.nome}>{a.nome}</button>
              <span className="shrink-0 text-[11px] text-gray-400" title={formatDateTime(a.criado_em)}>
                {tamanho(a.tamanho)}{a.enviado_por && porId[a.enviado_por] ? ` · ${(porId[a.enviado_por].nome || "").split(" ")[0]}` : ""}
              </span>
              {(a.enviado_por === userId || gerencia) && (
                <button className="text-xs text-gray-300 opacity-0 hover:text-red-500 group-hover:opacity-100" onClick={() => excluir(a)}>excluir</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
