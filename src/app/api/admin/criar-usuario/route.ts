import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Cria um usuário (auth) e o perfil vinculado a uma empresa. Só super admin.
export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { data: perfil } = await supabase.from("perfis").select("papel").eq("id", user.id).maybeSingle();
  if (perfil?.papel !== "super") return NextResponse.json({ error: "Acesso restrito ao administrador central." }, { status: 403 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  const { email, senha, nome, empresa_id, papel } = body ?? {};
  if (!email || !senha || !empresa_id) return NextResponse.json({ error: "Informe e-mail, senha e empresa." }, { status: 400 });

  let admin;
  try { admin = createAdminClient(); }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }

  const { data: created, error: e1 } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true });
  if (e1) return NextResponse.json({ error: e1.message }, { status: 400 });

  const { error: e2 } = await admin.from("perfis").insert({
    id: created.user.id, empresa_consultora_id: empresa_id, nome: nome || email, papel: papel || "admin", email,
  });
  if (e2) return NextResponse.json({ error: e2.message }, { status: 400 });

  return NextResponse.json({ ok: true, id: created.user.id });
}
