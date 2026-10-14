"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Não lidas da caixa de entrada: reconta ao navegar, a cada minuto,
// ao voltar para o app e quando a caixa avisa (evento "notificacoes").
export function useNaoLidas(): number {
  const pathname = usePathname();
  const [n, setN] = useState(0);
  useEffect(() => {
    const supabase = createClient();
    const contar = () => supabase.from("notificacoes").select("id", { count: "exact", head: true }).eq("lida", false)
      .then(({ count }) => {
        setN(count ?? 0);
        const nav = navigator as any;
        try { if (count) nav.setAppBadge?.(count); else nav.clearAppBadge?.(); } catch {}
      });
    const aoVoltar = () => { if (document.visibilityState === "visible") contar(); };
    contar();
    const h = setInterval(contar, 60000);
    window.addEventListener("notificacoes", contar);
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      clearInterval(h);
      window.removeEventListener("notificacoes", contar);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [pathname]);
  return n;
}
