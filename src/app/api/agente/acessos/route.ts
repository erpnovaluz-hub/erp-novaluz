import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ehDonoDoAgente } from "@/lib/agente/donos";
import { empresaEmUso, pessoasDaEmpresa } from "@/lib/agente/acessos";

// Grava quem pode lançar pelo chat (premissa agente_lancadores da empresa em
// uso). Só o dono do agente. A premissa é protegida por RLS (0075), por isso a
// escrita é pelo service role — depois de conferir o dono aqui.
export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { data: perfil } = await sb.from("perfis").select("*").eq("id", user.id).maybeSingle();
  if (!(await ehDonoDoAgente(sb, user.email, perfil?.papel))) {
    return NextResponse.json({ error: "Só o administrador do assistente define quem lança." }, { status: 403 });
  }
  const empresaId = empresaEmUso(perfil);
  if (!empresaId) return NextResponse.json({ error: "Usuário sem empresa." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const pedidos: string[] = Array.isArray(body?.emails) ? body.emails.map((e: any) => String(e).toLowerCase().trim()) : [];

  // só aceita e-mails de pessoas ativas DESTA empresa
  const admin = createAdminClient();
  const validos = new Set((await pessoasDaEmpresa(admin, empresaId)).map((p) => (p.email ?? "").toLowerCase()).filter(Boolean));
  const emails = [...new Set(pedidos.filter((e) => validos.has(e)))];

  const { error } = await admin
    .from("premissas_agente")
    .upsert({ empresa_consultora_id: empresaId, chave: "agente_lancadores", valor: emails.join(", ") }, { onConflict: "empresa_consultora_id,chave" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, emails });
}
