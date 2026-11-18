import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { conversar, MODELO_PADRAO } from "@/lib/agente/claude";
import type { Contexto } from "@/lib/agente/tipos";

// Chat do Assistente. Roda com a identidade de quem conversa (RLS = trava).
// O cliente admin só grava log/histórico (tabelas agente_* sem policy de escrita).
export async function POST(req: Request) {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  const mensagem = String(body?.mensagem ?? "").trim();
  if (!mensagem) return NextResponse.json({ error: "Escreva uma mensagem." }, { status: 400 });

  // empresa do usuário (perfil). Observação: para o super em modo suporte,
  // auth_empresa_id() usaria empresa_ativa; aqui usamos a empresa do perfil.
  const { data: perfil } = await sb
    .from("perfis")
    .select("empresa_consultora_id")
    .eq("id", user.id)
    .maybeSingle();
  const empresaId = perfil?.empresa_consultora_id;
  if (!empresaId) return NextResponse.json({ error: "Usuário sem empresa." }, { status: 403 });

  const admin = createAdminClient();

  // premissas (modelo + nome) — o usuário lê as da própria empresa
  const { data: prem } = await sb.from("premissas_agente").select("chave,valor").in("chave", ["modelo", "nome_assistente"]);
  const modelo = prem?.find((x) => x.chave === "modelo")?.valor || MODELO_PADRAO;
  const nome = prem?.find((x) => x.chave === "nome_assistente")?.valor || "Assistente";

  // conversa (nova ou existente)
  let conversaId = String(body?.conversa_id ?? "") || null;
  if (!conversaId) {
    const { data: c, error } = await admin
      .from("agente_conversas")
      .insert({ empresa_consultora_id: empresaId, usuario_id: user.id, titulo: mensagem.slice(0, 60) })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    conversaId = c.id;
  }

  // histórico (só texto de user/assistant) ANTES de gravar a mensagem atual
  const { data: hist } = await admin
    .from("agente_mensagens")
    .select("papel,conteudo")
    .eq("conversa_id", conversaId)
    .in("papel", ["user", "assistant"])
    .order("criado_em", { ascending: false })
    .limit(20);
  // vêm do mais novo p/ o mais antigo; invertemos p/ ordem cronológica no prompt
  const historico = [...(hist ?? [])].reverse()
    .filter((m) => m.conteudo)
    .map((m) => ({ role: m.papel as "user" | "assistant", content: m.conteudo as string }));

  // grava a mensagem do usuário
  await admin.from("agente_mensagens").insert({
    empresa_consultora_id: empresaId,
    conversa_id: conversaId,
    papel: "user",
    conteudo: mensagem,
  });

  const ctx: Contexto = { sb, admin, empresaId, usuarioId: user.id, conversaId: conversaId! };

  let resultado;
  try {
    resultado = await conversar({ ctx, modelo, nomeAssistente: nome, historico, mensagemUsuario: mensagem });
  } catch (e: any) {
    await admin.from("agente_execucoes").insert({
      empresa_consultora_id: empresaId, agente: "chat", origem: "chat", usuario_id: user.id,
      conversa_id: conversaId, erro: e?.message ?? String(e),
    });
    return NextResponse.json({ error: "Falha ao falar com o modelo: " + (e?.message ?? String(e)) }, { status: 502 });
  }

  // grava resposta + log de execução
  await admin.from("agente_mensagens").insert({
    empresa_consultora_id: empresaId, conversa_id: conversaId, papel: "assistant", conteudo: resultado.texto,
  });
  await admin.from("agente_conversas").update({ atualizado_em: new Date().toISOString() }).eq("id", conversaId);
  await admin.from("agente_execucoes").insert({
    empresa_consultora_id: empresaId, agente: "chat", origem: "chat", usuario_id: user.id, conversa_id: conversaId,
    ferramentas_chamadas: resultado.ferramentas, tokens_entrada: resultado.uso.entrada, tokens_saida: resultado.uso.saida,
  });

  return NextResponse.json({
    conversa_id: conversaId,
    resposta: resultado.texto,
    acoes: resultado.acoes,
  });
}
