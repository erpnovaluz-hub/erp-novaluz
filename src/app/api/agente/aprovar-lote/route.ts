import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { executarAmarela } from "@/lib/agente/executor";
import { ehDonoDoAgente } from "@/lib/agente/donos";
import type { Contexto } from "@/lib/agente/tipos";

// Aprovação em lote de ações AMARELAS pendentes (a fila do dia). Cada uma é
// executada sob o RLS do usuário. Ação VERMELHA nunca entra aqui: é recusada,
// garantindo o critério "vermelha nunca entra em aprovar tudo".
export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  // só o dono do agente aprova a fila
  const { data: perfilU } = await sb.from("perfis").select("papel").eq("id", user.id).maybeSingle();
  if (!(await ehDonoDoAgente(sb, user.email, perfilU?.papel))) {
    return NextResponse.json({ error: "Só o administrador do assistente aprova a fila." }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  const ids: string[] = Array.isArray(body?.acao_ids) ? body.acao_ids.map(String) : [];
  if (ids.length === 0) return NextResponse.json({ error: "Informe acao_ids." }, { status: 400 });

  const admin = createAdminClient();
  const resultados: { id: string; status: string; erro?: string }[] = [];

  for (const id of ids) {
    const { data: acao } = await sb.from("acoes_agente").select("*").eq("id", id).maybeSingle();
    if (!acao) {
      resultados.push({ id, status: "nao_encontrada" });
      continue;
    }
    if (acao.faixa !== "amarela") {
      // trava dura: vermelha (ou qualquer outra) jamais é executada em lote
      resultados.push({ id, status: "recusada", erro: "Ação não-amarela não entra em aprovação em lote." });
      continue;
    }
    if (acao.status !== "pendente") {
      resultados.push({ id, status: acao.status });
      continue;
    }
    const ctx: Contexto = { sb, admin, empresaId: acao.empresa_consultora_id, usuarioId: user.id, conversaId: acao.conversa_id, podeAgir: true, podeTarefas: true };
    const r = await executarAmarela({ id, ferramenta: acao.ferramenta, parametros: acao.parametros }, ctx);
    if (!r.ok) {
      resultados.push({ id, status: "falhou", erro: r.erro });
      continue;
    }
    await admin
      .from("acoes_agente")
      .update({ status: "executada", resultado: r.acao?.resultado ?? null, vinculo_id: r.acao?.vinculo_id ?? acao.vinculo_id, decidido_por: user.id, decidido_em: new Date().toISOString() })
      .eq("id", id);
    resultados.push({ id, status: "executada" });
  }

  return NextResponse.json({ ok: true, resultados });
}
