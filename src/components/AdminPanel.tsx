"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Row = Record<string, any>;

export default function AdminPanel() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  async function entrarEmpresa(empId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("perfis").update({ empresa_ativa: empId }).eq("id", user.id);
    router.refresh();
    router.push("/");
  }
  const [empresas, setEmpresas] = useState<Row[]>([]);
  const [usuarios, setUsuarios] = useState<Row[]>([]);
  const [msg, setMsg] = useState<{ t: "ok" | "erro"; m: string } | null>(null);
  const empMap = useMemo(() => Object.fromEntries(empresas.map((e) => [e.id, e.nome])), [empresas]);

  // form empresa
  const [empNome, setEmpNome] = useState("");
  const [empDoc, setEmpDoc] = useState("");
  // edição da empresa (dados da emissora)
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Row>({});
  const [salvando, setSalvando] = useState(false);
  const [subindoLogo, setSubindoLogo] = useState(false);
  // form usuário
  const [uEmail, setUEmail] = useState("");
  const [uSenha, setUSenha] = useState("");
  const [uNome, setUNome] = useState("");
  const [uEmpresa, setUEmpresa] = useState("");
  const [uPapel, setUPapel] = useState("admin");
  const [criando, setCriando] = useState(false);

  const carregar = useCallback(async () => {
    const [e, u] = await Promise.all([
      supabase.from("empresas_consultoras").select("*").order("nome"),
      supabase.from("perfis").select("id, nome, email, papel, empresa_consultora_id"),
    ]);
    setEmpresas(e.data ?? []); setUsuarios(u.data ?? []);
  }, [supabase]);

  useEffect(() => { carregar(); }, [carregar]);

  async function criarEmpresa(ev: React.FormEvent) {
    ev.preventDefault(); setMsg(null);
    if (!empNome.trim()) return;
    const { error } = await supabase.from("empresas_consultoras").insert({ nome: empNome.trim(), documento: empDoc.trim() || null });
    if (error) { setMsg({ t: "erro", m: error.message }); return; }
    setEmpNome(""); setEmpDoc(""); setMsg({ t: "ok", m: "Empresa criada." }); carregar();
  }

  function abrirEdicao(e: Row) {
    setEditId(e.id);
    setEditForm({
      nome: e.nome ?? "", documento: e.documento ?? "", endereco: e.endereco ?? "",
      telefone: e.telefone ?? "", sistema: e.sistema ?? "", logo: e.logo ?? "",
    });
    setMsg(null);
  }

  async function salvarEmpresa(ev: React.FormEvent) {
    ev.preventDefault(); if (!editId) return; setSalvando(true); setMsg(null);
    const { error } = await supabase.from("empresas_consultoras").update({
      nome: (editForm.nome ?? "").trim(),
      documento: (editForm.documento ?? "").trim() || null,
      endereco: (editForm.endereco ?? "").trim() || null,
      telefone: (editForm.telefone ?? "").trim() || null,
      sistema: (editForm.sistema ?? "").trim() || null,
      logo: (editForm.logo ?? "").trim() || null,
    }).eq("id", editId);
    setSalvando(false);
    if (error) { setMsg({ t: "erro", m: error.message }); return; }
    setEditId(null); setMsg({ t: "ok", m: "Dados da empresa atualizados." }); carregar();
  }

  async function subirLogo(ev: React.ChangeEvent<HTMLInputElement>, empId: string) {
    const file = ev.target.files?.[0]; if (!file) return;
    setSubindoLogo(true); setMsg(null);
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${empId}/logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("logos").upload(path, file, { upsert: true, cacheControl: "3600" });
    setSubindoLogo(false);
    ev.target.value = "";
    if (error) { setMsg({ t: "erro", m: error.message }); return; }
    const url = supabase.storage.from("logos").getPublicUrl(path).data.publicUrl;
    setEditForm((f) => ({ ...f, logo: url }));
  }

  async function criarUsuario(ev: React.FormEvent) {
    ev.preventDefault(); setMsg(null); setCriando(true);
    const res = await fetch("/api/admin/criar-usuario", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: uEmail.trim(), senha: uSenha, nome: uNome.trim(), empresa_id: uEmpresa, papel: uPapel }),
    });
    const j = await res.json();
    setCriando(false);
    if (!res.ok) { setMsg({ t: "erro", m: j.error || "Falha ao criar usuário." }); return; }
    setUEmail(""); setUSenha(""); setUNome(""); setMsg({ t: "ok", m: "Usuário criado e vinculado." }); carregar();
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">🏢 Administração central</h1>
        <p className="text-sm text-gray-500">Empresas e liberação de acesso. Cada empresa vê apenas os seus dados.</p>
      </div>

      {msg && <div className={`rounded-lg p-3 text-sm ${msg.t === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg.m}</div>}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Empresas */}
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Empresas ({empresas.length})</h2>
          <div className="card mb-3 divide-y divide-gray-100">
            {empresas.length === 0 ? <p className="p-4 text-sm text-gray-400">Nenhuma empresa.</p> :
              empresas.map((e) => (
                <div key={e.id} className="px-4 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {e.logo && <img src={e.logo} alt="" className="h-6 w-6 shrink-0 rounded object-contain" />}
                      <div className="min-w-0">
                        <span className="font-medium text-gray-800">{e.nome}</span>
                        {e.documento && <span className="ml-2 text-xs text-gray-400">{e.documento}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button onClick={() => (editId === e.id ? setEditId(null) : abrirEdicao(e))} className="rounded-lg px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50">
                        {editId === e.id ? "Fechar" : "Editar"}
                      </button>
                      <button onClick={() => entrarEmpresa(e.id)} className="rounded-lg px-2 py-1 text-xs font-medium text-purple-700 ring-1 ring-purple-200 hover:bg-purple-50">
                        Entrar →
                      </button>
                    </div>
                  </div>

                  {editId === e.id && (
                    <form onSubmit={salvarEmpresa} className="mt-3 space-y-2 rounded-lg bg-gray-50 p-3">
                      <p className="text-xs font-medium text-gray-500">Dados que saem nos documentos (proposta, contrato, OS, pedido)</p>
                      <input className="inp" placeholder="Nome / razão social" value={editForm.nome ?? ""} onChange={(ev) => setEditForm((f) => ({ ...f, nome: ev.target.value }))} required />
                      <div className="grid grid-cols-2 gap-2">
                        <input className="inp" placeholder="CNPJ" value={editForm.documento ?? ""} onChange={(ev) => setEditForm((f) => ({ ...f, documento: ev.target.value }))} />
                        <input className="inp" placeholder="Telefone" value={editForm.telefone ?? ""} onChange={(ev) => setEditForm((f) => ({ ...f, telefone: ev.target.value }))} />
                      </div>
                      <input className="inp" placeholder="Endereço" value={editForm.endereco ?? ""} onChange={(ev) => setEditForm((f) => ({ ...f, endereco: ev.target.value }))} />
                      <input className="inp" placeholder="Rodapé do sistema (ex: SISTEMA NOVALUZ)" value={editForm.sistema ?? ""} onChange={(ev) => setEditForm((f) => ({ ...f, sistema: ev.target.value }))} />
                      <div className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {editForm.logo ? <img src={editForm.logo} alt="logo" className="h-10 w-10 rounded object-contain ring-1 ring-gray-200" /> : <div className="flex h-10 w-10 items-center justify-center rounded bg-gray-200 text-[10px] text-gray-400">logo</div>}
                        <label className="cursor-pointer rounded-lg px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-200 hover:bg-white">
                          {subindoLogo ? "Enviando…" : "Enviar logo"}
                          <input type="file" accept="image/*" className="hidden" disabled={subindoLogo} onChange={(ev) => subirLogo(ev, e.id)} />
                        </label>
                        {editForm.logo && <button type="button" onClick={() => setEditForm((f) => ({ ...f, logo: "" }))} className="text-xs text-gray-400 hover:text-red-600">remover</button>}
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button className="btn-primary" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
                        <button type="button" onClick={() => setEditId(null)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100">Cancelar</button>
                      </div>
                    </form>
                  )}
                </div>
              ))}
          </div>
          <form onSubmit={criarEmpresa} className="card space-y-3 p-4">
            <p className="text-sm font-medium text-gray-700">Nova empresa</p>
            <input className="inp" placeholder="Nome / razão social" value={empNome} onChange={(e) => setEmpNome(e.target.value)} required />
            <input className="inp" placeholder="CNPJ (opcional)" value={empDoc} onChange={(e) => setEmpDoc(e.target.value)} />
            <button className="btn-primary w-full">Criar empresa</button>
          </form>
        </div>

        {/* Usuários */}
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Usuários / acessos ({usuarios.length})</h2>
          <div className="card mb-3 divide-y divide-gray-100">
            {usuarios.length === 0 ? <p className="p-4 text-sm text-gray-400">Nenhum usuário.</p> :
              usuarios.map((u) => (
                <div key={u.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <div>
                    <p className="font-medium text-gray-800">{u.nome || u.email}</p>
                    <p className="text-xs text-gray-400">{u.email} · {empMap[u.empresa_consultora_id] ?? "—"}</p>
                  </div>
                  <span className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase ${u.papel === "super" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600"}`}>{u.papel}</span>
                </div>
              ))}
          </div>
          <form onSubmit={criarUsuario} className="card space-y-3 p-4">
            <p className="text-sm font-medium text-gray-700">Novo usuário (libera acesso)</p>
            <input className="inp" type="email" placeholder="E-mail" value={uEmail} onChange={(e) => setUEmail(e.target.value)} required />
            <input className="inp" type="text" placeholder="Nome" value={uNome} onChange={(e) => setUNome(e.target.value)} />
            <input className="inp" type="password" placeholder="Senha inicial" value={uSenha} onChange={(e) => setUSenha(e.target.value)} required />
            <div className="grid grid-cols-2 gap-3">
              <select className="inp" value={uEmpresa} onChange={(e) => setUEmpresa(e.target.value)} required>
                <option value="">Empresa…</option>
                {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
              <select className="inp" value={uPapel} onChange={(e) => setUPapel(e.target.value)}>
                <option value="admin">Admin da empresa</option>
                <option value="membro">Membro</option>
                <option value="super">Super (admin central)</option>
              </select>
            </div>
            <button className="btn-primary w-full" disabled={criando}>{criando ? "Criando…" : "Criar e liberar acesso"}</button>
            <p className="text-xs text-gray-400">Requer SUPABASE_SERVICE_ROLE_KEY no ambiente do servidor.</p>
          </form>
        </div>
      </div>
    </div>
  );
}
