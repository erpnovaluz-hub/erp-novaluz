"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Acao = {
  id?: string;
  ferramenta: string;
  faixa: string; // leitura | verde | amarela
  status?: string; // pendente | executada | rejeitada | desfeita
  resumo: string;
  parametros?: Record<string, any>;
  valor?: number | null;
  link?: string | null;
  reversivel: boolean;
};
type Msg = { papel: "user" | "assistant"; texto: string; acoes?: Acao[] };

// campos que o usuário pode ajustar no cartão (os demais: cancelar e repedir)
const EDITAVEIS = ["titulo", "data_hora", "valor", "causa", "prazo", "motivo", "local", "motivo_pausa", "pausa_obs", "horas", "quantidade", "custo_estimado", "custo_unitario", "descricao", "observacao"];
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
// Chat de gestão (Ritmo de Gestão · Bloco 3): mesmo componente, outra persona
// no servidor (modo "gestao"), conversa guardada em chave própria.
export default function ChatAssistente({ nome, modo = "geral", atalhos = [], inicial = "", vazio }: {
  nome: string; modo?: "geral" | "gestao"; atalhos?: string[]; inicial?: string; vazio?: string;
}) {
  const CHAVE = modo === "gestao" ? "gestao:conversa" : "assistente:conversa"; // id da conversa aberta, por navegador
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState(inicial);
  const [carregando, setCarregando] = useState(false);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null); // acao.id em edição
  const [form, setForm] = useState<Record<string, any>>({});
  const [suportaVoz, setSuportaVoz] = useState(false); // Web Speech disponível neste navegador
  const [ouvindo, setOuvindo] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const recRef = useRef<any>(null); // instância do SpeechRecognition

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, carregando]);

  // Ditado por voz: só habilita se o navegador suporta (define em efeito para não
  // divergir entre SSR e cliente). iPhone/Safari pode não ter — aí o botão some e
  // o campo de texto continua normal. A transcrição é do navegador: não passa
  // pelo nosso servidor nem pelo banco.
  useEffect(() => {
    setSuportaVoz(!!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition));
    return () => { try { recRef.current?.stop(); } catch {} };
  }, []);

  function pararMic() {
    try { recRef.current?.stop(); } catch {}
  }

  function alternarMic() {
    if (ouvindo) return pararMic();
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.continuous = true;
    rec.interimResults = true;
    const base = input.trim() ? input.trim() + " " : "";
    rec.onresult = (e: any) => {
      let txt = "";
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
      setInput(base + txt);
    };
    rec.onerror = () => setOuvindo(false);
    rec.onend = () => setOuvindo(false);
    recRef.current = rec;
    setOuvindo(true);
    try { rec.start(); } catch { setOuvindo(false); }
  }

  // Persistência da conversa: ao abrir, recarrega a última (texto + cartões
  // pendentes). O conteúdo real sempre esteve no banco; aqui a tela reabre.
  useEffect(() => {
    let id: string | null = null;
    try { id = localStorage.getItem(CHAVE); } catch {}
    if (!id) return;
    (async () => {
      try {
        const r = await fetch(`/api/agente/chat?conversa_id=${encodeURIComponent(id!)}`);
        if (!r.ok) { try { localStorage.removeItem(CHAVE); } catch {} return; }
        const data = await r.json();
        if ((data.modo ?? "geral") !== modo) { try { localStorage.removeItem(CHAVE); } catch {} return; }
        const carregadas: Msg[] = (data.mensagens ?? []).map((m: any) => ({ papel: m.papel, texto: m.texto }));
        const pend: Acao[] = data.pendentes ?? [];
        if (pend.length) {
          const ultimo = [...carregadas].reverse().find((m) => m.papel === "assistant");
          if (ultimo) ultimo.acoes = [...(ultimo.acoes ?? []), ...pend];
          else carregadas.push({ papel: "assistant", texto: "", acoes: pend });
        }
        setMsgs(carregadas);
        setConversaId(data.conversa_id ?? id);
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // guarda o id da conversa para reabrir depois
  useEffect(() => {
    try {
      if (conversaId) localStorage.setItem(CHAVE, conversaId);
    } catch {}
  }, [conversaId, CHAVE]);

  function novaConversa() {
    setMsgs([]);
    setConversaId(null);
    setEditando(null);
    try { localStorage.removeItem(CHAVE); } catch {}
  }

  // atualiza uma ação específica (por id) em qualquer mensagem
  function patchAcao(id: string, patch: Partial<Acao>) {
    setMsgs((m) => m.map((msg) => ({ ...msg, acoes: msg.acoes?.map((a) => (a.id === id ? { ...a, ...patch } : a)) })));
  }

  async function enviar(e: React.FormEvent, textoDireto?: string) {
    e.preventDefault();
    const texto = (textoDireto ?? input).trim();
    if (!texto || carregando) return;
    pararMic();
    setInput("");
    setMsgs((m) => [...m, { papel: "user", texto }]);
    setCarregando(true);
    try {
      const r = await fetch("/api/agente/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensagem: texto, conversa_id: conversaId, modo }),
      });
      const data = await r.json();
      if (!r.ok) setMsgs((m) => [...m, { papel: "assistant", texto: "⚠️ " + (data?.error ?? "Falha ao responder.") }]);
      else {
        setConversaId(data.conversa_id ?? conversaId);
        setMsgs((m) => [...m, { papel: "assistant", texto: data.resposta || "(sem resposta)", acoes: data.acoes ?? [] }]);
      }
    } catch (err: any) {
      setMsgs((m) => [...m, { papel: "assistant", texto: "⚠️ Erro de rede: " + (err?.message ?? String(err)) }]);
    } finally {
      setCarregando(false);
    }
  }

  async function decidir(a: Acao, decisao: "confirmar" | "cancelar" | "editar", parametros?: Record<string, any>) {
    if (!a.id) return;
    const r = await fetch("/api/agente/decidir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao_id: a.id, decisao, parametros }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return alert(data?.error ?? "Falha ao decidir.");
    if (decisao === "confirmar") patchAcao(a.id, { status: "executada", link: data.acao?.link ?? null, reversivel: data.acao?.reversivel ?? false });
    else if (decisao === "cancelar") patchAcao(a.id, { status: "rejeitada" });
    else {
      patchAcao(a.id, { parametros: data.parametros, resumo: data.resumo });
      setEditando(null);
    }
  }

  async function desfazer(a: Acao) {
    if (!a.id) return;
    const r = await fetch("/api/agente/desfazer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao_id: a.id }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) patchAcao(a.id, { status: "desfeita" });
    else alert(data?.error ?? "Não foi possível desfazer.");
  }

  function abrirEdicao(a: Acao) {
    setEditando(a.id ?? null);
    const inicial: Record<string, any> = {};
    for (const k of EDITAVEIS) if (a.parametros?.[k] !== undefined) inicial[k] = a.parametros[k];
    setForm(inicial);
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col md:h-[calc(100vh-3rem)]">
      {msgs.length > 0 && (
        <div className="flex justify-end pb-1">
          <button onClick={novaConversa} className="text-xs text-gray-500 hover:text-brand-600">+ Nova conversa</button>
        </div>
      )}
      <div className="flex-1 space-y-3 overflow-y-auto px-1 pb-4">
        {msgs.length === 0 && (
          <div className="mt-6 rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500">
            {vazio ?? <>Peça em linguagem natural. Ex.: “Abra uma OS de manutenção para o cliente X, responsável Carlos, prazo sexta.”
            Ações de OS aparecem como cartão para você confirmar.</>}
            {atalhos.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {atalhos.map((a) => (
                  <button key={a} type="button" disabled={carregando}
                    onClick={(e) => (a.endsWith("…") ? setInput(a.slice(0, -1) + " ") : enviar(e as any, a))}
                    className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs text-gray-700 hover:border-brand-400 hover:text-brand-700">
                    {a}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.papel === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.papel === "user" ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-800"}`}>
              {m.texto && <p className="whitespace-pre-wrap">{m.texto}</p>}
              {m.acoes && m.acoes.length > 0 && (
                <div className="mt-2 space-y-2">
                  {m.acoes.map((a, ai) => {
                    const pend = a.faixa === "amarela" && a.status === "pendente";
                    if (pend) {
                      return (
                        <div key={ai} className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-gray-800">
                          <p className="text-xs font-semibold text-amber-800">Confirmação necessária</p>
                          <p className="mt-0.5 text-sm">{a.resumo}</p>
                          {typeof a.valor === "number" && a.valor > 0 && (
                            <p className="mt-0.5 text-sm font-bold text-amber-900">Valor: {brl(a.valor)}</p>
                          )}
                          {editando === a.id ? (
                            <div className="mt-2 space-y-1">
                              {Object.keys(form).map((k) => (
                                <label key={k} className="flex items-center gap-2 text-xs">
                                  <span className="w-28 shrink-0 text-gray-500">{k}</span>
                                  <input
                                    value={form[k] ?? ""}
                                    onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                                    className="flex-1 rounded border px-2 py-1"
                                  />
                                </label>
                              ))}
                              <div className="mt-1 flex gap-2">
                                <button onClick={() => decidir(a, "editar", form)} className="rounded bg-brand-600 px-2 py-1 text-xs text-white">Salvar</button>
                                <button onClick={() => setEditando(null)} className="text-xs text-gray-500 hover:underline">voltar</button>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-2 flex gap-2">
                              <button onClick={() => decidir(a, "confirmar")} className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white">Confirmar</button>
                              <button onClick={() => abrirEdicao(a)} className="rounded border px-3 py-1 text-xs text-gray-700 hover:bg-white">Editar</button>
                              <button onClick={() => decidir(a, "cancelar")} className="rounded px-3 py-1 text-xs text-gray-500 hover:text-red-600">Cancelar</button>
                            </div>
                          )}
                        </div>
                      );
                    }
                    // itens já executados / cancelados / desfeitos
                    const feito = a.status === "executada";
                    const cancelada = a.status === "rejeitada";
                    const desfeita = a.status === "desfeita";
                    return (
                      <div key={ai} className="flex items-center gap-2 text-xs">
                        <span className={desfeita || cancelada ? "text-gray-400 line-through" : "text-gray-700"}>• {a.resumo}</span>
                        {cancelada && <span className="text-[11px] text-gray-400">cancelado</span>}
                        {desfeita && <span className="text-[11px] text-gray-400">desfeito</span>}
                        {feito && a.link && <Link href={a.link} className="text-brand-600 hover:underline">abrir</Link>}
                        {feito && a.reversivel && a.id && (
                          <button onClick={() => desfazer(a)} className="text-gray-500 hover:text-red-600 hover:underline">desfazer</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
        {carregando && <div className="text-sm text-gray-400">{nome} está pensando…</div>}
        <div ref={fim} />
      </div>

      <form onSubmit={enviar} className="flex items-end gap-2 border-t bg-white pt-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              enviar(e as any);
            }
          }}
          rows={1}
          placeholder={ouvindo ? "Ouvindo… pode falar" : `Peça algo ao ${nome}…`}
          className="flex-1 resize-none rounded-lg border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
        {suportaVoz && (
          <button
            type="button"
            onClick={alternarMic}
            disabled={carregando}
            aria-label={ouvindo ? "Parar ditado" : "Ditar por voz"}
            title={ouvindo ? "Parar ditado" : "Ditar por voz"}
            className={`rounded-lg px-3 py-2 text-lg disabled:opacity-40 ${ouvindo ? "animate-pulse bg-red-100 text-red-600" : "border text-gray-500 hover:bg-gray-50"}`}
          >
            {ouvindo ? "⏹" : "🎤"}
          </button>
        )}
        <button type="submit" disabled={carregando || !input.trim()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
          Enviar
        </button>
      </form>
    </div>
  );
}
