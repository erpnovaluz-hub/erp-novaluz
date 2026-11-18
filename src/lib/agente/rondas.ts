// =============================================================================
// Rondas (Fase 3): para UMA empresa, roda a Sentinela (regras fixas), cria as
// reações verdes (tarefa + push, idempotentes por automacao_chave) e chama o
// Maestro (Claude só prioriza/redige) para entregar o briefing aos admins.
// Roda com o cliente admin (service role), sempre com empresa_consultora_id
// explícito. Não executa ações amarelas — a fila do dia é aprovada por humano.
// =============================================================================
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { acharOS, sinaisGerais, type Achado } from "./sentinela";
import { MODELO_PADRAO } from "./claude";

const PRIO: Record<string, string> = { alto: "alta", medio: "media", info: "baixa" };

export async function rodarRonda(admin: SupabaseClient, empresaId: string, momento: "briefing" | "resumo") {
  // premissas
  const { data: premRows } = await admin.from("premissas_agente").select("chave,valor").eq("empresa_consultora_id", empresaId);
  const prem: Record<string, string> = {};
  for (const r of premRows ?? []) prem[(r as any).chave] = (r as any).valor;
  if ((prem["ronda_ativa"] ?? "true") !== "true") return { pulada: true };

  const modelo = prem["modelo"] || MODELO_PADRAO;
  const nome = prem["nome_assistente"] || "Assistente";

  // usuário-agente (autor das tarefas/avisos)
  const { data: ag } = await admin.from("perfis").select("id").eq("empresa_consultora_id", empresaId).eq("papel", "agente").eq("ativo", true).maybeSingle();
  const agenteId = ag?.id ?? null;

  const achados = await acharOS(admin, empresaId, prem);

  // reações verdes: uma tarefa por achado, sem duplicar (automacao_chave)
  let criadas = 0;
  for (const a of achados) {
    const { data: ja } = await admin.from("tarefas").select("id").eq("empresa_consultora_id", empresaId).eq("automacao_chave", a.chave).eq("concluida", false).maybeSingle();
    if (ja) continue;
    const { error } = await admin.from("tarefas").insert({
      empresa_consultora_id: empresaId,
      titulo: a.titulo,
      descricao: a.detalhe,
      responsavel_id: a.responsavel_id ?? null,
      criado_por: agenteId,
      prioridade: a.escalar ? "alta" : PRIO[a.nivel] ?? "media",
      vinculo_tipo: a.os_id ? "os" : null,
      vinculo_id: a.os_id ?? null,
      vinculo_rotulo: a.detalhe.slice(0, 80),
      origem: "automacao",
      automacao_chave: a.chave,
    });
    if (!error) criadas++;
  }

  const sinais = await sinaisGerais(admin, empresaId);
  const briefing = await redigirBriefing(modelo, nome, momento, achados, sinais);

  // entrega aos admins (caixa de entrada + push)
  if (briefing) {
    const { data: admins } = await admin.from("perfis").select("id").eq("empresa_consultora_id", empresaId).eq("papel", "admin").eq("ativo", true);
    for (const a of admins ?? []) {
      await admin.from("notificacoes").insert({
        empresa_consultora_id: empresaId, destinatario_id: (a as any).id, ator_id: agenteId, tipo: "agente", texto: briefing.slice(0, 280),
      });
    }
  }

  // log
  await admin.from("agente_execucoes").insert({
    empresa_consultora_id: empresaId, agente: "maestro", origem: "ronda", ferramentas_chamadas: ["sentinela"],
  });

  return { pulada: false, achados: achados.length, tarefas_criadas: criadas, briefing };
}

async function redigirBriefing(modelo: string, nome: string, momento: string, achados: Achado[], sinais: string[]): Promise<string> {
  const itens = [...achados.map((a) => `- [${a.nivel}] ${a.titulo}: ${a.detalhe}`), ...sinais.map((s) => `- [sinal] ${s}`)];
  if (itens.length === 0) return momento === "briefing" ? "Bom dia! Sem alertas operacionais hoje." : "Resumo do dia: sem pendências novas.";

  const client = new Anthropic();
  const sistema = [
    `Você é ${nome}, o Maestro das operações da Novaluz. Você INFORMA e SUGERE, não decide.`,
    "Escreva um briefing curto em português, começando por uma frase-resumo, seguida de NO MÁXIMO 5 prioridades, uma por linha, ordenadas por risco.",
    "Use só os itens fornecidos — não invente nada. Se houver mais de 5, escolha as 5 mais críticas e diga quantas ficaram de fora.",
  ].join("\n");
  const user = `Momento: ${momento}. Itens encontrados hoje:\n${itens.join("\n")}`;
  try {
    const resp = await client.messages.create({ model: modelo, max_tokens: 1024, system: sistema, messages: [{ role: "user", content: user }] });
    return resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim() || itens.slice(0, 5).join("\n");
  } catch {
    // sem Claude (ex.: chave faltando) cai para a lista crua, top-5
    return `${momento === "briefing" ? "Prioridades do dia" : "Resumo do dia"} (${itens.length}):\n` + itens.slice(0, 5).join("\n");
  }
}
