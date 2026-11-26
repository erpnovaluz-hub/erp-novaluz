import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sugerirConta } from "@/lib/financeiro/conciliacao";

export const maxDuration = 120;

// Refaz as sugestões das linhas pendentes de uma conta (ex.: depois de lançar
// títulos à mão, ou de cadastrar um fornecedor).
export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const contaId = String(body?.conta_bancaria_id ?? "");
  if (!contaId) return NextResponse.json({ error: "Falta a conta." }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, sugestoes: await sugerirConta(sb, contaId) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 400 });
  }
}
