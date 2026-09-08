"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { EMISSORA, type Emissora } from "@/lib/empresa";

// Retorna os dados da empresa EMISSORA a partir da empresa ativa (respeita o
// modo suporte do superadmin). Enquanto carrega, ou se algum campo estiver
// vazio, cai no fallback fixo (EMISSORA) para não quebrar o layout.
export function useEmissora(): Emissora {
  const [emissora, setEmissora] = useState<Emissora>(EMISSORA);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc("empresa_atual");
      const e = Array.isArray(data) ? data[0] : data;
      if (!vivo || !e) return;
      setEmissora({
        nome: e.nome || EMISSORA.nome,
        cnpj: e.documento || EMISSORA.cnpj,
        endereco: e.endereco || EMISSORA.endereco,
        telefone: e.telefone || EMISSORA.telefone,
        logo: e.logo || EMISSORA.logo,
        sistema: e.sistema || EMISSORA.sistema,
      });
    })();
    return () => { vivo = false; };
  }, []);

  return emissora;
}
