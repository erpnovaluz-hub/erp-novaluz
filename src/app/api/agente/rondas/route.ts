import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rodarRonda } from "@/lib/agente/rondas";
import { rodarRondaFinanceira } from "@/lib/agente/financeiro";

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
  const momento = ["resumo", "financeiro"].includes(body?.momento) ? body.momento : "briefing";

  try {
    const admin = createAdminClient();
    const { data: empresas } = await admin.from("empresas_consultoras").select("id").eq("ativo", true);
    const resultados = [];
    for (const e of empresas ?? []) {
      const empresaId = (e as any).id;
      try {
        const r = momento === "financeiro"
          ? await rodarRondaFinanceira(admin, empresaId)
          : await rodarRonda(admin, empresaId, momento);
        resultados.push({ empresa: empresaId, ...r });
      } catch (err: any) {
        resultados.push({ empresa: empresaId, erro: err?.message ?? String(err) });
      }
    }
    return NextResponse.json({ ok: true, momento, resultados });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
