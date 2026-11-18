import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { randomUUID } from "crypto";

// Cria o usuário-agente (papel 'agente') de uma empresa — ou de todas as que
// ainda não têm. Autor das tarefas/avisos das rondas. Só super admin. O agente
// nunca faz login (as rondas usam service role); o usuário existe só para ser
// o dono dos registros e carregar o papel restrito.
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const { data: perfil } = await supabase.from("perfis").select("papel").eq("id", user.id).maybeSingle();
  if (perfil?.papel !== "super") return NextResponse.json({ error: "Acesso restrito ao administrador central." }, { status: 403 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* corpo opcional */
  }
  const alvo = String(body?.empresa_id ?? "");

  let admin;
  try {
    admin = createAdminClient();
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  // empresas-alvo
  const { data: empresas } = alvo
    ? await admin.from("empresas_consultoras").select("id,nome").eq("id", alvo)
    : await admin.from("empresas_consultoras").select("id,nome");
  if (!empresas || empresas.length === 0) return NextResponse.json({ error: "Empresa não encontrada." }, { status: 404 });

  const criados: { empresa: string; perfil_id: string }[] = [];
  for (const emp of empresas) {
    // já tem agente?
    const { data: ja } = await admin.from("perfis").select("id").eq("empresa_consultora_id", emp.id).eq("papel", "agente").maybeSingle();
    if (ja) continue;

    const email = `agente-${emp.id}@assistente.novaluz.local`;
    const senha = randomUUID() + randomUUID(); // aleatória; o agente não faz login
    const { data: created, error: e1 } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true });
    if (e1 || !created?.user) return NextResponse.json({ error: `Falha ao criar auth do agente (${emp.nome}): ${e1?.message}` }, { status: 400 });

    const { error: e2 } = await admin.from("perfis").insert({
      id: created.user.id, empresa_consultora_id: emp.id, nome: "Assistente (IA)", papel: "agente", email, ativo: true,
    });
    if (e2) return NextResponse.json({ error: `Falha ao criar perfil do agente (${emp.nome}): ${e2.message}` }, { status: 400 });
    criados.push({ empresa: emp.nome, perfil_id: created.user.id });
  }

  return NextResponse.json({ ok: true, criados, ja_existiam: empresas.length - criados.length });
}
