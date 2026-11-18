import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { carregarAcesso } from "@/lib/acessoServidor";
import { getEmpresaAtiva } from "@/lib/empresaAtiva";

// Gerência cria logins do próprio time, edita nome/e-mail e redefine senhas.
// Papel/ativo são alterados direto pelo app (RLS + trigger proteger_perfil).
const PAPEIS_PERMITIDOS = ["admin", "almoxarifado", "logistica"];

async function exigirGerencia() {
  const acesso = await carregarAcesso();
  if (!acesso.perfil) return { erro: NextResponse.json({ error: "Não autenticado." }, { status: 401 }) };
  if (!acesso.gerencia) return { erro: NextResponse.json({ error: "Somente a gerência gerencia usuários." }, { status: 403 }) };
  const empresa = await getEmpresaAtiva();
  if (!empresa.id) return { erro: NextResponse.json({ error: "Sem empresa ativa." }, { status: 400 }) };
  let admin;
  try { admin = createAdminClient(); }
  catch (e: any) { return { erro: NextResponse.json({ error: e.message }, { status: 500 }) }; }
  return { empresaId: empresa.id, admin };
}

// cria usuário na empresa da gerência
export async function POST(req: Request) {
  const g = await exigirGerencia();
  if ("erro" in g) return g.erro;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  const email = String(body?.email ?? "").trim().toLowerCase();
  const senha = String(body?.senha ?? "");
  const nome = String(body?.nome ?? "").trim();
  const papel = String(body?.papel ?? "");
  if (!email || !senha) return NextResponse.json({ error: "Informe e-mail e senha." }, { status: 400 });
  if (senha.length < 6) return NextResponse.json({ error: "A senha precisa de pelo menos 6 caracteres." }, { status: 400 });
  if (!PAPEIS_PERMITIDOS.includes(papel)) return NextResponse.json({ error: "Perfil inválido." }, { status: 400 });

  const { data: created, error: e1 } = await g.admin.auth.admin.createUser({ email, password: senha, email_confirm: true });
  if (e1) return NextResponse.json({ error: e1.message }, { status: 400 });

  const { error: e2 } = await g.admin.from("perfis").insert({
    id: created.user.id, empresa_consultora_id: g.empresaId, nome: nome || email, papel, email,
  });
  if (e2) {
    await g.admin.auth.admin.deleteUser(created.user.id);   // não deixa login órfão
    return NextResponse.json({ error: e2.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: created.user.id });
}

// edita alguém do time: senha, nome e/ou e-mail de login
export async function PATCH(req: Request) {
  const g = await exigirGerencia();
  if ("erro" in g) return g.erro;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  const id = String(body?.id ?? "");
  const senha = body?.senha != null ? String(body.senha) : null;
  const nome = body?.nome != null ? String(body.nome).trim() : null;
  const email = body?.email != null ? String(body.email).trim().toLowerCase() : null;
  if (!id) return NextResponse.json({ error: "Informe o usuário." }, { status: 400 });
  if (senha == null && nome == null && email == null) return NextResponse.json({ error: "Nada para alterar." }, { status: 400 });
  if (senha != null && senha.length < 6) return NextResponse.json({ error: "A senha precisa de pelo menos 6 caracteres." }, { status: 400 });
  if (nome != null && !nome) return NextResponse.json({ error: "O nome não pode ficar vazio." }, { status: 400 });
  if (email != null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });

  const { data: alvo } = await g.admin.from("perfis").select("empresa_consultora_id, papel, email").eq("id", id).maybeSingle();
  if (!alvo || alvo.empresa_consultora_id !== g.empresaId || alvo.papel === "super") {
    return NextResponse.json({ error: "Usuário não pertence à sua empresa." }, { status: 403 });
  }

  const mudaEmail = email != null && email !== (alvo.email ?? "").toLowerCase();
  if (senha != null || mudaEmail) {
    const { error } = await g.admin.auth.admin.updateUserById(id, {
      ...(senha != null ? { password: senha } : {}),
      ...(mudaEmail ? { email, email_confirm: true } : {}),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (nome != null || mudaEmail) {
    const { error } = await g.admin.from("perfis").update({
      ...(nome != null ? { nome } : {}),
      ...(mudaEmail ? { email } : {}),
    }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
