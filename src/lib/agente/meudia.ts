// =============================================================================
// "O meu dia" — briefing pessoal (Fase 3+). Toda manhã, cada pessoa ATIVA da
// empresa recebe um resumo SÓ DELA (tarefas e OS sob sua responsabilidade),
// gravado na caixa de entrada (notificacoes) — o gatilho 0050 dispara o push.
//
// O DONO (gestor) recebe, além do próprio dia, uma visão de gestão (fila de
// aprovação, riscos da Sentinela, títulos vencidos), narrada pelo Haiku.
//
// Roda com o cliente admin (service role), SEMPRE filtrando por empresa.
// Idempotente por dia (agente_execucoes agente='meudia'): se já rodou hoje,
// não repete — assim um reenvio do cron não manda dois "bom dia".
// =============================================================================
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { acharOS } from "./sentinela";
import { calcDono } from "./donos";
import { MODELO_PADRAO } from "./claude";

const ATIVAS = ["a_fazer", "em_andamento", "pausada"];
// Data "de hoje" no fuso de Fortaleza (UTC-3), estável a qualquer hora de execução.
const hojeFortaleza = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const primeiroNome = (n: string | null) => (n || "").trim().split(/\s+/)[0] || "você";

type ContTarefas = { total: number; vencidas: number; hoje: number };
type ContOS = { total: number; vencidas: number; pausadas: number };
// Ritmo de Gestão (Bloco 4): só contagens — nunca títulos (reunião pode ser confidencial)
type ContRitmo = { encAtrasados: number; encVencendo: number; atasCiencia: number };

export async function rodarBriefingPessoal(admin: SupabaseClient, empresaId: string) {
  // premissas da empresa
  const { data: premRows } = await admin.from("premissas_agente").select("chave,valor").eq("empresa_consultora_id", empresaId);
  const prem: Record<string, string> = {};
  for (const r of premRows ?? []) prem[(r as any).chave] = (r as any).valor;
  if ((prem["meudia_ativa"] ?? "true") !== "true") return { pulada: true, motivo: "desligado" };

  const hoje = hojeFortaleza();

  // Idempotência diária: já rodou hoje para esta empresa?
  const { count: jaRodou } = await admin.from("agente_execucoes")
    .select("id", { count: "exact", head: true })
    .eq("empresa_consultora_id", empresaId).eq("agente", "meudia").gte("criado_em", hoje + "T00:00:00-03:00");
  if ((jaRodou ?? 0) > 0) return { pulada: true, motivo: "já rodou hoje" };

  const nome = prem["nome_assistente"] || "Assistente";
  const modelo = prem["modelo_dono"] || prem["modelo"] || MODELO_PADRAO;

  // Pessoas ativas (autor dos avisos = o usuário-agente, que não recebe briefing)
  const { data: perfis } = await admin.from("perfis")
    .select("id,nome,papel").eq("empresa_consultora_id", empresaId).eq("ativo", true);
  const agenteId = (perfis ?? []).find((p: any) => p.papel === "agente")?.id ?? null;
  const pessoas = (perfis ?? []).filter((p: any) => p.papel !== "agente");

  // id → e-mail (perfis não guarda e-mail; vem do auth) para o calcDono
  const emailPorId = new Map<string, string>();
  try {
    const { data: lu } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of lu?.users ?? []) if (u.email) emailPorId.set(u.id, u.email);
  } catch {
    /* sem e-mails: calcDono cai no papel 'super' */
  }

  // Sinais de gestão (uma vez por empresa) — para o dono
  const achados = await acharOS(admin, empresaId, prem);
  const riscosAlto = achados.filter((a) => a.nivel === "alto").length;
  const { count: filaPend } = await admin.from("acoes_agente")
    .select("id", { count: "exact", head: true }).eq("empresa_consultora_id", empresaId).eq("status", "pendente");
  const { count: titVenc } = await admin.from("titulos_financeiros")
    .select("id", { count: "exact", head: true }).eq("empresa_consultora_id", empresaId).eq("status", "aberto").lt("vencimento", hoje);

  let enviados = 0;
  for (const p of pessoas as any[]) {
    const t = await contarTarefas(admin, empresaId, p.id, hoje);
    const os = await contarOS(admin, empresaId, p.id, hoje);
    const extras = frasesRitmo(await contarRitmo(admin, empresaId, p.id, hoje));
    const dono = calcDono(prem["agente_donos"], emailPorId.get(p.id) ?? null, p.papel);

    const texto = dono
      ? await briefDono(modelo, nome, primeiroNome(p.nome), t, os, { riscosAlto, filaPend: filaPend ?? 0, titVenc: titVenc ?? 0 }, extras)
      : briefPessoal(primeiroNome(p.nome), t, os, extras);
    if (!texto) continue; // nada para hoje → não enche a pessoa de notificação

    await admin.from("notificacoes").insert({
      empresa_consultora_id: empresaId, destinatario_id: p.id, ator_id: agenteId, tipo: "agente", texto: texto.slice(0, 280),
    });
    enviados++;
  }

  await admin.from("agente_execucoes").insert({
    empresa_consultora_id: empresaId, agente: "meudia", origem: "ronda", ferramentas_chamadas: ["meudia"],
  });

  return { pulada: false, pessoas: pessoas.length, enviados };
}

async function contarTarefas(admin: SupabaseClient, empresaId: string, pid: string, hoje: string): Promise<ContTarefas> {
  const { data } = await admin.from("tarefas")
    .select("prazo").eq("empresa_consultora_id", empresaId).eq("responsavel_id", pid).eq("concluida", false).limit(1000);
  const lista = data ?? [];
  let vencidas = 0, hojeC = 0;
  for (const r of lista as any[]) {
    if (!r.prazo) continue;
    if (r.prazo < hoje) vencidas++;
    else if (r.prazo === hoje) hojeC++;
  }
  return { total: lista.length, vencidas, hoje: hojeC };
}

async function contarOS(admin: SupabaseClient, empresaId: string, pid: string, hoje: string): Promise<ContOS> {
  const { data } = await admin.from("ordens_servico")
    .select("status,prazo").eq("empresa_consultora_id", empresaId).eq("responsavel_id", pid).in("status", ATIVAS).limit(1000);
  const lista = data ?? [];
  let vencidas = 0, pausadas = 0;
  for (const r of lista as any[]) {
    if (r.status === "pausada") pausadas++;
    if (r.prazo && r.prazo < hoje) vencidas++;
  }
  return { total: lista.length, vencidas, pausadas };
}

function frasesTarefasOS(t: ContTarefas, os: ContOS): string[] {
  const partes: string[] = [];
  if (t.total > 0) {
    let s = `${t.total} tarefa${t.total > 1 ? "s" : ""}`;
    const det: string[] = [];
    if (t.vencidas) det.push(`${t.vencidas} atrasada${t.vencidas > 1 ? "s" : ""}`);
    if (t.hoje) det.push(`${t.hoje} vence${t.hoje > 1 ? "m" : ""} hoje`);
    if (det.length) s += ` (${det.join(", ")})`;
    partes.push(s);
  }
  if (os.total > 0) {
    let s = `${os.total} OS`;
    const det: string[] = [];
    if (os.vencidas) det.push(`${os.vencidas} com prazo vencido`);
    if (os.pausadas) det.push(`${os.pausadas} pausada${os.pausadas > 1 ? "s" : ""}`);
    if (det.length) s += ` (${det.join(", ")})`;
    partes.push(s);
  }
  return partes;
}

async function contarRitmo(admin: SupabaseClient, empresaId: string, pid: string, hoje: string): Promise<ContRitmo> {
  const limite = new Date(new Date(hoje + "T12:00:00-03:00").getTime() + 2 * 86400000).toISOString().slice(0, 10);
  const [enc, cien] = await Promise.all([
    admin.from("vw_encaminhamentos").select("status,prazo_efetivo")
      .eq("empresa_consultora_id", empresaId).eq("dono_id", pid).in("status", ["aberto", "atrasado"]).limit(500),
    admin.from("reuniao_participantes").select("reuniao_id, reunioes!inner(status)")
      .eq("empresa_consultora_id", empresaId).eq("perfil_id", pid).eq("presenca", "presente").is("ciencia_em", null)
      .eq("reunioes.status", "realizada").limit(100),
  ]);
  const lista = (enc.data ?? []) as any[];
  return {
    encAtrasados: lista.filter((e) => e.status === "atrasado").length,
    encVencendo: lista.filter((e) => e.status === "aberto" && e.prazo_efetivo && e.prazo_efetivo <= limite).length,
    atasCiencia: (cien.data ?? []).length,
  };
}

function frasesRitmo(r: ContRitmo): string[] {
  const partes: string[] = [];
  const enc = r.encAtrasados + r.encVencendo;
  if (enc > 0) {
    const det: string[] = [];
    if (r.encAtrasados) det.push(`${r.encAtrasados} atrasado${r.encAtrasados > 1 ? "s" : ""}`);
    if (r.encVencendo) det.push(`${r.encVencendo} vence${r.encVencendo > 1 ? "m" : ""} em até 2 dias`);
    partes.push(`${enc} encaminhamento${enc > 1 ? "s" : ""} de reunião (${det.join(", ")})`);
  }
  if (r.atasCiencia > 0) partes.push(`${r.atasCiencia} ata${r.atasCiencia > 1 ? "s" : ""} para dar ciência`);
  return partes;
}

function briefPessoal(nome: string, t: ContTarefas, os: ContOS, extras: string[] = []): string | null {
  const partes = [...frasesTarefasOS(t, os), ...extras];
  if (partes.length === 0) return null;
  return `Bom dia, ${nome}! Hoje: ${partes.join(" · ")}.`;
}

async function briefDono(
  modelo: string, nomeAssist: string, nome: string,
  t: ContTarefas, os: ContOS,
  g: { riscosAlto: number; filaPend: number; titVenc: number },
  extras: string[] = [],
): Promise<string | null> {
  const meu = [...frasesTarefasOS(t, os), ...extras];
  const gestao: string[] = [];
  if (g.filaPend > 0) gestao.push(`${g.filaPend} ação(ões) esperando sua aprovação na fila`);
  if (g.riscosAlto > 0) gestao.push(`${g.riscosAlto} risco(s) alto(s) em OS`);
  if (g.titVenc > 0) gestao.push(`${g.titVenc} título(s) vencido(s) em aberto`);
  if (meu.length === 0 && gestao.length === 0) return null;

  const fatos = [
    meu.length ? `Seu dia: ${meu.join(" · ")}.` : "Sem tarefas ou OS suas para hoje.",
    gestao.length ? `Gestão: ${gestao.join("; ")}.` : "Sem pendências de gestão.",
  ].join(" ");

  const client = new Anthropic();
  const sistema = [
    `Você é ${nomeAssist}, o assistente de gestão da Novaluz, falando com ${nome}, que administra o negócio.`,
    "Escreva um bom-dia curto e direto (no máximo 3 frases, até 280 caracteres), em português.",
    `Comece com "Bom dia, ${nome}!". Destaque PRIMEIRO o que exige decisão dele (aprovações, riscos, dinheiro), depois o dia dele.`,
    "Use só os fatos fornecidos — não invente números nem itens. Não dê conselho de investimento.",
  ].join("\n");
  try {
    const resp = await client.messages.create({ model: modelo, max_tokens: 400, system: sistema, messages: [{ role: "user", content: fatos }] });
    const txt = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join(" ").trim();
    return txt || `Bom dia, ${nome}! ${fatos}`;
  } catch {
    return `Bom dia, ${nome}! ${fatos}`;
  }
}
