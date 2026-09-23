"use client";

import { createContext, useContext } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { montarAcesso, podeArea, podeRota, type Acesso, type Area } from "@/lib/permissoes";

const Ctx = createContext<Acesso>(montarAcesso(null));

export function useAcesso(): Acesso {
  return useContext(Ctx);
}

// atalho para telas: pode editar/ver a área?
export function usePode(area: Area, nivel: "ver" | "editar" = "ver"): boolean {
  return podeArea(useAcesso(), area, nivel);
}

// Provê o acesso do usuário e bloqueia rotas fora do perfil.
// (O banco já nega os dados via RLS; isto evita uma tela vazia sem explicação.)
export default function AcessoProvider({ acesso, children }: { acesso: Acesso; children: React.ReactNode }) {
  const pathname = usePathname();
  const liberado = podeRota(acesso, pathname);
  return (
    <Ctx.Provider value={acesso}>
      {liberado ? children : (
        <div className="mx-auto mt-16 max-w-md rounded-xl border bg-white p-6 text-center">
          <p className="text-3xl">🔒</p>
          <h1 className="mt-2 text-lg font-semibold text-gray-800">Sem acesso a esta área</h1>
          <p className="mt-1 text-sm text-gray-500">
            Seu perfil não inclui este módulo. Se precisar, peça à gerência para liberar em <b>Usuários e acessos</b>.
          </p>
          <Link href="/" className="btn-primary mt-4 inline-block">Voltar ao painel</Link>
        </div>
      )}
    </Ctx.Provider>
  );
}
