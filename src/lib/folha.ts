// Cálculo da folha: adiantamento (dia 15) + fechamento (último dia do mês).
// Valor da hora = salário ÷ 220. Extra dia útil = 63% (×1,63). Domingo = 100% (×2,0).

export const DIVISOR_HORA = 220;
export const DIVISOR_DIA = 30;           // valor do dia = salário ÷ 30 (para faltas)
export const FATOR_EXTRA_UTIL = 1.63;    // hora + 63% (padrão)
export const FATOR_EXTRA_DOMINGO = 2.0;  // hora + 100%
export const PCT_EXTRA_UTIL_PADRAO = 63; // adicional de hora extra em dia útil (50 ou 63)

export type FolhaInput = {
  salario: number;
  pctAdiantamento: number;   // ex.: 40
  heUtilHoras: number;       // qtd horas extras em dia útil
  heUtilPct?: number;        // adicional do dia útil (50 ou 63); default 63
  heDomingoHoras: number;    // qtd horas extras em domingo/feriado
  faltas: number;            // qtd de dias de falta (injustificada)
  descHoras: number;         // qtd horas descontadas
  descValor: number;         // outros descontos (R$)
  bonificacao: number;
  adicional: number;
  abonoFamilia: number;
  beneficios: number;        // soma dos benefícios (VT/VR/...)
  dsrDias: number;           // nº de DSRs perdidos (1 por semana com falta injustificada)
};

export type FolhaCalc = {
  valorHora: number;
  valorDia: number;
  dsrDias: number;        // DSRs perdidos
  extraUtil: number;
  extraDomingo: number;
  totalExtras: number;
  descontoFaltas: number;
  descontoDSR: number;    // reflexo da falta no DSR
  descontoHoras: number;
  totalDescontos: number;
  adiantamento: number;   // dia 15 (líquido = % do salário)
  // camadas do fechamento (fim do mês), acumuladas — para pagar em dias diferentes:
  salario60: number;              // parte do salário do fechamento (100% − adiantamento)
  fechSoSalario: number;          // 1) só saldo de salário: salario60 − descontos
  fechSalarioExtras: number;      // 2) + horas extras e proventos (bonif/adic/abono)
  fechamento: number;             // 3) + benefícios (= fechamento total do fim do mês)
  totalMes: number;       // adiantamento + fechamento
};

// Decompõe o pagamento do fim do mês em camadas acumuladas.
export function camadasFechamento(x: {
  salario: number; adiantamento: number; descontos: number; horasExtras: number;
  bonificacao: number; adicional: number; abonoFamilia: number; beneficios: number;
}) {
  const salario60 = Math.round((x.salario - x.adiantamento) * 100) / 100;
  const fechSoSalario = Math.round((salario60 - x.descontos) * 100) / 100;
  const fechSalarioExtras = Math.round((fechSoSalario + x.horasExtras + x.bonificacao + x.adicional + x.abonoFamilia) * 100) / 100;
  const fechamento = Math.round((fechSalarioExtras + x.beneficios) * 100) / 100;
  return { salario60, fechSoSalario, fechSalarioExtras, fechamento };
}

// dias do mês e nº de domingos, a partir da competência (yyyy-mm-01)
export function calendarioMes(competencia: string): { diasMes: number; domingos: number } {
  const [y, m] = competencia.split("-").map(Number);
  const diasMes = new Date(y, m, 0).getDate();
  let domingos = 0;
  for (let d = 1; d <= diasMes; d++) if (new Date(y, m - 1, d).getDay() === 0) domingos++;
  return { diasMes, domingos };
}

// ===== Apontamento diário (ponto) =====
export type PontoStatus = "presente" | "falta" | "atestado" | "feriado" | "folga";
export type Ponto = Record<string, PontoStatus>; // "yyyy-mm-dd" -> status

const chaveDia = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// padrão: seg–sex presente, sáb/dom folga (igual à planilha; ajustável no calendário)
export function pontoPadrao(competencia: string): Ponto {
  const [y, m] = competencia.split("-").map(Number);
  const diasMes = new Date(y, m, 0).getDate();
  const p: Ponto = {};
  for (let d = 1; d <= diasMes; d++) {
    const dow = new Date(y, m - 1, d).getDay();
    p[chaveDia(y, m, d)] = dow === 0 || dow === 6 ? "folga" : "presente";
  }
  return p;
}

// DSRs perdidos = nº de semanas (seg–dom) distintas que contêm pelo menos uma falta.
// Assim, 2 faltas na mesma semana perdem só 1 DSR (regra da Lei 605/49).
export function contarDsrPerdidos(ponto: Ponto): number {
  const semanas = new Set<string>();
  for (const [dia, st] of Object.entries(ponto)) {
    if (st !== "falta") continue;
    const d = new Date(dia + "T00:00:00");
    const segunda = new Date(d);
    segunda.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // volta até a segunda-feira
    semanas.add(segunda.toISOString().slice(0, 10));
  }
  return semanas.size;
}

export function contarPonto(ponto: Ponto) {
  let presentes = 0, faltas = 0, atestados = 0, feriados = 0, folgas = 0;
  for (const st of Object.values(ponto)) {
    if (st === "presente") presentes++;
    else if (st === "falta") faltas++;
    else if (st === "atestado") atestados++;
    else if (st === "feriado") feriados++;
    else if (st === "folga") folgas++;
  }
  return { presentes, faltas, atestados, feriados, folgas };
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function calcularFolha(i: FolhaInput): FolhaCalc {
  const valorHora = i.salario > 0 ? i.salario / DIVISOR_HORA : 0;
  const valorDia = i.salario > 0 ? i.salario / DIVISOR_DIA : 0;
  const pctUtil = i.heUtilPct ?? PCT_EXTRA_UTIL_PADRAO;
  const fatorExtraUtil = 1 + pctUtil / 100;   // 50% → ×1,50 · 63% → ×1,63
  const extraUtil = r2(i.heUtilHoras * valorHora * fatorExtraUtil);
  const extraDomingo = r2(i.heDomingoHoras * valorHora * FATOR_EXTRA_DOMINGO);
  const totalExtras = r2(extraUtil + extraDomingo);
  const descontoFaltas = r2(i.faltas * valorDia);
  // DSR: cada semana com falta injustificada perde 1 repouso = 1 diária (salário ÷ 30)
  const descontoDSR = r2((i.dsrDias || 0) * valorDia);
  const descontoHoras = r2(i.descHoras * valorHora);
  const totalDescontos = r2(descontoFaltas + descontoDSR + descontoHoras + i.descValor);
  const adiantamento = r2(i.salario * (i.pctAdiantamento || 0) / 100);
  const totalMes = r2(
    i.salario + totalExtras + i.bonificacao + i.adicional + i.abonoFamilia + i.beneficios - totalDescontos
  );
  const cam = camadasFechamento({
    salario: i.salario, adiantamento, descontos: totalDescontos, horasExtras: totalExtras,
    bonificacao: i.bonificacao, adicional: i.adicional, abonoFamilia: i.abonoFamilia, beneficios: i.beneficios,
  });
  return {
    valorHora: r2(valorHora), valorDia: r2(valorDia), dsrDias: i.dsrDias || 0,
    extraUtil, extraDomingo, totalExtras, descontoFaltas, descontoDSR, descontoHoras, totalDescontos,
    adiantamento, salario60: cam.salario60, fechSoSalario: cam.fechSoSalario,
    fechSalarioExtras: cam.fechSalarioExtras, fechamento: cam.fechamento, totalMes,
  };
}

// último dia do mês da competência (yyyy-mm-01) → yyyy-mm-DD
export function ultimoDiaMes(competencia: string): string {
  const [y, m] = competencia.split("-").map(Number);
  const d = new Date(y, m, 0).getDate(); // dia 0 do mês seguinte = último do atual
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
