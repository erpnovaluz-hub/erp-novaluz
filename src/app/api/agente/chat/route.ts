import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { conversar, MODELO_PADRAO } from "@/lib/agente/claude";
import { calcDono } from "@/lib/agente/donos";
import type { Contexto } from "@/lib/agente/tipos";

// GET: recarrega uma conversa (texto + cartões ainda pendentes) para a tela
// não começar vazia ao recarregar. Confere que a conversa é do próprio usuário.
export async function GET(req: Request) {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const conversaId = new URL(req.url).searchParams.get("conversa_id");
  if (!conversaId) return NextResponse.json({ error: "Falta conversa_id." }, { status: 400 });

  const admin = createAdminClient();
  const { data: conv } = await admin
    .from("agente_conversas")
    .select("id,usuario_id")
    .eq("id", conversaId)
    .maybeSingle();
  if (!conv || conv.usuario_id !== user.id) {
    return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
  }

  const { data: msgs } = await admin
    .from("agente_mensagens")
    .select("papel,conteudo")
    .eq("conversa_id", conversaId)
    .in("papel", ["user", "assistant"])
    .order("criado_em", { ascending: true });

  const { data: pend } = await admin
    .from("acoes_agente")
    .select("id,ferramenta,faixa,justificativa,parametros")
    .eq("conversa_id", conversaId)
    .eq("status", "pendente")
    .order("criado_em", { ascending: true });

  const valorDe = (p: any): number | null =>
    typeof p?.custo_estimado === "number" ? p.custo_estimado : typeof p?.custo_unitario === "number" ? p.custo_unitario : null;

  return NextResponse.json({
    conversa_id: conversaId,
    mensagens: (msgs ?? []).filter((m) => m.conteudo).map((m) => ({ papel: m.papel, texto: m.conteudo })),
    pendentes: (pend ?? []).map((a) => ({
      id: a.id,
      ferramenta: a.ferramenta,
      faixa: a.faixa,
      status: "pendente",
      resumo: a.justificativa ?? a.ferramenta,
      parametros: a.parametros,
      valor: valorDe(a.parametros),
      reversivel: false,
    })),
  });
}

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

  // Quem está logado + em qual empresa. Para o super em modo suporte o RLS usa
  // empresa_ativa — então usamos a MESMA aqui, senão o agente misturaria empresas.
  const { data: perfil } = await sb
    .from("perfis")
    .select("nome,papel,empresa_consultora_id,empresa_ativa")
    .eq("id", user.id)
    .maybeSingle();
  const empresaId = (perfil?.papel === "super" && perfil?.empresa_ativa) ? perfil.empresa_ativa : perfil?.empresa_consultora_id;
  if (!empresaId) return NextResponse.json({ error: "Usuário sem empresa." }, { status: 403 });

  // nome da empresa em uso (para o agente saber onde está e não misturar contas)
  const { data: emp } = await sb.from("empresas_consultoras").select("nome").eq("id", empresaId).maybeSingle();
  const empresaNome = emp?.nome || "—";
  const usuario = { id: user.id, nome: perfil?.nome || user.email || "usuário", email: user.email || null, papel: perfil?.papel ?? null };

  const admin = createAdminClient();

  // premissas (modelo + nome + donos) — o usuário lê as da própria empresa
  const { data: prem } = await sb.from("premissas_agente").select("chave,valor").in("chave", ["modelo", "modelo_dono", "nome_assistente", "agente_donos"]);
  const val = (k: string) => prem?.find((x) => x.chave === k)?.valor;
  const nome = val("nome_assistente") || "Assistente";

  // Tiering por login: dono (executa ações, conversa mais profunda) x consulta
  // (só leitura). Dono = e-mail na premissa agente_donos; sem lista, cai no super.
  const ehDono = calcDono(val("agente_donos"), user.email, perfil?.papel);
  const modelo = (ehDono && val("modelo_dono")) || val("modelo") || MODELO_PADRAO;

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

  const ctx: Contexto = { sb, admin, empresaId, usuarioId: user.id, conversaId: conversaId!, podeAgir: ehDono };

  let resultado;
  try {
    resultado = await conversar({ ctx, modelo, nomeAssistente: nome, podeAgir: ehDono, usuario, empresaNome, historico, mensagemUsuario: mensagem });
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
