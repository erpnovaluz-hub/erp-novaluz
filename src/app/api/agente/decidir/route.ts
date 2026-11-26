import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { executarAmarela, resumoAmarela } from "@/lib/agente/executor";
import { ehDonoDoAgente } from "@/lib/agente/donos";
import { AMARELAS_GESTAO } from "@/lib/agente/gestao";
import { isGerencia } from "@/lib/permissoes";
import type { Contexto } from "@/lib/agente/tipos";

// Decide uma ação amarela proposta: confirmar (executa sob o RLS do usuário),
// editar (ajusta os parâmetros, segue pendente) ou cancelar (rejeita).
export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  // confirmar/editar/cancelar uma proposta é determinação → o dono do agente.
  // Exceção (Ritmo de Gestão): cartões de gestão que a própria pessoa pediu no
  // chat de gestão — o RLS/RPC de cada um continua sendo a trava.
  const { data: perfilU } = await sb.from("perfis").select("*").eq("id", user.id).maybeSingle();
  const ehDono = await ehDonoDoAgente(sb, user.email, perfilU?.papel);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  const acaoId = String(body?.acao_id ?? "");
  const decisao = String(body?.decisao ?? "");
  if (!acaoId || !["confirmar", "editar", "cancelar"].includes(decisao)) {
    return NextResponse.json({ error: "Informe acao_id e decisao (confirmar|editar|cancelar)." }, { status: 400 });
  }

  // RLS: o usuário só enxerga as próprias ações (ou gerência)
  const { data: acao } = await sb.from("acoes_agente").select("*").eq("id", acaoId).maybeSingle();
  if (!acao) return NextResponse.json({ error: "Ação não encontrada." }, { status: 404 });
  // vermelha (baixa/lançamento pago) também passa aqui — sempre um cartão por vez,
  // nunca pelo aprovar-lote — e só o dono decide (cartaoGestao é só amarela).
  if (acao.faixa !== "amarela" && acao.faixa !== "vermelha") return NextResponse.json({ error: "Só propostas (amarela/vermelha) passam por confirmação." }, { status: 400 });
  if (acao.status !== "pendente") return NextResponse.json({ error: `Ação já ${acao.status}.` }, { status: 409 });

  const cartaoGestao = AMARELAS_GESTAO.has(acao.ferramenta) && acao.solicitante_id === user.id;
  if (!ehDono && !cartaoGestao) {
    return NextResponse.json({ error: "Só o administrador do assistente decide ações do assistente." }, { status: 403 });
  }
  const podeConduzir = perfilU?.papel === "super" || (isGerencia(perfilU?.papel) && (perfilU as any)?.conduz_reunioes === true);

  const admin = createAdminClient();
  const empresaId = acao.empresa_consultora_id as string;

  if (decisao === "cancelar") {
    await admin.from("acoes_agente").update({ status: "rejeitada", decidido_por: user.id, decidido_em: new Date().toISOString() }).eq("id", acaoId);
    return NextResponse.json({ ok: true, status: "rejeitada" });
  }

  if (decisao === "editar") {
    const novos = { ...(acao.parametros || {}), ...(body?.parametros || {}) };
    await admin.from("acoes_agente").update({ parametros: novos, justificativa: resumoAmarela(acao.ferramenta, novos) }).eq("id", acaoId);
    return NextResponse.json({ ok: true, status: "pendente", parametros: novos, resumo: resumoAmarela(acao.ferramenta, novos) });
  }

  // confirmar — executa sob o RLS do usuário
  // Confirmar/editar uma ação já proposta por um dono é determinação → podeAgir.
  const ctx: Contexto = cartaoGestao && !ehDono
    ? { sb, admin, empresaId, usuarioId: user.id, conversaId: acao.conversa_id, podeAgir: false, podeTarefas: isGerencia(perfilU?.papel), podeConduzir, modo: "gestao" }
    : { sb, admin, empresaId, usuarioId: user.id, conversaId: acao.conversa_id, podeAgir: true, podeTarefas: true, podeConduzir, modo: "gestao" };
  if (acao.ferramenta === "criar_reuniao" && !podeConduzir) {
    return NextResponse.json({ error: "Criar reunião é de quem conduz reuniões." }, { status: 403 });
  }
  const r = await executarAmarela({ id: acaoId, ferramenta: acao.ferramenta, parametros: acao.parametros }, ctx);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });

  await admin
    .from("acoes_agente")
    .update({
      status: "executada",
      resultado: r.acao?.resultado ?? null,
      vinculo_id: r.acao?.vinculo_id ?? acao.vinculo_id,
      decidido_por: user.id,
      decidido_em: new Date().toISOString(),
    })
    .eq("id", acaoId);

  return NextResponse.json({ ok: true, status: "executada", acao: r.acao });
}
