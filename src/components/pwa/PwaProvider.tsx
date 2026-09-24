"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

// PWA: registra o service worker, oferece "Instalar app" e avisa de nova versão.
type Pwa = { podeInstalar: boolean; ios: boolean; instalado: boolean; instalar: () => void };
const Ctx = createContext<Pwa>({ podeInstalar: false, ios: false, instalado: false, instalar: () => {} });
export const usePwa = () => useContext(Ctx);

const CHAVE_DISPENSA = "pwa.dispensado_ate";

function lerDispensa(): number {
  try { return Number(localStorage.getItem(CHAVE_DISPENSA) || 0); } catch { return 0; }
}

export default function PwaProvider({ children }: { children: React.ReactNode }) {
  const [evento, setEvento] = useState<any>(null);          // beforeinstallprompt (Android/desktop)
  const [ios, setIos] = useState(false);
  const [instalado, setInstalado] = useState(false);
  const [banner, setBanner] = useState(false);
  const [ajudaIos, setAjudaIos] = useState(false);
  const [novaVersao, setNovaVersao] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
    setInstalado(standalone);
    const eIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as any).MSStream;
    setIos(eIos);
    const celular = window.matchMedia("(max-width: 767px)").matches;
    if (!standalone && celular && Date.now() > lerDispensa() && eIos) setBanner(true);

    const antes = (e: Event) => {
      e.preventDefault();
      setEvento(e);
      if (!standalone && celular && Date.now() > lerDispensa()) setBanner(true);
    };
    const feito = () => { setInstalado(true); setBanner(false); setEvento(null); };
    window.addEventListener("beforeinstallprompt", antes);
    window.addEventListener("appinstalled", feito);

    // service worker só em produção (em dev atrapalha o hot reload)
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").then((reg) => {
        const vigiar = (sw: ServiceWorker | null) => {
          if (!sw) return;
          sw.addEventListener("statechange", () => {
            if (sw.state === "installed" && navigator.serviceWorker.controller) setNovaVersao(sw);
          });
        };
        if (reg.waiting && navigator.serviceWorker.controller) setNovaVersao(reg.waiting);
        reg.addEventListener("updatefound", () => vigiar(reg.installing));
        // confere atualização ao voltar para o app
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
      }).catch(() => {});
      let recarregando = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!recarregando) { recarregando = true; window.location.reload(); }
      });
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", antes);
      window.removeEventListener("appinstalled", feito);
    };
  }, []);

  const instalar = useCallback(async () => {
    if (evento) {
      evento.prompt();
      await evento.userChoice.catch(() => null);
      setEvento(null); setBanner(false);
    } else if (ios) {
      setAjudaIos(true);
    }
  }, [evento, ios]);

  function dispensar() {
    setBanner(false);
    try { localStorage.setItem(CHAVE_DISPENSA, String(Date.now() + 14 * 86400000)); } catch {}
  }

  const podeInstalar = !instalado && (!!evento || ios);

  return (
    <Ctx.Provider value={{ podeInstalar, ios, instalado, instalar }}>
      {children}

      {/* nova versão publicada */}
      {novaVersao && (
        <div className="no-print fixed inset-x-3 top-3 z-[70] mx-auto flex max-w-md items-center gap-3 rounded-xl bg-gray-900 px-4 py-3 text-sm text-white shadow-xl"
          style={{ marginTop: "env(safe-area-inset-top)" }}>
          <span className="flex-1">Nova versão do app disponível.</span>
          <button className="rounded-lg bg-white px-3 py-1.5 font-medium text-gray-900" onClick={() => novaVersao.postMessage("SKIP_WAITING")}>Atualizar</button>
        </div>
      )}

      {/* convite para instalar (celular) */}
      {banner && podeInstalar && !ajudaIos && (
        <div className="no-print fixed inset-x-3 z-[60] mx-auto flex max-w-md items-center gap-3 rounded-xl border bg-white p-3 text-sm shadow-xl md:hidden"
          style={{ bottom: "calc(72px + env(safe-area-inset-bottom))" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" className="h-10 w-10 rounded-lg" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-gray-900">Instale o app Novaluz</p>
            <p className="text-xs text-gray-500">Abre direto da tela inicial, em tela cheia.</p>
          </div>
          <button className="btn-primary px-3 py-1.5" onClick={instalar}>Instalar</button>
          <button className="px-1 text-lg leading-none text-gray-400" onClick={dispensar} aria-label="Agora não">×</button>
        </div>
      )}

      {/* iPhone não tem botão de instalar: explica o caminho */}
      {ajudaIos && (
        <div className="no-print fixed inset-0 z-[80] flex items-end bg-black/40" onClick={() => { setAjudaIos(false); dispensar(); }}>
          <div className="w-full rounded-t-2xl bg-white p-5 text-sm" style={{ paddingBottom: "calc(20px + env(safe-area-inset-bottom))" }} onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-semibold text-gray-900">Instalar no iPhone</p>
            <ol className="mt-3 space-y-2 text-gray-700">
              <li>1. No Safari, toque em <b>Compartilhar</b> <span aria-hidden>⬆️</span> (barra de baixo).</li>
              <li>2. Role e toque em <b>Adicionar à Tela de Início</b>.</li>
              <li>3. Toque em <b>Adicionar</b>. O ícone Novaluz aparece junto dos outros apps.</li>
            </ol>
            <p className="mt-3 text-xs text-gray-500">Precisa ser pelo Safari (no Chrome do iPhone a opção não aparece).</p>
            <button className="btn-primary mt-4 w-full" onClick={() => { setAjudaIos(false); dispensar(); }}>Entendi</button>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
