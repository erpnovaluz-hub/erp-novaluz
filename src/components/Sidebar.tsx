"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { GROUPS, entitiesByGroup, type GroupKey } from "@/lib/entities";
import { createClient } from "@/lib/supabase/client";
import { podeRota, papelLabel, type Acesso } from "@/lib/permissoes";

type LinkItem = { href: string; icon: string; label: string };

function itensDoGrupo(key: GroupKey): LinkItem[] {
  const g = GROUPS.find((x) => x.key === key)!;
  const ents = entitiesByGroup(key).map((e) => ({ href: `/e/${e.key}`, icon: e.icon, label: e.labelPlural }));
  return [...ents, ...(g.extras ?? [])];
}

export default function Sidebar({ empresaNome, email, isSuper, acesso }: { empresaNome: string; email: string; isSuper?: boolean; acesso: Acesso }) {
  const pathname = usePathname();
  // menu só com o que o perfil alcança
  const grupos = useMemo(
    () => GROUPS.map((g) => ({ g, itens: itensDoGrupo(g.key).filter((i) => podeRota(acesso, i.href)) })).filter((x) => x.itens.length > 0),
    [acesso],
  );
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

  // não lidas da caixa de entrada: reconta ao navegar, a cada minuto e quando a caixa avisa
  const [naoLidas, setNaoLidas] = useState(0);
  useEffect(() => {
    const supabase = createClient();
    const contar = () => supabase.from("notificacoes").select("id", { count: "exact", head: true }).eq("lida", false)
      .then(({ count }) => setNaoLidas(count ?? 0));
    contar();
    const h = setInterval(contar, 60000);
    window.addEventListener("notificacoes", contar);
    return () => { clearInterval(h); window.removeEventListener("notificacoes", contar); };
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
        <Link href="/tarefas/caixa" className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${pathname === "/tarefas/caixa" ? "bg-brand-600 text-white" : "text-gray-700 hover:bg-gray-100"}`}>
          🔔 Caixa de entrada
          {naoLidas > 0 && <span className="ml-auto rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">{naoLidas > 99 ? "99+" : naoLidas}</span>}
        </Link>
        <Link href="/tarefas" className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${pathname === "/tarefas" ? "bg-brand-600 text-white" : "text-gray-700 hover:bg-gray-100"}`}>
          ✅ Minhas tarefas
        </Link>
        <Link href="/tarefas/projetos" className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${pathname.startsWith("/tarefas/projetos") ? "bg-brand-600 text-white" : "text-gray-700 hover:bg-gray-100"}`}>
          📁 Projetos
        </Link>
        {acesso.gerencia && (
          <Link href="/tarefas/painel" className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${pathname === "/tarefas/painel" ? "bg-brand-600 text-white" : "text-gray-700 hover:bg-gray-100"}`}>
            📊 Painel do time
          </Link>
        )}
        {acesso.gerencia && (
          <Link href="/equipe" className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${pathname === "/equipe" ? "bg-brand-600 text-white" : "text-gray-700 hover:bg-gray-100"}`}>
            🔐 Usuários e acessos
          </Link>
        )}
        {grupos.map(({ g, itens }) => {
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
        {acesso.papel && <p className="text-[10px] uppercase tracking-wide text-gray-400">{papelLabel(acesso.papel)}</p>}
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
