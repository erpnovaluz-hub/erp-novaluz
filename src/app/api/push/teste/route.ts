import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enviarParaPerfil } from "@/lib/push";

// "Enviar teste": manda um push para os aparelhos do próprio usuário logado.
export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  try {
    const r = await enviarParaPerfil(createAdminClient(), user.id, {
      title: "🔔 Novaluz", body: "Notificações funcionando neste aparelho.", url: "/tarefas/caixa", tag: "teste",
    });
    if (r.aparelhos === 0) return NextResponse.json({ error: "Nenhum aparelho ativado para o seu usuário." }, { status: 400 });
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
