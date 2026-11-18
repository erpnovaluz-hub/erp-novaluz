// =============================================================================
// Análise financeira do CFO Digital (F0). REGRAS FIXAS: só consultas/cálculo;
// o Claude não entra aqui (só redige o resumo depois). Funciona com QUALQUER
// cliente: no chat recebe ctx.sb (JWT do usuário → RLS decide quem vê caixa);
// na ronda recebe o admin (service role) filtrando empresa na mão.
//
// NUNCA move dinheiro. Baixa/transferência/pagamento são fase vermelha (humano).
// =============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { buscarTodos } from "@/lib/supabase/buscarTodos";
import { MODELO_PADRAO } from "./claude";

const hoje = () => new Date().toISOString().slice(0, 10);
const emDias = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export type Indicadores = {
  caixa_total: number;
  a_receber_aberto: number;
  a_pagar_aberto: number;
  vencidos_receber: number;
  vencidos_pagar: number;
  receber_30d: number;
  pagar_30d: number;
  projecao_30d: number;
  caixa_livre: number;
  burn_mensal: number;
  runway_meses: number | null;
  inadimplencia_pct: number | null;
  liquidez: number | null;
};

// Raio-x do caixa por empresa. Títulos e movimentações podem passar de 1.000
// linhas → buscarTodos() pagina (Supabase corta em 1.000 sem erro).
export async function indicadoresFinanceiros(db: SupabaseClient, empresaId: string): Promise<Indicadores> {
  const h = hoje();
  const em30 = emDias(30);

  const { data: contas } = await db.from("contas_bancarias").select("saldo_atual").eq("empresa_consultora_id", empresaId);
  const caixa_total = (contas ?? []).reduce((s, c: any) => s + Number(c.saldo_atual || 0), 0);

  const { data: tit } = await buscarTodos(
    db.from("titulos_financeiros").select("tipo,valor,vencimento,status").eq("empresa_consultora_id", empresaId).eq("status", "aberto"),
    "id",
  );
  let a_receber_aberto = 0, a_pagar_aberto = 0, vencidos_receber = 0, vencidos_pagar = 0, receber_30d = 0, pagar_30d = 0;
  for (const t of (tit ?? []) as any[]) {
    const v = Number(t.valor || 0);
    const venc = t.vencimento as string | null;
    const vencido = !!venc && venc < h;
    const em30d = !!venc && venc >= h && venc <= em30;
    if (t.tipo === "receber") {
      a_receber_aberto += v;
      if (vencido) vencidos_receber += v;
      if (em30d) receber_30d += v;
    } else {
      a_pagar_aberto += v;
      if (vencido) vencidos_pagar += v;
      if (em30d) pagar_30d += v;
    }
  }

  // burn mensal = média das saídas (débito) dos últimos 90 dias
  const desde90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const { data: mov } = await buscarTodos(
    db.from("movimentacoes_caixa").select("tipo,valor").eq("empresa_consultora_id", empresaId).gte("data", desde90),
    "id",
  );
  const saidas90 = (mov ?? []).reduce((s, m: any) => s + (m.tipo === "debito" ? Number(m.valor || 0) : 0), 0);
  const burn_mensal = saidas90 / 3;

  return {
    caixa_total,
    a_receber_aberto,
    a_pagar_aberto,
    vencidos_receber,
    vencidos_pagar,
    receber_30d,
    pagar_30d,
    projecao_30d: caixa_total + receber_30d - pagar_30d,
    caixa_livre: caixa_total - vencidos_pagar - pagar_30d,
    burn_mensal,
    runway_meses: burn_mensal > 0 ? caixa_total / burn_mensal : null,
    inadimplencia_pct: a_receber_aberto > 0 ? (vencidos_receber / a_receber_aberto) * 100 : null,
    liquidez: a_pagar_aberto > 0 ? (caixa_total + a_receber_aberto) / a_pagar_aberto : null,
  };
}

export type AchadoFin = { chave: string; nivel: "alto" | "medio" | "info"; titulo: string; detalhe: string };

// Checagens de compliance de dado (o que distorce DRE/fluxo ou cheira a erro).
export async function checagensFinanceiras(db: SupabaseClient, empresaId: string): Promise<AchadoFin[]> {
  const achados: AchadoFin[] = [];
  const { data: tit } = await buscarTodos(
    db.from("titulos_financeiros").select("id,tipo,valor,vencimento,categoria_id,fornecedor_id").eq("empresa_consultora_id", empresaId).eq("status", "aberto"),
    "id",
  );
  const lista = (tit ?? []) as any[];

  const semCat = lista.filter((t) => !t.categoria_id).length;
  if (semCat > 0) achados.push({ chave: "fin:sem_categoria", nivel: "medio", titulo: "Títulos sem categoria", detalhe: `${semCat} título(s) aberto(s) sem categoria — distorcem o DRE.` });

  const semVenc = lista.filter((t) => !t.vencimento).length;
  if (semVenc > 0) achados.push({ chave: "fin:sem_vencimento", nivel: "medio", titulo: "Títulos sem vencimento", detalhe: `${semVenc} título(s) aberto(s) sem data de vencimento — ficam fora do fluxo.` });

  // possível duplicidade: contas a pagar com mesmo fornecedor + valor + vencimento
  const mapa = new Map<string, number>();
  for (const t of lista) {
    if (t.tipo === "pagar" && t.fornecedor_id && t.vencimento) {
      const k = `${t.fornecedor_id}|${Number(t.valor)}|${t.vencimento}`;
      mapa.set(k, (mapa.get(k) ?? 0) + 1);
    }
  }
  const dup = [...mapa.values()].filter((n) => n > 1).length;
  if (dup > 0) achados.push({ chave: "fin:duplicidade", nivel: "alto", titulo: "Possível duplicidade a pagar", detalhe: `${dup} grupo(s) de contas a pagar com mesmo fornecedor, valor e vencimento.` });

  return achados;
}

// ==== F3 · Projeções e crescimento (leitura) =================================

export type Ajustes = {
  atraso_receber_dias?: number;    // empurra os recebíveis em N dias (atraso)
  corte_receber_pct?: number;      // haircut nos recebíveis (inadimplência extra)
  custo_fixo_novo_mensal?: number; // novo custo fixo por mês
  investimento_pontual?: number;   // CAPEX único (saída agora)
};
export type Projecao = { caixa_hoje: number; saldo_30: number; saldo_60: number; saldo_90: number };

// Projeção do saldo em 30/60/90 dias: caixa + títulos em aberto por janela de
// vencimento. Com 'aj', vira cenário "e se" (atraso, corte, novo custo, CAPEX).
export async function projecaoCaixa(db: SupabaseClient, empresaId: string, aj: Ajustes = {}): Promise<Projecao> {
  const { data: contas } = await db.from("contas_bancarias").select("saldo_atual").eq("empresa_consultora_id", empresaId);
  const caixa = (contas ?? []).reduce((s, c: any) => s + Number(c.saldo_atual || 0), 0);
  const { data: tit } = await buscarTodos(
    db.from("titulos_financeiros").select("tipo,valor,vencimento").eq("empresa_consultora_id", empresaId).eq("status", "aberto").not("vencimento", "is", null),
    "id",
  );

  const atraso = Math.max(0, Number(aj.atraso_receber_dias || 0));
  const corte = Math.min(100, Math.max(0, Number(aj.corte_receber_pct || 0))) / 100;
  const novoCusto = Math.max(0, Number(aj.custo_fixo_novo_mensal || 0));
  const capex = Math.max(0, Number(aj.investimento_pontual || 0));

  const lim = (dias: number) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);
  const l30 = lim(30), l60 = lim(60), l90 = lim(90);
  const addDias = (iso: string, d: number) => new Date(new Date(iso).getTime() + d * 86400000).toISOString().slice(0, 10);

  let r30 = 0, r60 = 0, r90 = 0, p30 = 0, p60 = 0, p90 = 0;
  for (const t of (tit ?? []) as any[]) {
    const v = Number(t.valor || 0);
    if (t.tipo === "receber") {
      const venc = atraso ? addDias(t.vencimento, atraso) : t.vencimento;
      const vv = v * (1 - corte);
      if (venc <= l30) r30 += vv;
      if (venc <= l60) r60 += vv;
      if (venc <= l90) r90 += vv;
    } else {
      if (t.vencimento <= l30) p30 += v;
      if (t.vencimento <= l60) p60 += v;
      if (t.vencimento <= l90) p90 += v;
    }
  }
  return {
    caixa_hoje: caixa,
    saldo_30: caixa + r30 - p30 - novoCusto * 1 - capex,
    saldo_60: caixa + r60 - p60 - novoCusto * 2 - capex,
    saldo_90: caixa + r90 - p90 - novoCusto * 3 - capex,
  };
}

export type MesFluxo = { mes: string; entradas: number; saidas: number; liquido: number };

// Tendência: entradas/saídas realizadas (pagas) mês a mês, para ver trajetória.
export async function tendenciaFinanceira(db: SupabaseClient, empresaId: string, meses = 6): Promise<MesFluxo[]> {
  const primeiroDiaMes = new Date().toISOString().slice(0, 8) + "01";
  const { data } = await db
    .from("vw_fluxo_mensal")
    .select("mes,entradas,saidas")
    .eq("empresa_consultora_id", empresaId)
    .lte("mes", primeiroDiaMes)
    .order("mes", { ascending: false })
    .limit(meses);
  return (data ?? [])
    .map((m: any) => ({ mes: m.mes, entradas: Number(m.entradas || 0), saidas: Number(m.saidas || 0), liquido: Number(m.entradas || 0) - Number(m.saidas || 0) }))
    .reverse();
}

// Resumo financeiro semanal (reaproveita a infra de rondas). Só entrega texto
// aos admins; não cria nada e não mexe em dinheiro. Admin = service role.
export async function rodarRondaFinanceira(admin: SupabaseClient, empresaId: string) {
  const { data: premRows } = await admin.from("premissas_agente").select("chave,valor").eq("empresa_consultora_id", empresaId);
  const prem: Record<string, string> = {};
  for (const r of premRows ?? []) prem[(r as any).chave] = (r as any).valor;
  if ((prem["resumo_financeiro_ativo"] ?? "true") !== "true") return { pulada: true };

  const modelo = prem["modelo"] || MODELO_PADRAO;
  const nome = prem["nome_assistente"] || "Assistente";
  const mesesAlerta = Number(prem["meses_runway_alerta"] ?? 3) || 3;

  const ind = await indicadoresFinanceiros(admin, empresaId);
  const checks = await checagensFinanceiras(admin, empresaId);
  const proj = await projecaoCaixa(admin, empresaId);

  const { data: ag } = await admin.from("perfis").select("id").eq("empresa_consultora_id", empresaId).eq("papel", "agente").eq("ativo", true).maybeSingle();
  const agenteId = ag?.id ?? null;

  const texto = await redigirFinanceiro(modelo, nome, ind, checks, proj, mesesAlerta);

  if (texto) {
    const { data: admins } = await admin.from("perfis").select("id").eq("empresa_consultora_id", empresaId).eq("papel", "admin").eq("ativo", true);
    for (const a of admins ?? []) {
      await admin.from("notificacoes").insert({
        empresa_consultora_id: empresaId, destinatario_id: (a as any).id, ator_id: agenteId, tipo: "agente", texto: texto.slice(0, 280),
      });
    }
  }

  await admin.from("agente_execucoes").insert({
    empresa_consultora_id: empresaId, agente: "maestro", origem: "ronda", ferramentas_chamadas: ["financeiro"],
  });

  return { pulada: false, indicadores: ind, checagens: checks.length };
}

async function redigirFinanceiro(modelo: string, nome: string, ind: Indicadores, checks: AchadoFin[], proj: Projecao, mesesAlerta: number): Promise<string> {
  const linhas = [
    `Caixa atual: ${brl(ind.caixa_total)}`,
    `A receber em aberto: ${brl(ind.a_receber_aberto)} (vencido: ${brl(ind.vencidos_receber)})`,
    `A pagar em aberto: ${brl(ind.a_pagar_aberto)} (vencido: ${brl(ind.vencidos_pagar)})`,
    `Projeção de caixa em 30 dias: ${brl(ind.projecao_30d)}`,
    `Projeção de caixa em 90 dias: ${brl(proj.saldo_90)}`,
    ind.runway_meses != null ? `Runway: ${ind.runway_meses.toFixed(1)} meses (queima ~${brl(ind.burn_mensal)}/mês)` : "Runway: sem saídas recentes para estimar",
    ind.inadimplencia_pct != null ? `Inadimplência (a receber vencido): ${ind.inadimplencia_pct.toFixed(0)}%` : null,
    ind.liquidez != null ? `Liquidez (caixa+receber)/pagar: ${ind.liquidez.toFixed(2)}` : null,
    ...checks.map((c) => `[${c.nivel}] ${c.titulo}: ${c.detalhe}`),
  ].filter(Boolean) as string[];

  const client = new Anthropic();
  const sistema = [
    `Você é ${nome}, o CFO digital da Novaluz. Você INFORMA e SUGERE; não decide e não move dinheiro.`,
    "Escreva um resumo financeiro curto em português: comece por uma frase sobre a saúde do caixa, depois até 5 pontos (riscos e oportunidades), um por linha.",
    `Se o runway for menor que ${mesesAlerta} meses, destaque como ALERTA. Use só os números fornecidos — não invente. Não dê conselho de investimento; fale só do próprio negócio.`,
  ].join("\n");
  try {
    const resp = await client.messages.create({ model: modelo, max_tokens: 1024, system: sistema, messages: [{ role: "user", content: linhas.join("\n") }] });
    return resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim() || linhas.join("\n");
  } catch {
    return "Resumo financeiro:\n" + linhas.join("\n");
  }
}
