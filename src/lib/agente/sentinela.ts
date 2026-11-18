// =============================================================================
// Sentinela de Obras + sinais gerais (Fase 3). REGRAS FIXAS: só SQL/consultas,
// o Claude não entra aqui (ele só prioriza/redige depois, no Maestro). Roda com
// o cliente admin (service role), SEMPRE filtrando por empresa_consultora_id.
//
// Nesta versão ligamos as regras de STATUS (há dados). As de apontamento/
// atividade ficam para quando a equipe começar a lançar horas (medição: 0 hoje).
// =============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarTodos } from "@/lib/supabase/buscarTodos";

export type Achado = {
  chave: string; // idempotência (vira automacao_chave)
  nivel: "alto" | "medio" | "info";
  titulo: string;
  detalhe: string;
  os_id?: string | null;
  responsavel_id?: string | null; // quem cobrar (reação verde)
  escalar: boolean; // passou do prazo → sobe para a gerência
};

const ATIVAS = ["a_fazer", "em_andamento", "pausada"];
const hoje = () => new Date().toISOString().slice(0, 10);
const diasEntre = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : 0);
const num = (p: Record<string, string>, k: string, d: number) => Number(p[k] ?? d) || d;

export async function acharOS(admin: SupabaseClient, empresaId: string, prem: Record<string, string>): Promise<Achado[]> {
  const { data: oss } = await admin
    .from("ordens_servico")
    .select("id,numero,titulo,status,responsavel_id,prazo,status_desde,titulo_receber_id,data_realizado")
    .eq("empresa_consultora_id", empresaId);
  const lista = oss ?? [];
  const achados: Achado[] = [];
  const diasCobra = num(prem, "dias_pausada_cobra", 3);
  const diasEscala = num(prem, "dias_pausada_escala", 7);
  const diasRisco = num(prem, "dias_prazo_risco", 3);
  const diasNaoFat = num(prem, "dias_concluida_nao_faturada", 3);
  const hojeStr = hoje();
  const limiteRisco = new Date(Date.now() + diasRisco * 86400000).toISOString().slice(0, 10);

  for (const o of lista as any[]) {
    const rot = [o.numero, o.titulo].filter(Boolean).join(" · ");
    const ativa = ATIVAS.includes(o.status);

    if (ativa && !o.responsavel_id) {
      achados.push({ chave: `sentinela:sem_resp:${o.id}`, nivel: "alto", titulo: "OS sem responsável", detalhe: `${rot} está ativa sem responsável.`, os_id: o.id, escalar: true });
    }
    if (o.status === "pausada") {
      const d = diasEntre(o.status_desde);
      if (d >= diasCobra) {
        achados.push({ chave: `sentinela:pausada:${o.id}`, nivel: d >= diasEscala ? "alto" : "medio", titulo: "OS pausada", detalhe: `${rot} pausada há ${Math.floor(d)} dias.`, os_id: o.id, responsavel_id: o.responsavel_id, escalar: d >= diasEscala });
      }
    }
    if (ativa && o.prazo && o.prazo < hojeStr) {
      achados.push({ chave: `sentinela:prazo_vencido:${o.id}`, nivel: "alto", titulo: "Prazo vencido", detalhe: `${rot} com prazo vencido (${o.prazo}) e ainda aberta.`, os_id: o.id, responsavel_id: o.responsavel_id, escalar: true });
    } else if (ativa && o.prazo && o.prazo >= hojeStr && o.prazo <= limiteRisco) {
      achados.push({ chave: `sentinela:prazo_risco:${o.id}`, nivel: "medio", titulo: "Prazo próximo", detalhe: `${rot} vence em ${o.prazo}.`, os_id: o.id, responsavel_id: o.responsavel_id, escalar: false });
    }
    if (o.status === "concluido" && !o.titulo_receber_id && diasEntre(o.data_realizado ? o.data_realizado + "T00:00:00Z" : null) >= diasNaoFat) {
      achados.push({ chave: `sentinela:nao_faturada:${o.id}`, nivel: "medio", titulo: "Concluída não faturada", detalhe: `${rot} concluída e ainda não faturada.`, os_id: o.id, escalar: false });
    }
  }
  return achados;
}

// Sinais gerais para o briefing (contagens; o Maestro decide o que entra no top-5)
export async function sinaisGerais(admin: SupabaseClient, empresaId: string): Promise<string[]> {
  const sinais: string[] = [];
  const h = hoje();
  const seteDias = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const tit = await admin.from("titulos_financeiros").select("id", { count: "exact", head: true }).eq("empresa_consultora_id", empresaId).eq("status", "aberto").lt("vencimento", h);
  if ((tit.count ?? 0) > 0) sinais.push(`${tit.count} título(s) vencido(s) em aberto.`);

  const req = await admin.from("requisicoes_compra").select("id", { count: "exact", head: true }).eq("empresa_consultora_id", empresaId).eq("status", "aberta").lt("data", seteDias);
  if ((req.count ?? 0) > 0) sinais.push(`${req.count} requisição(ões) aberta(s) há mais de 7 dias.`);

  // estoque abaixo do mínimo (produtos com mínimo definido)
  const { data: prods } = await buscarTodos(admin.from("produtos").select("id,estoque_minimo").eq("empresa_consultora_id", empresaId).eq("ativo", true).gt("estoque_minimo", 0), "id");
  if (prods && prods.length) {
    const ids = prods.map((p: any) => p.id);
    const { data: sal } = await buscarTodos(admin.from("saldos_estoque").select("id,produto_id,quantidade").in("produto_id", ids), "id");
    const soma: Record<string, number> = {};
    for (const s of sal ?? []) soma[(s as any).produto_id] = (soma[(s as any).produto_id] ?? 0) + Number((s as any).quantidade);
    const abaixo = prods.filter((p: any) => (soma[p.id] ?? 0) < Number(p.estoque_minimo)).length;
    if (abaixo > 0) sinais.push(`${abaixo} item(ns) de estoque abaixo do mínimo.`);
  }
  return sinais;
}
