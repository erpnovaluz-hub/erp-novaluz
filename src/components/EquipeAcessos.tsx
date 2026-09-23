"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  MODULOS, PAPEIS, PAPEIS_CONFIGURAVEIS, nivelPadrao, papelLabel,
  type Modulo, type Nivel, type Papel,
} from "@/lib/permissoes";

type Perfil = { id: string; nome: string | null; email: string | null; papel: string; ativo: boolean | null };
type Override = { papel: string; modulo: string; nivel: Nivel };

const NIVEIS: { value: Nivel; label: string; cor: string }[] = [
  { value: "nenhum", label: "Sem acesso", cor: "text-gray-400" },
  { value: "ver", label: "Ver", cor: "text-blue-700" },
  { value: "editar", label: "Editar", cor: "text-green-700" },
];

export default function EquipeAcessos({ empresaId, empresaNome, meuId }: { empresaId: string | null; empresaNome: string; meuId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [perfis, setPerfis] = useState<Perfil[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  // novo usuário
  const [nNome, setNNome] = useState("");
  const [nEmail, setNEmail] = useState("");
  const [nSenha, setNSenha] = useState("");
  const [nPapel, setNPapel] = useState<Papel>("almoxarifado");
  const [criando, setCriando] = useState(false);

  const carregar = useCallback(async () => {
    if (!empresaId) return;
    setCarregando(true);
    const [p, o] = await Promise.all([
      supabase.from("perfis").select("id, nome, email, papel, ativo").eq("empresa_consultora_id", empresaId).neq("papel", "super").order("nome"),
      supabase.from("permissoes_papel").select("papel, modulo, nivel").eq("empresa_consultora_id", empresaId),
    ]);
    if (p.error) setErro(p.error.message);
    setPerfis((p.data ?? []) as Perfil[]);
    setOverrides((o.data ?? []) as Override[]);
    setCarregando(false);
  }, [supabase, empresaId]);

  useEffect(() => { carregar(); }, [carregar]);

  function aviso(msg: string) { setOk(msg); setErro(null); setTimeout(() => setOk(null), 3000); }

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setCriando(true); setErro(null);
    const r = await fetch("/api/equipe/usuarios", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: nNome.trim(), email: nEmail.trim(), senha: nSenha, papel: nPapel }),
    });
    const j = await r.json().catch(() => ({}));
    setCriando(false);
    if (!r.ok) { setErro(j.error ?? "Falha ao criar usuário."); return; }
    setNNome(""); setNEmail(""); setNSenha("");
    aviso("Usuário criado. Passe o e-mail e a senha para a pessoa.");
    carregar();
  }

  async function alterar(p: Perfil, campos: Partial<Perfil>) {
    const { error } = await supabase.from("perfis").update(campos).eq("id", p.id);
    if (error) { setErro(error.message); return; }
    aviso("Alteração salva.");
    carregar();
  }

  async function redefinirSenha(p: Perfil) {
    const senha = window.prompt(`Nova senha para ${p.nome ?? p.email} (mín. 6 caracteres):`);
    if (!senha) return;
    const r = await fetch("/api/equipe/usuarios", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, senha }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(j.error ?? "Falha ao redefinir a senha."); return; }
    aviso("Senha redefinida.");
  }

  function nivelDe(papel: Papel, modulo: Modulo): Nivel {
    return overrides.find((o) => o.papel === papel && o.modulo === modulo)?.nivel ?? nivelPadrao(papel, modulo);
  }

  async function definirNivel(papel: Papel, modulo: Modulo, nivel: Nivel) {
    const { error } = nivel === nivelPadrao(papel, modulo)
      // voltou ao padrão: remove a exceção
      ? await supabase.from("permissoes_papel").delete().match({ empresa_consultora_id: empresaId, papel, modulo })
      : await supabase.from("permissoes_papel").upsert(
          { empresa_consultora_id: empresaId, papel, modulo, nivel, atualizado_em: new Date().toISOString() },
          { onConflict: "empresa_consultora_id,papel,modulo" });
    if (error) { setErro(error.message); return; }
    aviso(`${papelLabel(papel)} · ${MODULOS.find((m) => m.key === modulo)?.label}: ${NIVEIS.find((n) => n.value === nivel)?.label}`);
    carregar();
  }

  async function restaurarPadrao(papel: Papel) {
    if (!window.confirm(`Voltar ${papelLabel(papel)} ao padrão de fábrica?`)) return;
    const { error } = await supabase.from("permissoes_papel").delete().match({ empresa_consultora_id: empresaId, papel });
    if (error) { setErro(error.message); return; }
    aviso("Padrão restaurado.");
    carregar();
  }

  if (!empresaId) return <div className="card p-6 text-sm text-gray-500">Nenhuma empresa ativa.</div>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">🔐 Usuários e acessos</h1>
        <p className="text-sm text-gray-500">{empresaNome} · quem entra no sistema e o que cada perfil pode ver e editar</p>
      </div>

      {erro && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}
      {ok && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{ok}</div>}

      {/* Usuários */}
      <section className="space-y-3">
        <h2 className="border-b pb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Usuários</h2>
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">E-mail</th>
                <th className="px-4 py-3">Perfil</th>
                <th className="px-4 py-3">Situação</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {carregando ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Carregando…</td></tr>
              ) : perfis.map((p) => {
                const eu = p.id === meuId;
                const ativo = p.ativo !== false;
                return (
                  <tr key={p.id} className={ativo ? "" : "bg-gray-50 text-gray-400"}>
                    <td className="px-4 py-2">{p.nome ?? "—"}{eu && <span className="ml-2 text-[10px] text-gray-400">(você)</span>}</td>
                    <td className="px-4 py-2 text-gray-600">{p.email ?? "—"}</td>
                    <td className="px-4 py-2">
                      {eu ? papelLabel(p.papel) : (
                        <select className="inp py-1" value={p.papel} onChange={(e) => alterar(p, { papel: e.target.value })}>
                          {PAPEIS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${ativo ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600"}`}>
                        {ativo ? "Ativo" : "Desativado"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      {!eu && (
                        <>
                          <button className="mr-3 text-brand-600 hover:underline" onClick={() => redefinirSenha(p)}>Redefinir senha</button>
                          <button className={ativo ? "text-red-500 hover:underline" : "text-green-600 hover:underline"}
                            onClick={() => (!ativo || window.confirm(`Desativar ${p.nome ?? p.email}? A pessoa perde o acesso na hora.`)) && alterar(p, { ativo: !ativo })}>
                            {ativo ? "Desativar" : "Reativar"}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <form onSubmit={criar} className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <input className="inp" placeholder="Nome" value={nNome} onChange={(e) => setNNome(e.target.value)} />
          <input className="inp" type="email" required placeholder="E-mail de login" value={nEmail} onChange={(e) => setNEmail(e.target.value)} />
          <input className="inp" type="text" required minLength={6} placeholder="Senha inicial (6+)" value={nSenha} onChange={(e) => setNSenha(e.target.value)} />
          <select className="inp" value={nPapel} onChange={(e) => setNPapel(e.target.value as Papel)}>
            {PAPEIS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
          <button className="btn-primary" disabled={criando}>{criando ? "Criando…" : "+ Criar usuário"}</button>
        </form>
      </section>

      {/* Matriz */}
      <section className="space-y-3">
        <div className="flex items-end justify-between border-b pb-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">O que cada perfil acessa</h2>
          <p className="text-xs text-gray-400">Gerência acessa tudo. Valores em R$ (custos, preços, salários) só aparecem para a gerência.</p>
        </div>
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Módulo</th>
                <th className="px-4 py-3">Gerência</th>
                {PAPEIS_CONFIGURAVEIS.map((p) => (
                  <th key={p} className="px-4 py-3">
                    {papelLabel(p)}
                    <button className="ml-2 text-[10px] font-normal normal-case text-brand-600 hover:underline" onClick={() => restaurarPadrao(p)}>padrão</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {MODULOS.map((m) => (
                <tr key={m.key}>
                  <td className="px-4 py-2">
                    <p className="font-medium text-gray-800">{m.label}</p>
                    <p className="text-xs text-gray-400">{m.descricao}</p>
                  </td>
                  <td className="px-4 py-2 text-green-700">Editar</td>
                  {PAPEIS_CONFIGURAVEIS.map((p) => {
                    const n = nivelDe(p, m.key);
                    const alterado = n !== nivelPadrao(p, m.key);
                    return (
                      <td key={p} className="px-4 py-2">
                        <select className={`inp py-1 ${NIVEIS.find((x) => x.value === n)?.cor}`} value={n}
                          onChange={(e) => definirNivel(p, m.key, e.target.value as Nivel)}>
                          {NIVEIS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                        </select>
                        {alterado && <span className="ml-1 text-[10px] text-amber-600" title="Diferente do padrão">●</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
