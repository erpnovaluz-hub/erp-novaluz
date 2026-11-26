import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { conversar, MODELO_PADRAO } from "@/lib/agente/claude";
import { calcDono, calcLancador } from "@/lib/agente/donos";
import { isGerencia } from "@/lib/permissoes";
import type { Contexto } from "@/lib/agente/tipos";
import type Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 120; // documentos/comprovantes anexados levam mais tempo

const IMAGENS = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// GET: recarrega uma conversa (texto + cartões ainda pendentes) para a tela
// não começar vazia ao recarregar. Confere que a conversa é do próprio usuário.
export async function GET(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const conversaId = new URL(req.url).searchParams.get("conversa_id");
  if (!conversaId) return NextResponse.json({ error: "Falta conversa_id." }, { status: 400 });

  const admin = createAdminClient();
  const { data: conv } = await admin
    .from("agente_conversas")
    .select("id,usuario_id,modo")
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
    typeof p?.valor === "number" ? p.valor
    : typeof p?.custo_estimado === "number" ? p.custo_estimado : typeof p?.custo_unitario === "number" ? p.custo_unitario : null;

  return NextResponse.json({
    conversa_id: conversaId,
    modo: (conv as any).modo ?? "geral",
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
  const sb = await createClient();
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
  // anexos (boleto, NF, comprovante): já subiram para o bucket "anexos"; aqui
  // chega só o caminho (o corpo da requisição na Vercel é limitado).
  const anexosPedidos: { caminho: string; tipo: string; nome: string }[] = Array.isArray(body?.anexos)
    ? body.anexos.slice(0, 8).map((a: any) => ({ caminho: String(a?.caminho ?? ""), tipo: String(a?.tipo ?? ""), nome: String(a?.nome ?? "anexo").slice(0, 80) }))
    : [];
  const mensagem = String(body?.mensagem ?? "").trim() || (anexosPedidos.length ? "Lance este(s) documento(s)." : "");
  if (!mensagem) return NextResponse.json({ error: "Escreva uma mensagem." }, { status: 400 });
  // chat de gestão (Ritmo de Gestão · Bloco 3): outra persona e outras ferramentas
  const modo: "geral" | "gestao" = body?.modo === "gestao" ? "gestao" : "geral";

  // Quem está logado + em qual empresa. Para o super em modo suporte o RLS usa
  // empresa_ativa — então usamos a MESMA aqui, senão o agente misturaria empresas.
  const { data: perfil } = await sb
    .from("perfis")
    .select("*")
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
  const { data: prem } = await sb.from("premissas_agente").select("chave,valor").in("chave", ["modelo", "modelo_dono", "modelo_gestao", "nome_assistente", "agente_donos", "agente_lancadores"]);
  const val = (k: string) => prem?.find((x) => x.chave === k)?.valor;
  const nome = val("nome_assistente") || "Assistente";

  // Tiering por login: dono (executa ações, conversa mais profunda) x consulta
  // (só leitura). Dono = e-mail na premissa agente_donos; sem lista, cai no super.
  const ehDono = calcDono(val("agente_donos"), user.email, perfil?.papel);
  // Gerência (super/admin) que não é dono pode criar/manter tarefas pelo agente;
  // OS e financeiro continuam determinação do dono.
  const podeTarefas = ehDono || isGerencia(perfil?.papel);
  // Lançador (0075): autorizado pelo dono a lançar no financeiro pelo chat.
  const podeLancar = ehDono || calcLancador(val("agente_lancadores"), user.email);
  // espelha pode_conduzir() (0070): super, ou gerência marcada "Conduz reuniões"
  const podeConduzir = perfil?.papel === "super" || (isGerencia(perfil?.papel) && (perfil as any)?.conduz_reunioes === true);
  const modelo = (modo === "gestao" && val("modelo_gestao")) || (ehDono && val("modelo_dono")) || val("modelo") || MODELO_PADRAO;

  // conversa (nova ou existente)
  let conversaId = String(body?.conversa_id ?? "") || null;
  if (conversaId) {
    // a conversa precisa ser do próprio usuário e do mesmo modo (gestão não mistura com o geral)
    const { data: conv } = await admin.from("agente_conversas").select("usuario_id,modo").eq("id", conversaId).maybeSingle();
    if (!conv || conv.usuario_id !== user.id || ((conv as any).modo ?? "geral") !== modo) conversaId = null;
  }
  if (!conversaId) {
    const { data: c, error } = await admin
      .from("agente_conversas")
      .insert({ empresa_consultora_id: empresaId, usuario_id: user.id, titulo: mensagem.slice(0, 60), modo })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    conversaId = c.id;
  }

  // histórico (só texto de user/assistant) ANTES de gravar a mensagem atual
  const { data: hist } = await admin
    .from("agente_mensagens")
    .select("papel,conteudo,payload")
    .eq("conversa_id", conversaId)
    .in("papel", ["user", "assistant"])
    .order("criado_em", { ascending: false })
    .limit(20);
  // vêm do mais novo p/ o mais antigo; invertemos p/ ordem cronológica no prompt
  const historico = [...(hist ?? [])].reverse()
    .filter((m) => m.conteudo)
    // O histórico guarda só texto; sem a marca abaixo o modelo, na volta seguinte,
    // não vê que consultou dados e passa a "desconfiar" da própria resposta.
    .map((m) => {
      const usadas = (m as any).payload?.ferramentas as string[] | undefined;
      const marca = m.papel === "assistant" && usadas?.length
        ? `[Nesta resposta os dados vieram das ferramentas: ${[...new Set(usadas)].join(", ")}.]\n`
        : "";
      return { role: m.papel as "user" | "assistant", content: marca + (m.conteudo as string) };
    });

  // anexos: só arquivos da própria empresa (1ª pasta do caminho), lidos com o
  // JWT do usuário (policy do bucket). Imagem → bloco image; PDF → document.
  const blocos: Anthropic.ContentBlockParam[] = [];
  const listaAnexos: string[] = [];
  for (const [i, a] of anexosPedidos.entries()) {
    if (!a.caminho.startsWith(`${empresaId}/`)) continue;
    const { data: blob, error } = await sb.storage.from("anexos").download(a.caminho);
    if (error || !blob) { listaAnexos.push(`${i + 1}) ${a.nome} — não consegui abrir`); continue; }
    const tipo = a.tipo || blob.type;
    const b64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
    if (IMAGENS.has(tipo)) blocos.push({ type: "image", source: { type: "base64", media_type: tipo as any, data: b64 } });
    else if (tipo === "application/pdf") blocos.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } });
    else { listaAnexos.push(`${i + 1}) ${a.nome} — formato não suportado (${tipo})`); continue; }
    listaAnexos.push(`${i + 1}) ${a.nome} — anexo_caminho=${a.caminho}`);
  }
  // o texto guarda a lista com os caminhos: nas voltas seguintes o modelo não vê
  // mais a imagem, mas sabe qual anexo_caminho usar ao confirmar/ajustar.
  const textoUsuario = listaAnexos.length ? `${mensagem}\n\n[Anexos, na ordem:\n${listaAnexos.join("\n")}]` : mensagem;
  const conteudoAtual: string | Anthropic.ContentBlockParam[] = blocos.length
    ? [...blocos, { type: "text", text: textoUsuario }]
    : textoUsuario;

  // grava a mensagem do usuário
  await admin.from("agente_mensagens").insert({
    empresa_consultora_id: empresaId,
    conversa_id: conversaId,
    papel: "user",
    conteudo: textoUsuario,
  });

  const ctx: Contexto = { sb, admin, empresaId, usuarioId: user.id, conversaId: conversaId!, podeAgir: ehDono, podeTarefas, podeConduzir, podeLancar, modo };

  let resultado;
  try {
    resultado = await conversar({ ctx, modelo, nomeAssistente: nome, podeAgir: ehDono, podeTarefas, podeConduzir, podeLancar, modo, usuario, empresaNome, historico, mensagemUsuario: conteudoAtual });
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
    payload: resultado.ferramentas.length ? { ferramentas: resultado.ferramentas } : null,
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
