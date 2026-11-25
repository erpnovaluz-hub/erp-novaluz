// =============================================================================
// Ritmo de Gestão · Bloco 1 — reuniões, atas e encaminhamentos (migration 0070).
// Spec: docs/ritmo-gestao/bloco1-spec.md
// =============================================================================

export type TipoReuniao = "diaria" | "semanal" | "mensal" | "trimestral" | "extraordinaria";
export type StatusReuniao = "agendada" | "em_andamento" | "realizada" | "cancelada";
export type Presenca = "convidado" | "presente" | "ausente";
export type StatusPauta = "proposto" | "aceito" | "recusado" | "discutido" | "adiado";
export type SituacaoRevisao = "feito" | "nao_feito" | "replanejado" | "cancelado";
export type StatusEnc = "aberto" | "atrasado" | "feito_no_prazo" | "feito_atrasado" | "cancelado";

export type Reuniao = {
  id: string; titulo: string; tipo: TipoReuniao; data_hora: string; duracao_min: number;
  local: string | null; confidencial: boolean; status: StatusReuniao;
  conduzida_por: string | null; anterior_id: string | null;
  ata_fechada_em: string | null; ata_fechada_por: string | null;
  reaberturas: { por: string; em: string; motivo: string }[];
  observacoes: string | null; criado_por: string | null; criado_em: string;
};
export type Participante = { reuniao_id: string; perfil_id: string; presenca: Presenca; ciencia_em: string | null };
export type ItemPauta = {
  id: string; reuniao_id: string; titulo: string; descricao: string | null;
  origem: "manual" | "sugestao" | "pendencia"; status: StatusPauta;
  sugerido_por: string | null; motivo_recusa: string | null; ordem: number;
};
export type Decisao = { id: string; reuniao_id: string; pauta_id: string | null; texto: string; ordem: number };
export type Parte = { o_que: string; responsavel_id: string | null; prazo: string | null };
export type Encaminhamento = {
  id: string; reuniao_id: string; decisao_id: string | null; pauta_id: string | null;
  o_que: string; dono_id: string; prazo: string; evidencia: string; partes: Parte[];
  tarefa_id: string | null; cancelado: boolean; motivo_cancelamento: string | null; ordem: number;
  // vw_encaminhamentos
  reuniao_titulo?: string; reuniao_tipo?: TipoReuniao; reuniao_data?: string; reuniao_confidencial?: boolean;
  reuniao_status?: StatusReuniao; tarefa_concluida?: boolean | null; n_sub?: number; n_sub_ok?: number;
  ultima_situacao?: SituacaoRevisao | null; prazo_efetivo?: string; status?: StatusEnc;
};
export type Revisao = {
  encaminhamento_id: string; reuniao_id: string; situacao: SituacaoRevisao;
  motivo: string | null; novo_prazo: string | null;
};

export const TIPOS: { key: TipoReuniao; label: string; duracao: number; pergunta: string }[] = [
  { key: "semanal", label: "Semanal de operação", duracao: 60, pergunta: "Estamos na direção certa?" },
  { key: "mensal", label: "Mensal de resultados", duracao: 120, pergunta: "Batemos a meta? Por quê?" },
  { key: "trimestral", label: "Trimestral de prioridades", duracao: 240, pergunta: "A prioridade ainda é essa?" },
  { key: "diaria", label: "Diária rápida", duracao: 15, pergunta: "O que trava hoje?" },
  { key: "extraordinaria", label: "Extraordinária", duracao: 60, pergunta: "Qual decisão precisamos tomar?" },
];
export function tipoLabel(t?: string | null) {
  return TIPOS.find((x) => x.key === t)?.label ?? t ?? "";
}

export const STATUS_REUNIAO: Record<StatusReuniao, { label: string; cls: string }> = {
  agendada: { label: "Agendada", cls: "bg-blue-100 text-blue-700" },
  em_andamento: { label: "Em andamento", cls: "bg-amber-100 text-amber-700" },
  realizada: { label: "Ata fechada", cls: "bg-green-100 text-green-700" },
  cancelada: { label: "Cancelada", cls: "bg-gray-200 text-gray-600" },
};

export const STATUS_ENC: Record<StatusEnc, { label: string; cls: string }> = {
  aberto: { label: "Aberto", cls: "bg-blue-100 text-blue-700" },
  atrasado: { label: "Atrasado", cls: "bg-red-100 text-red-700" },
  feito_no_prazo: { label: "Feito no prazo", cls: "bg-green-100 text-green-700" },
  feito_atrasado: { label: "Feito com atraso", cls: "bg-amber-100 text-amber-700" },
  cancelado: { label: "Cancelado", cls: "bg-gray-200 text-gray-600" },
};

export const SITUACOES: { key: SituacaoRevisao; label: string; cls: string }[] = [
  { key: "feito", label: "Feito", cls: "bg-green-600 text-white" },
  { key: "nao_feito", label: "Não feito", cls: "bg-red-600 text-white" },
  { key: "replanejado", label: "Replanejar", cls: "bg-amber-500 text-white" },
  { key: "cancelado", label: "Cancelar", cls: "bg-gray-500 text-white" },
];

// "qua, 02/12 · 08:00"
export function dataHoraCurta(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }) + " · " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
export function dataLonga(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
// valor de <input type="datetime-local"> no fuso do navegador
export function paraInputDataHora(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
