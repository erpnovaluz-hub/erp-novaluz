// Cálculo da folha: adiantamento (dia 15) + fechamento (último dia do mês).
// Valor da hora = salário ÷ 220. Extra dia útil = 63% (×1,63). Domingo = 100% (×2,0).

export const DIVISOR_HORA = 220;
export const FATOR_EXTRA_UTIL = 1.63;    // hora + 63%
export const FATOR_EXTRA_DOMINGO = 2.0;  // hora + 100%

export type FolhaInput = {
  salario: number;
  pctAdiantamento: number;   // ex.: 40
  heUtilHoras: number;       // qtd horas extras em dia útil
  heDomingoHoras: number;    // qtd horas extras em domingo/feriado
  descHoras: number;         // qtd horas descontadas
  descValor: number;         // outros descontos (R$)
  bonificacao: number;
  adicional: number;
  abonoFamilia: number;
  beneficios: number;        // soma dos benefícios (VT/VR/...)
};

export type FolhaCalc = {
  valorHora: number;
  extraUtil: number;
  extraDomingo: number;
  totalExtras: number;
  descontoHoras: number;
  totalDescontos: number;
  adiantamento: number;   // dia 15
  fechamento: number;     // último dia
  totalMes: number;       // adiantamento + fechamento
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function calcularFolha(i: FolhaInput): FolhaCalc {
  const valorHora = i.salario > 0 ? i.salario / DIVISOR_HORA : 0;
  const extraUtil = r2(i.heUtilHoras * valorHora * FATOR_EXTRA_UTIL);
  const extraDomingo = r2(i.heDomingoHoras * valorHora * FATOR_EXTRA_DOMINGO);
  const totalExtras = r2(extraUtil + extraDomingo);
  const descontoHoras = r2(i.descHoras * valorHora);
  const totalDescontos = r2(descontoHoras + i.descValor);
  const adiantamento = r2(i.salario * (i.pctAdiantamento || 0) / 100);
  const totalMes = r2(
    i.salario + totalExtras + i.bonificacao + i.adicional + i.abonoFamilia + i.beneficios - totalDescontos
  );
  const fechamento = r2(totalMes - adiantamento);
  return { valorHora: r2(valorHora), extraUtil, extraDomingo, totalExtras, descontoHoras, totalDescontos, adiantamento, fechamento, totalMes };
}

// último dia do mês da competência (yyyy-mm-01) → yyyy-mm-DD
export function ultimoDiaMes(competencia: string): string {
  const [y, m] = competencia.split("-").map(Number);
  const d = new Date(y, m, 0).getDate(); // dia 0 do mês seguinte = último do atual
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
