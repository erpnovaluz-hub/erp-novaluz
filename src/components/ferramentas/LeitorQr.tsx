"use client";

import { useEffect, useRef, useState } from "react";
import { codigoDoQr } from "@/lib/ferramentas";

// Leitor de QR pela câmera (Android/Chrome: BarcodeDetector nativo).
// Onde não há suporte (iPhone), orienta a usar a câmera do celular — a etiqueta
// abre o link direto — ou digitar o código.
export default function LeitorQr({ onLido, onFechar }: { onLido: (codigo: string) => void; onFechar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [suporte, setSuporte] = useState<boolean | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    const BD = (window as any).BarcodeDetector;
    if (!BD || !navigator.mediaDevices?.getUserMedia) { setSuporte(false); return; }
    setSuporte(true);
    let stream: MediaStream | null = null;
    let parar = false;
    const detector = new BD({ formats: ["qr_code"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const loop = async () => {
          if (parar || !video.current) return;
          try {
            const achados = await detector.detect(video.current);
            const cod = achados.map((a: any) => codigoDoQr(a.rawValue)).find(Boolean);
            if (cod) { parar = true; onLido(cod); return; }
          } catch { /* quadro sem imagem ainda */ }
          setTimeout(loop, 250);
        };
        loop();
      } catch (e: any) {
        setErro(e?.name === "NotAllowedError" ? "Permita o uso da câmera para ler o QR." : "Não foi possível abrir a câmera.");
      }
    })();
    return () => { parar = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [onLido]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center" onClick={onFechar}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-semibold text-gray-900">📷 Ler etiqueta</p>
          <button className="text-2xl leading-none text-gray-400" onClick={onFechar} aria-label="Fechar">×</button>
        </div>
        {suporte && (
          <div className="relative overflow-hidden rounded-xl bg-black">
            <video ref={video} className="aspect-square w-full object-cover" playsInline muted />
            <div className="pointer-events-none absolute inset-10 rounded-xl border-2 border-white/80" />
          </div>
        )}
        {suporte === false && (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            Este aparelho não lê QR dentro do app. Aponte a <b>câmera do celular</b> para a etiqueta (ela abre a ferramenta direto) ou digite o código abaixo.
          </p>
        )}
        {erro && <p className="mt-2 text-sm text-red-600">{erro}</p>}
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const c = codigoDoQr(manual); if (c) onLido(c); }}>
          <input className="inp flex-1 uppercase" placeholder="ou digite o código (FER-0001)" value={manual} onChange={(e) => setManual(e.target.value)} />
          <button className="btn-primary" disabled={!codigoDoQr(manual)}>Abrir</button>
        </form>
      </div>
    </div>
  );
}
