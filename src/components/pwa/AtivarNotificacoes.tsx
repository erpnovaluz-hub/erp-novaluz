"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePwa } from "@/components/pwa/PwaProvider";

type Estado = "carregando" | "sem_suporte" | "ios_instalar" | "negado" | "desligado" | "ligado" | "sem_chave";

function chaveUint8(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const bin = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function registroAtual(): Promise<ServiceWorkerRegistration | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;
  await reg.update().catch(() => {});
  return reg;
}

// Liga/desliga as notificações NESTE aparelho (cada celular/computador ativa o seu).
export default function AtivarNotificacoes({ compacto = false }: { compacto?: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const { ios, instalado } = usePwa();
  const [estado, setEstado] = useState<Estado>("carregando");
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // chave pública buscada no servidor em tempo de execução (não depende do build)
  const [chave, setChave] = useState<string | null>(null);
  const [faltando, setFaltando] = useState<string[]>([]);

  const avaliar = useCallback(async () => {
    let k: string | null = null;
    try {
      const r = await fetch("/api/push/config", { cache: "no-store" });
      const j = await r.json();
      k = j.publicKey ?? null;
      setChave(k);
      setFaltando(j.faltando ?? []);
    } catch { /* sem rede */ }
    if (!k) { setEstado("sem_chave"); return; }
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setEstado(ios && !instalado ? "ios_instalar" : "sem_suporte"); return;
    }
    if (Notification.permission === "denied") { setEstado("negado"); return; }
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    setEstado(sub && Notification.permission === "granted" ? "ligado" : "desligado");
  }, [ios, instalado]);

  useEffect(() => { avaliar(); }, [avaliar]);

  async function ligar() {
    setOcupado(true); setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setEstado(perm === "denied" ? "negado" : "desligado"); return; }
      const reg = await registroAtual();
      if (!reg) throw new Error("O app ainda está carregando. Recarregue a página e tente de novo.");
      const sub = (await reg.pushManager.getSubscription())
        ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveUint8(chave!) });
      const j = sub.toJSON() as any;
      const { error } = await supabase.from("push_inscricoes").upsert({
        endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
        aparelho: navigator.userAgent.slice(0, 200),
      }, { onConflict: "endpoint" });
      if (error) throw error;
      setEstado("ligado");
      setMsg("Pronto! Este aparelho vai receber os avisos.");
      // se há versão nova do app esperando (a que sabe exibir o push), ativa agora — a página recarrega
      if (reg.waiting) reg.waiting.postMessage("SKIP_WAITING");
    } catch (e: any) {
      setMsg(e.message ?? String(e));
    } finally { setOcupado(false); }
  }

  async function desligar() {
    setOcupado(true); setMsg(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await supabase.from("push_inscricoes").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
      setEstado("desligado");
    } finally { setOcupado(false); }
  }

  async function testar() {
    setOcupado(true); setMsg(null);
    const r = await fetch("/api/push/teste", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setOcupado(false);
    setMsg(r.ok ? `Teste enviado para ${j.enviados} aparelho(s). Deve chegar em alguns segundos.` : j.error ?? "Falha no teste.");
  }

  if (estado === "carregando") return null;
  if (estado === "sem_chave") {
    // app publicado sem NEXT_PUBLIC_VAPID_PUBLIC_KEY (a chave entra no build): avisa em vez de sumir
    return compacto ? null : (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        🔕 Notificações no celular ainda não configuradas no servidor.
        {faltando.length > 0 && <> Faltando na Vercel (Production): <b>{faltando.join(", ")}</b>.</>}
      </div>
    );
  }
  if (compacto && estado === "ligado") return null;

  return (
    <div className={`rounded-xl border p-3 text-sm ${estado === "ligado" ? "border-green-200 bg-green-50" : "border-brand-200 bg-brand-50/60"}`}>
      {estado === "ligado" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1 text-green-800">🔔 Notificações <b>ativadas</b> neste aparelho.</span>
          <button className="btn-ghost bg-white px-3 py-1 text-xs ring-1 ring-green-200" disabled={ocupado} onClick={testar}>Enviar teste</button>
          <button className="text-xs text-gray-500 underline" disabled={ocupado} onClick={desligar}>desativar</button>
        </div>
      )}
      {estado === "desligado" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1 text-gray-700">📲 Receba no celular quando te passarem uma tarefa, te mencionarem ou comentarem.</span>
          <button className="btn-primary px-3 py-1.5" disabled={ocupado} onClick={ligar}>{ocupado ? "Ativando…" : "Ativar notificações"}</button>
        </div>
      )}
      {estado === "ios_instalar" && (
        <p className="text-gray-700">📲 No iPhone, as notificações funcionam com o app <b>instalado</b>: Safari → Compartilhar → <b>Adicionar à Tela de Início</b>, abra pelo ícone e volte aqui. (iOS 16.4 ou mais novo.)</p>
      )}
      {estado === "negado" && (
        <p className="text-gray-700">🔕 As notificações foram <b>bloqueadas</b> neste navegador. Libere em Configurações do site (ícone de cadeado ao lado do endereço) → Notificações → Permitir, e recarregue.</p>
      )}
      {estado === "sem_suporte" && !compacto && (
        <p className="text-gray-500">Este navegador não recebe notificações do app. Use o Chrome (Android/computador) ou o app instalado no iPhone.</p>
      )}
      {msg && <p className="mt-2 text-xs text-gray-600">{msg}</p>}
    </div>
  );
}
