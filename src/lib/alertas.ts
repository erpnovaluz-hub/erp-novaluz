// =============================================================================
// Engine de alertas proativos — regras da seção 1.4 do Prompt Mestre.
// Roda no servidor (dashboard). Nunca inventa dado: só sinaliza o que existe.
// =============================================================================
import { createClient } from "@/lib/supabase/server";

export const PARAMS = {
  limite_concentracao_faturamento: 60, // %
  dias_followup_vencido: 7,
  dias_proposta_parada: 15,
  dias_contrato_a_vencer: 30,
  dias_interacao_desatualizada: 60,
  dias_sem_contato_alerta: 30,
};

export type Alerta = {
  nivel: "alto" | "medio" | "info";
  titulo: string;
  detalhe: string;
  fonte: string;
  entidade?: string;
};

function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function diasAtras(dias: number): string {
  return new Date(Date.now() - dias * 86400000).toISOString();
}
function emDias(dias: number): string {
  return new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);
}

export async function coletarAlertas(): Promise<Alerta[]> {
  const supabase = createClient();
  const alertas: Alerta[] = [];
  const hoje = new Date().toISOString().slice(0, 10);

  // 1. Concentração de faturamento -------------------------------------------
  const { data: fat } = await supabase
    .from("faturamento")
    .select("cliente_id, valor_realizado, clientes(nome)");
  if (fat && fat.length) {
    const porCliente = new Map<string, { nome: string; total: number }>();
    let total = 0;
    for (const f of fat as any[]) {
      const v = Number(f.valor_realizado) || 0;
      total += v;
      const nome = f.clientes?.nome ?? "—";
      const prev = porCliente.get(f.cliente_id) ?? { nome, total: 0 };
      prev.total += v;
      porCliente.set(f.cliente_id, prev);
    }
    if (total > 0) {
      let maior = { nome: "", total: 0 };
      porCliente.forEach((c) => {
        if (c.total > maior.total) maior = c;
      });
      const pct = Math.round((maior.total / total) * 100);
      if (pct >= PARAMS.limite_concentracao_faturamento) {
        alertas.push({
          nivel: "alto",
          titulo: "Concentração de faturamento",
          detalhe: `${pct}% do faturamento realizado está em ${maior.nome} (limite: ${PARAMS.limite_concentracao_faturamento}%).`,
          fonte: "faturamento",
          entidade: "faturamento",
        });
      }
    }
  }

  // 2. Propostas paradas (enviadas há > N dias) ------------------------------
  const { data: props } = await supabase
    .from("propostas")
    .select("numero, data, status")
    .eq("status", "enviada")
    .lt("data", diasAtras(PARAMS.dias_proposta_parada).slice(0, 10));
  if (props && props.length) {
    alertas.push({
      nivel: "medio",
      titulo: "Propostas paradas",
      detalhe: `${props.length} proposta(s) enviada(s) há mais de ${PARAMS.dias_proposta_parada} dias sem mudança de status.`,
      fonte: "propostas",
      entidade: "propostas",
    });
  }

  // 3. Contratos recorrentes a vencer ----------------------------------------
  const { data: ctr } = await supabase
    .from("contratos")
    .select("numero, data_fim, tipo, status")
    .eq("tipo", "recorrente")
    .eq("status", "ativo")
    .gte("data_fim", hoje)
    .lte("data_fim", emDias(PARAMS.dias_contrato_a_vencer));
  if (ctr && ctr.length) {
    alertas.push({
      nivel: "medio",
      titulo: "Contratos a renovar",
      detalhe: `${ctr.length} contrato(s) recorrente(s) vencem nos próximos ${PARAMS.dias_contrato_a_vencer} dias sem renovação registrada.`,
      fonte: "contratos",
      entidade: "contratos",
    });
  }

  // 4. Follow-ups vencidos ----------------------------------------------------
  const { data: tarefas } = await supabase
    .from("tarefas_followup")
    .select("descricao, prazo, status")
    .in("status", ["aberta", "em_andamento"])
    .lt("prazo", hoje);
  if (tarefas && tarefas.length) {
    alertas.push({
      nivel: "alto",
      titulo: "Follow-ups vencidos",
      detalhe: `${tarefas.length} tarefa(s) com prazo vencido e ainda em aberto.`,
      fonte: "tarefas_followup",
      entidade: "tarefas_followup",
    });
  }

  // 5. Manutenção recorrente vencida (MSFORT) --------------------------------
  const { data: manut } = await supabase
    .from("manutencao_recorrente")
    .select("equipamento_estrutura, proxima_prevista")
    .lt("proxima_prevista", hoje);
  if (manut && manut.length) {
    alertas.push({
      nivel: "alto",
      titulo: "Manutenção vencida",
      detalhe: `${manut.length} manutenção(ões) com próxima data prevista já ultrapassada.`,
      fonte: "manutencao_recorrente",
      entidade: "manutencao_recorrente",
    });
  }

  // 6. Títulos financeiros vencidos ------------------------------------------
  const { data: titVenc } = await supabase
    .from("titulos_financeiros")
    .select("tipo, valor, vencimento, status")
    .eq("status", "aberto")
    .lt("vencimento", hoje);
  if (titVenc && titVenc.length) {
    const pagar = titVenc.filter((t: any) => t.tipo === "pagar").reduce((s: number, t: any) => s + Number(t.valor), 0);
    const receber = titVenc.filter((t: any) => t.tipo === "receber").reduce((s: number, t: any) => s + Number(t.valor), 0);
    alertas.push({
      nivel: "alto",
      titulo: "Títulos vencidos",
      detalhe: `${titVenc.length} título(s) em aberto e vencido(s) — a pagar ${brl(pagar)}, a receber ${brl(receber)}.`,
      fonte: "titulos_financeiros",
      entidade: "titulos_financeiros",
    });
  }

  // 7. Estoque abaixo do mínimo ----------------------------------------------
  const { data: saldos } = await supabase
    .from("saldos_estoque")
    .select("quantidade, produtos(nome, estoque_minimo)");
  if (saldos && saldos.length) {
    const abaixo = (saldos as any[]).filter(
      (s) => Number(s.produtos?.estoque_minimo ?? 0) > 0 && Number(s.quantidade) < Number(s.produtos.estoque_minimo)
    );
    if (abaixo.length) {
      alertas.push({
        nivel: "medio",
        titulo: "Estoque abaixo do mínimo",
        detalhe: `${abaixo.length} item(ns) com saldo abaixo do estoque mínimo.`,
        fonte: "saldos_estoque",
        entidade: "movimentacoes_estoque",
      });
    }
  }

  // 8. Clientes sem contato recente ------------------------------------------
  const { data: clientes } = await supabase.from("clientes").select("id, nome, status").eq("status", "ativo");
  if (clientes && clientes.length) {
    const { data: inter } = await supabase
      .from("interacoes")
      .select("cliente_id, data")
      .gte("data", diasAtras(PARAMS.dias_sem_contato_alerta));
    const comContato = new Set((inter ?? []).map((i: any) => i.cliente_id));
    const semContato = clientes.filter((c: any) => !comContato.has(c.id));
    if (semContato.length) {
      alertas.push({
        nivel: "medio",
        titulo: "Clientes esfriando",
        detalhe: `${semContato.length} cliente(s) ativo(s) sem interação há mais de ${PARAMS.dias_sem_contato_alerta} dias.`,
        fonte: "interacoes",
        entidade: "clientes",
      });
    }
  }

  return alertas;
}
