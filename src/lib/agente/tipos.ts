// =============================================================================
// Tipos do Funcionário Digital (Fase 1). O chat executa ferramentas com o
// cliente amarrado ao JWT do usuário (RLS = trava real); o cliente admin só
// grava o log/histórico (tabelas agente_* sem policy de escrita).
// =============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";

export type Faixa = "leitura" | "verde" | "amarela" | "vermelha";

export type Contexto = {
  sb: SupabaseClient; // JWT do usuário — executa as ações de negócio sob RLS
  admin: SupabaseClient; // service role — SÓ log/histórico/conversa, nunca ação de negócio
  empresaId: string;
  usuarioId: string;
  conversaId: string;
  podeAgir: boolean; // dono do agente → executa TODAS as ações (determinações)
  podeTarefas: boolean; // gerência (ou dono) → pode criar/manter tarefas e projetos
  podeLancar?: boolean; // lançador autorizado (0075) → cartões de lançamento financeiro
  podeConduzir?: boolean; // Ritmo de Gestão: espelha pode_conduzir() (0070)
  modo?: "geral" | "gestao"; // chat de gestão (Bloco 3)
};

// O que uma ferramenta devolve ao loop + ao resumo "o que eu preenchi".
// Verde: nasce status 'executada' com link + Desfazer.
// Amarela: nasce status 'pendente' (cartão Confirmar/Editar/Cancelar); vira
// 'executada' só depois do clique, via /api/agente/decidir.
export type Acao = {
  id?: string; // id em acoes_agente (para confirmar/desfazer)
  ferramenta: string;
  faixa: Faixa;
  status?: "pendente" | "executada"; // amarela começa pendente
  vinculo_tipo?: string | null;
  vinculo_id?: string | null;
  resumo: string; // texto curto para o usuário
  parametros?: Record<string, any>; // o que será feito (cartão + Editar)
  valor?: number | null; // valor em destaque no cartão, quando houver
  link?: string | null; // link para o registro criado/alterado
  reversivel: boolean;
  resultado?: Record<string, any>; // ids + before-image para desfazer
};

export type ResultadoFerramenta = {
  ok: boolean;
  dados?: any; // devolvido ao modelo (leitura) ou confirmação
  erro?: string;
  acao?: Acao; // presente só em ferramentas que alteram dados (verde+)
};
