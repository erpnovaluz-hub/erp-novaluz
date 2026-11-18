import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rodarRonda } from "@/lib/agente/rondas";

// Chamada pelo banco (pg_cron + pg_net) nos horários do briefing/resumo.
// Protegida por segredo (RONDA_WEBHOOK_SECRET), não por login — o middleware
// deixa passar. Roda a ronda para cada empresa ativa.
export async function POST(req: Request) {
  const segredo = process.env.RONDA_WEBHOOK_SECRET?.trim();
  if (!segredo || req.headers.get("x-ronda-secret")?.trim() !== segredo) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const momento = body?.momento === "resumo" ? "resumo" : "briefing";

  try {
    const admin = createAdminClient();
    const { data: empresas } = await admin.from("empresas_consultoras").select("id").eq("ativo", true);
    const resultados = [];
    for (const e of empresas ?? []) {
      try {
        resultados.push({ empresa: (e as any).id, ...(await rodarRonda(admin, (e as any).id, momento)) });
      } catch (err: any) {
        resultados.push({ empresa: (e as any).id, erro: err?.message ?? String(err) });
      }
    }
    return NextResponse.json({ ok: true, momento, resultados });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
