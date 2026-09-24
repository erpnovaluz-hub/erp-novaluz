"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useNaoLidas } from "@/components/useNaoLidas";

// Barra de abas do celular (some no desktop). "Menu" abre a barra lateral completa.
const ABAS = [
  { href: "/", icon: "🏠", label: "Início", ativo: (p: string) => p === "/" },
  { href: "/tarefas", icon: "✅", label: "Tarefas", ativo: (p: string) => p === "/tarefas" },
  { href: "/tarefas/caixa", icon: "🔔", label: "Caixa", ativo: (p: string) => p === "/tarefas/caixa" },
  { href: "/tarefas/projetos", icon: "📁", label: "Projetos", ativo: (p: string) => p.startsWith("/tarefas/projetos") },
];

export default function BottomNav() {
  const pathname = usePathname();
  const naoLidas = useNaoLidas();
  return (
    <nav className="no-print fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-white/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      {ABAS.map((a) => {
        const ativo = a.ativo(pathname);
        return (
          <Link key={a.href} href={a.href}
            className={`relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${ativo ? "font-semibold text-brand-700" : "text-gray-500"}`}>
            <span className="text-lg leading-none">{a.icon}</span>
            {a.label}
            {a.href === "/tarefas/caixa" && naoLidas > 0 && (
              <span className="absolute right-[22%] top-1.5 rounded-full bg-red-500 px-1.5 text-[10px] font-semibold leading-4 text-white">
                {naoLidas > 99 ? "99+" : naoLidas}
              </span>
            )}
            {ativo && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-brand-600" />}
          </Link>
        );
      })}
      <button onClick={() => window.dispatchEvent(new Event("abrir-menu"))}
        className="flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-gray-500">
        <span className="text-lg leading-none">☰</span>
        Menu
      </button>
    </nav>
  );
}
