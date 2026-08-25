"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { GROUPS, entitiesByGroup, type GroupKey } from "@/lib/entities";
import { createClient } from "@/lib/supabase/client";

type LinkItem = { href: string; icon: string; label: string };

function itensDoGrupo(key: GroupKey): LinkItem[] {
  const g = GROUPS.find((x) => x.key === key)!;
  const ents = entitiesByGroup(key).map((e) => ({ href: `/e/${e.key}`, icon: e.icon, label: e.labelPlural }));
  return [...ents, ...(g.extras ?? [])];
}

export default function Sidebar({ empresaNome, email, isSuper }: { empresaNome: string; email: string; isSuper?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobile, setMobile] = useState(false);

  // grupo ativo pelo pathname
  const grupoAtivo = useMemo(() => {
    for (const g of GROUPS) {
      for (const it of itensDoGrupo(g.key)) {
        const base = it.href.split("/").slice(0, 2).join("/");
        if (pathname === it.href || (base.length > 1 && pathname.startsWith(base))) return g.key;
      }
    }
    return null;
  }, [pathname]);

  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  useEffect(() => { if (grupoAtivo) setAbertos((s) => new Set(s).add(grupoAtivo)); }, [grupoAtivo]);
  useEffect(() => { setMobile(false); }, [pathname]);

  function toggle(k: string) {
    setAbertos((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }
  async function sair() {
    await createClient().auth.signOut(); router.refresh(); router.replace("/login");
  }

  const conteudo = (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-novaluz.png" alt="Novaluz" className="h-auto w-[170px]" />
        <p className="mt-1 truncate text-xs text-gray-400">{empresaNome}</p>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        <Link href="/" className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${pathname === "/" ? "bg-brand-600 text-white" : "text-gray-700 hover:bg-gray-100"}`}>
          📊 Painel
        </Link>
        {isSuper && (
          <Link href="/admin" className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${pathname === "/admin" ? "bg-purple-600 text-white" : "text-purple-700 hover:bg-purple-50"}`}>
            🏢 Administração central
          </Link>
        )}
        {GROUPS.map((g) => {
          const itens = itensDoGrupo(g.key);
          const aberto = abertos.has(g.key);
          return (
            <div key={g.key}>
              <button onClick={() => toggle(g.key)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium ${grupoAtivo === g.key ? "text-brand-700" : "text-gray-700"} hover:bg-gray-100`}>
                <span>{g.icon} {g.label}</span>
                <span className="text-[10px] text-gray-400">{aberto ? "▾" : "▸"}</span>
              </button>
              {aberto && (
                <div className="ml-2 border-l border-gray-200 pl-2">
                  {itens.map((i) => {
                    const base = i.href.split("/").slice(0, 2).join("/");
                    const ativo = pathname === i.href || (i.href.length > 3 && pathname.startsWith(i.href)) || (base.length > 1 && pathname.startsWith(base) && base === i.href);
                    return (
                      <Link key={i.href} href={i.href}
                        className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${pathname === i.href ? "bg-brand-50 font-medium text-brand-700" : "text-gray-600 hover:bg-gray-100"}`}>
                        <span className="w-4 text-center text-xs">{i.icon}</span> <span className="truncate">{i.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t p-3 text-xs">
        <p className="truncate text-gray-400">{email}</p>
        <button onClick={sair} className="mt-1 text-gray-500 hover:text-gray-800">Sair</button>
      </div>
    </div>
  );

  return (
    <>
      {/* barra mobile */}
      <div className="flex items-center justify-between border-b bg-white px-4 py-2 md:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-novaluz.png" alt="Novaluz" className="h-8 w-auto" />
        <button className="btn-ghost" onClick={() => setMobile(true)}>☰</button>
      </div>
      {mobile && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setMobile(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <aside className="absolute left-0 top-0 h-full w-72 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>{conteudo}</aside>
        </div>
      )}
      {/* desktop */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r bg-white md:block">{conteudo}</aside>
    </>
  );
}
