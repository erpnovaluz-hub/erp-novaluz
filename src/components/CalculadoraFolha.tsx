"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/format";
import { calcularFolha, calendarioMes, ultimoDiaMes, pontoPadrao, contarPonto, type Ponto, type PontoStatus } from "@/lib/folha";

type Colab = { id: string; nome: string; cargo: string | null; salario_base: number | null };
type Tipo = { id: string; nome: string; modo: "diario" | "fixo" };

const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const MESES_LONGO = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];
const CATEGORIA_FOLHA = "Despesas com pessoal (folha/encargos)";
const num = (v: string | number | null | undefined) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  return isNaN(n) ? 0 : n;
};

export default function CalculadoraFolha() {
  const supabase = useMemo(() => createClient(), []);
  const hoje = new Date();

  const [ano, setAno] = useState(String(hoje.getFullYear()));
  const [mes, setMes] = useState(String(hoje.getMonth() + 1).padStart(2, "0"));
  const [colaboradorId, setColaboradorId] = useState("");

  // pré-seleção via query (?colab=&mes=&ano=) — lida só no cliente
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("ano")) setAno(p.get("ano")!);
    if (p.get("mes")) setMes(p.get("mes")!);
    if (p.get("colab")) setColaboradorId(p.get("colab")!);
  }, []);

  const [colabs, setColabs] = useState<Colab[]>([]);
  const [tipos, setTipos] = useState<Tipo[]>([]);

  // campos editáveis
  const [salario, setSalario] = useState("");
  const [pct, setPct] = useState("40");
  const [beneficios, setBeneficios] = useState<Record<string, string>>({});
  const [heUtil, setHeUtil] = useState("");
  const [heDomingo, setHeDomingo] = useState("");
  const [ponto, setPonto] = useState<Ponto>({});
  const [descHoras, setDescHoras] = useState("");
  const [descValor, setDescValor] = useState("");
  const [bonificacao, setBonificacao] = useState("");
  const [adicional, setAdicional] = useState("");
  const [abono, setAbono] = useState("");
  const [observacao, setObservacao] = useState("");

  // ids do lançamento carregado
  const [lancId, setLancId] = useState<string | null>(null);
  const [tituloAdiantId, setTituloAdiantId] = useState<string | null>(null);
  const [tituloFechId, setTituloFechId] = useState<string | null>(null);

  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const competencia = `${ano}-${mes}-01`;
  const anos = useMemo(() => Array.from({ length: 6 }, (_, i) => String(hoje.getFullYear() - 3 + i)), [hoje]);

  // refs (colaboradores + tipos de benefício)
  useEffect(() => {
    (async () => {
      const [c, t] = await Promise.all([
        supabase.from("colaboradores").select("id, nome, cargo, salario_base").eq("ativo", true).order("nome").range(0, 4999),
        supabase.from("folha_tipos_beneficio").select("id, nome, modo").eq("ativo", true).order("ordem").range(0, 999),
      ]);
      setColabs(c.data ?? []);
      setTipos(t.data ?? []);
      if (!colaboradorId && c.data && c.data.length) setColaboradorId(c.data[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  const colab = useMemo(() => colabs.find((c) => c.id === colaboradorId), [colabs, colaboradorId]);

  // carrega lançamento existente ou zera
  const carregar = useCallback(async () => {
    if (!colaboradorId) return;
    setCarregando(true); setErro(null); setMsg(null);
    const { data: lancs } = await supabase
      .from("folha_lancamentos").select("*").eq("colaborador_id", colaboradorId).eq("competencia", competencia).limit(1);
    const l = lancs && lancs[0];

    let bens: Record<string, string> = Object.fromEntries(tipos.map((t) => [t.id, ""]));
    if (l) {
      const { data: bs } = await supabase
        .from("folha_lancamento_beneficios").select("tipo_beneficio_id, valor_base, valor").eq("lancamento_id", l.id);
      // valor_base = o que o usuário digita (por dia ou mensal); cai para valor no histórico antigo
      for (const b of bs ?? []) bens[b.tipo_beneficio_id] = String(b.valor_base ?? b.valor ?? "");
    }

    const c = colabs.find((x) => x.id === colaboradorId);
    setLancId(l?.id ?? null);
    setTituloAdiantId(l?.titulo_adiantamento_id ?? null);
    setTituloFechId(l?.titulo_fechamento_id ?? null);
    setSalario(l ? String(l.salario_liquido ?? "") : (c?.salario_base != null ? String(c.salario_base) : ""));
    setPct(l ? String(l.pct_adiantamento ?? "40") : "40");
    setHeUtil(l ? String(l.he_util_horas ?? "") : "");
    setHeDomingo(l ? String(l.he_domingo_horas ?? "") : "");
    setPonto(l && l.ponto && Object.keys(l.ponto).length ? (l.ponto as Ponto) : pontoPadrao(competencia));
    setDescHoras(l ? String(l.desc_horas ?? "") : "");
    setDescValor(l ? String(l.desc_valor ?? "") : "");
    setBonificacao(l ? String(l.bonificacao ?? "") : "");
    setAdicional(l ? String(l.adicional ?? "") : "");
    setAbono(l ? String(l.abono_familia ?? "") : "");
    setObservacao(l?.observacao ?? "");
    setBeneficios(bens);
    setCarregando(false);
  }, [supabase, colaboradorId, competencia, tipos, colabs]);

  useEffect(() => { carregar(); }, [carregar]);

  const cal = calendarioMes(competencia);
  const cnt = contarPonto(ponto);
  // benefício por dia = valor/dia × dias presentes; fixo = valor mensal
  const beneficioTotal = (t: Tipo) => t.modo === "diario" ? num(beneficios[t.id]) * cnt.presentes : num(beneficios[t.id]);
  const totalBeneficios = tipos.reduce((s, t) => s + beneficioTotal(t), 0);
  const calc = calcularFolha({
    salario: num(salario), pctAdiantamento: num(pct),
    heUtilHoras: num(heUtil), heDomingoHoras: num(heDomingo),
    faltas: cnt.faltas, descHoras: num(descHoras), descValor: num(descValor),
    bonificacao: num(bonificacao), adicional: num(adicional), abonoFamilia: num(abono),
    beneficios: totalBeneficios,
    diasMes: cal.diasMes, domingos: cal.domingos, feriados: cnt.feriados,
  });

  async function salvar(): Promise<boolean> {
    if (!colaboradorId) { setErro("Escolha um colaborador."); return false; }
    setSalvando(true); setErro(null); setMsg(null);
    try {
      const dados = {
        colaborador_id: colaboradorId,
        competencia,
        salario_liquido: num(salario),
        pct_adiantamento: num(pct),
        he_util_horas: num(heUtil),
        he_domingo_horas: num(heDomingo),
        ponto,
        faltas: cnt.faltas,
        feriados: cnt.feriados,
        desc_horas: num(descHoras),
        desc_valor: num(descValor),
        bonificacao: num(bonificacao),
        adicional: num(adicional),
        abono_familia: num(abono),
        horas_extras: calc.totalExtras,   // R$ (para as views)
        descontos: calc.totalDescontos,   // R$ (para as views)
        observacao: observacao || null,
      };
      let id = lancId;
      if (id) {
        const { error } = await supabase.from("folha_lancamentos").update(dados).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("folha_lancamentos").insert(dados).select("id").single();
        if (error) throw error;
        id = data.id; setLancId(id);
      }
      await supabase.from("folha_lancamento_beneficios").delete().eq("lancamento_id", id);
      const bens = tipos.filter((t) => num(beneficios[t.id]) !== 0)
        .map((t) => ({ lancamento_id: id, tipo_beneficio_id: t.id, valor_base: num(beneficios[t.id]), valor: beneficioTotal(t) }));
      if (bens.length) {
        const { error } = await supabase.from("folha_lancamento_beneficios").insert(bens);
        if (error) throw error;
      }
      setMsg("Lançamento salvo na folha.");
      return true;
    } catch (e: any) {
      setErro(e.message ?? "Erro ao salvar."); return false;
    } finally { setSalvando(false); }
  }

  async function categoriaFolhaId(): Promise<string | null> {
    const { data } = await supabase.from("categorias_financeiras").select("id").eq("nome", CATEGORIA_FOLHA).limit(1);
    if (data && data.length) return data[0].id;
    const { data: novo } = await supabase.from("categorias_financeiras")
      .insert({ nome: CATEGORIA_FOLHA, natureza: "despesa", grupo_dre: "despesa_operacional", ordem: 40 }).select("id").single();
    return novo?.id ?? null;
  }

  async function gerarTitulos() {
    if (!confirm(`Gerar/atualizar as 2 contas a pagar de ${colab?.nome} — ${MESES[+mes - 1]}/${ano}?\n• Adiantamento (vence dia 15)\n• Fechamento (vence no último dia do mês)`)) return;
    setGerando(true); setErro(null); setMsg(null);
    const ok = await salvar();
    if (!ok) { setGerando(false); return; }
    try {
      const catId = await categoriaFolhaId();
      const rotulo = `${MESES_LONGO[+mes - 1]}/${ano}`;
      const vencAdiant = `${ano}-${mes}-15`;
      const vencFech = ultimoDiaMes(competencia);

      // adiantamento
      await upsertTitulo({
        atualId: tituloAdiantId,
        setId: setTituloAdiantId,
        campoLanc: "titulo_adiantamento_id",
        descricao: `Adiantamento ${rotulo} — ${colab?.nome}`,
        valor: calc.adiantamento,
        vencimento: vencAdiant,
        catId,
      });
      // fechamento
      await upsertTitulo({
        atualId: tituloFechId,
        setId: setTituloFechId,
        campoLanc: "titulo_fechamento_id",
        descricao: `Folha (fechamento) ${rotulo} — ${colab?.nome}`,
        valor: calc.fechamento,
        vencimento: vencFech,
        catId,
      });
      setMsg("Contas a pagar geradas: adiantamento (dia 15) e fechamento (último dia). Veja em Financeiro › Contas a Pagar.");
    } catch (e: any) {
      setErro(e.message ?? "Erro ao gerar contas a pagar.");
    } finally { setGerando(false); }
  }

  async function upsertTitulo(o: {
    atualId: string | null; setId: (v: string) => void; campoLanc: string;
    descricao: string; valor: number; vencimento: string; catId: string | null;
  }) {
    const base = {
      tipo: "pagar", descricao: o.descricao, valor: o.valor, categoria_id: o.catId,
      competencia, vencimento: o.vencimento, origem: "folha", referencia_id: colaboradorId,
    };
    if (o.atualId) {
      const { error } = await supabase.from("titulos_financeiros")
        .update({ descricao: o.descricao, valor: o.valor, categoria_id: o.catId, competencia, vencimento: o.vencimento })
        .eq("id", o.atualId).eq("status", "aberto");
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from("titulos_financeiros")
        .insert({ ...base, status: "aberto" }).select("id").single();
      if (error) throw error;
      await supabase.from("folha_lancamentos").update({ [o.campoLanc]: data.id }).eq("id", lancId);
      o.setId(data.id);
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">🧮 Calculadora da folha</h1>
        <div className="flex items-center gap-2">
          <select className="inp !w-auto py-1.5" value={colaboradorId} onChange={(e) => setColaboradorId(e.target.value)}>
            {colabs.length === 0 && <option value="">Nenhum colaborador ativo</option>}
            {colabs.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <select className="inp !w-auto py-1.5" value={mes} onChange={(e) => setMes(e.target.value)}>
            {MESES.map((mn, i) => <option key={i} value={String(i + 1).padStart(2, "0")}>{mn}</option>)}
          </select>
          <select className="inp !w-auto py-1.5" value={ano} onChange={(e) => setAno(e.target.value)}>
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      {msg && <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{msg}</div>}
      {erro && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      <div className="grid gap-4 lg:grid-cols-5">
        {/* ENTRADAS */}
        <div className="card space-y-4 p-4 lg:col-span-3">
          <Secao titulo="Salário e adiantamento">
            <Campo label="Salário base (R$)"><Inp valor={salario} onChange={setSalario} /></Campo>
            <Campo label="Adiantamento (%)" dica="dia 15"><Inp valor={pct} onChange={setPct} /></Campo>
          </Secao>

          {tipos.length > 0 && (
            <Secao titulo="Benefícios (fechamento)">
              {tipos.map((t) => (
                <Campo key={t.id} label={t.nome} dica={t.modo === "diario" ? "R$/dia" : "R$/mês"}>
                  <Inp valor={beneficios[t.id] ?? ""} onChange={(v) => setBeneficios((o) => ({ ...o, [t.id]: v }))} />
                  {t.modo === "diario" && num(beneficios[t.id]) > 0 && (
                    <span className="mt-0.5 block text-right text-[11px] text-gray-400">× {cnt.presentes}d = {formatCurrency(beneficioTotal(t))}</span>
                  )}
                </Campo>
              ))}
            </Secao>
          )}

          <Secao titulo="Horas extras">
            <Campo label="Horas dia útil" dica="63%"><Inp valor={heUtil} onChange={setHeUtil} /></Campo>
            <Campo label="Horas domingo/feriado" dica="100%"><Inp valor={heDomingo} onChange={setHeDomingo} /></Campo>
          </Secao>

          <Secao titulo="Bonificação / adicionais">
            <Campo label="Bonificação/produção (R$)"><Inp valor={bonificacao} onChange={setBonificacao} /></Campo>
            <Campo label="Adicional (R$)"><Inp valor={adicional} onChange={setAdicional} /></Campo>
            <Campo label="Abono família (R$)"><Inp valor={abono} onChange={setAbono} /></Campo>
          </Secao>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Apontamento do mês</h3>
            <CalendarioPonto competencia={competencia} ponto={ponto} setPonto={setPonto} contagem={cnt} />
          </div>

          <Secao titulo="Outros descontos">
            <Campo label="Horas descontadas"><Inp valor={descHoras} onChange={setDescHoras} /></Campo>
            <Campo label="Outros descontos (R$)"><Inp valor={descValor} onChange={setDescValor} /></Campo>
          </Secao>

          <div>
            <label className="mb-1 block text-xs text-gray-500">Observação</label>
            <input className="inp" value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="opcional" />
          </div>
        </div>

        {/* RESULTADO */}
        <div className="lg:col-span-2">
          <div className="card sticky top-4 p-4">
            <p className="text-xs uppercase tracking-wide text-gray-400">{colab?.nome ?? "—"}{colab?.cargo ? ` · ${colab.cargo}` : ""}</p>
            <p className="mb-3 text-sm text-gray-500">Competência {MESES[+mes - 1]}/{ano}</p>

            <Linha label="Valor da hora" valor={calc.valorHora} sub="salário ÷ 220" />
            <Linha label="Extra dia útil (63%)" valor={calc.extraUtil} />
            <Linha label="Extra domingo (100%)" valor={calc.extraDomingo} />
            <Linha label="Total horas extras" valor={calc.totalExtras} forte />
            <div className="my-2 border-t border-gray-100" />
            <Linha label={`Benefícios (${cnt.presentes}d)`} valor={totalBeneficios} />
            <Linha label="Bonif./adicional/abono" valor={num(bonificacao) + num(adicional) + num(abono)} />
            {cnt.faltas > 0 && <Linha label={`Faltas (${cnt.faltas}d)`} valor={-calc.descontoFaltas} negativo />}
            {calc.descontoDSR > 0 && <Linha label="DSR sobre faltas" valor={-calc.descontoDSR} negativo sub={`${calc.repousos} rep. ÷ ${calc.diasUteis} úteis`} />}
            <Linha label="Total descontos" valor={-calc.totalDescontos} negativo />
            <div className="my-2 border-t border-gray-100" />
            <div className="mb-2 rounded-lg bg-amber-50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-amber-800">Adiantamento · dia 15</span>
                <span className="text-lg font-bold tabular-nums text-amber-900">{formatCurrency(calc.adiantamento)}</span>
              </div>
              <p className="text-xs text-amber-700/80">{pct || 0}% do salário</p>
            </div>
            <div className="mb-3 rounded-lg bg-blue-50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-blue-800">Fechamento · último dia</span>
                <span className="text-lg font-bold tabular-nums text-blue-900">{formatCurrency(calc.fechamento)}</span>
              </div>
              <p className="text-xs text-blue-700/80">restante + extras + benefícios − descontos</p>
            </div>
            <div className="mb-4 flex items-center justify-between rounded-lg bg-brand-600 p-3 text-white">
              <span className="text-sm font-medium">Total do mês</span>
              <span className="text-xl font-bold tabular-nums">{formatCurrency(calc.totalMes)}</span>
            </div>

            <div className="flex flex-col gap-2">
              <button className="btn-ghost" onClick={salvar} disabled={salvando || carregando || !colaboradorId}>
                {salvando ? "Salvando…" : "💾 Salvar na folha"}
              </button>
              <button className="btn-primary" onClick={gerarTitulos} disabled={gerando || carregando || !colaboradorId}>
                {gerando ? "Gerando…" : "➡️ Gerar 2 contas a pagar"}
              </button>
              {(tituloAdiantId || tituloFechId) && (
                <p className="text-center text-xs text-green-600">✓ títulos já gerados para este mês</p>
              )}
              {colaboradorId && (
                <a href={`/rh/demonstrativo?colab=${colaboradorId}&mes=${mes}&ano=${ano}`}
                  className="text-center text-sm text-brand-600 hover:underline">📄 Ver demonstrativo (contracheque)</a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{titulo}</h3>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </div>
  );
}
function Campo({ label, dica, children }: { label: string; dica?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-gray-600">{label}{dica && <span className="ml-1 text-gray-400">({dica})</span>}</span>
      {children}
    </label>
  );
}
function Inp({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  return (
    <input type="number" step="0.01" inputMode="decimal"
      className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-right tabular-nums focus:border-brand-400 focus:outline-none"
      value={valor} onChange={(e) => onChange(e.target.value)} placeholder="0,00" />
  );
}
function Linha({ label, valor, sub, forte, negativo }: { label: string; valor: number; sub?: string; forte?: boolean; negativo?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-sm">
      <span className={forte ? "font-medium text-gray-800" : "text-gray-500"}>{label}{sub && <span className="ml-1 text-xs text-gray-400">{sub}</span>}</span>
      <span className={`tabular-nums ${forte ? "font-semibold text-gray-900" : negativo ? "text-red-600" : "text-gray-700"}`}>{formatCurrency(valor)}</span>
    </div>
  );
}

const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const ORDEM_PONTO: PontoStatus[] = ["presente", "falta", "atestado", "feriado", "folga"];
const ESTILO_PONTO: Record<PontoStatus, string> = {
  presente: "bg-green-50 border-green-200 text-green-700",
  falta: "bg-red-100 border-red-300 text-red-700",
  atestado: "bg-amber-100 border-amber-300 text-amber-700",
  feriado: "bg-purple-100 border-purple-300 text-purple-700",
  folga: "bg-gray-100 border-gray-200 text-gray-400",
};
const ROTULO_PONTO: Record<PontoStatus, string> = { presente: "", falta: "Falta", atestado: "Atest.", feriado: "Fer.", folga: "Folga" };

function CalendarioPonto({
  competencia, ponto, setPonto, contagem,
}: {
  competencia: string; ponto: Ponto; setPonto: (p: Ponto) => void;
  contagem: { presentes: number; faltas: number; atestados: number; feriados: number; folgas: number };
}) {
  const [y, m] = competencia.split("-").map(Number);
  const diasMes = new Date(y, m, 0).getDate();
  const offset = new Date(y, m - 1, 1).getDay();
  const chave = (d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const status = (d: number): PontoStatus => ponto[chave(d)] ?? (new Date(y, m - 1, d).getDay() === 0 ? "folga" : "presente");

  const ciclar = (d: number) => {
    if (new Date(y, m - 1, d).getDay() === 0) return; // domingo é folga fixa
    const k = chave(d);
    const prox = ORDEM_PONTO[(ORDEM_PONTO.indexOf(status(d)) + 1) % ORDEM_PONTO.length];
    setPonto({ ...ponto, [k]: prox });
  };

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {DOW.map((h) => <div key={h} className="text-[10px] font-medium text-gray-400">{h}</div>)}
        {Array.from({ length: offset }).map((_, i) => <div key={`x${i}`} />)}
        {Array.from({ length: diasMes }, (_, i) => i + 1).map((d) => {
          const s = status(d);
          const domingo = new Date(y, m - 1, d).getDay() === 0;
          return (
            <button key={d} type="button" onClick={() => ciclar(d)} disabled={domingo}
              title={domingo ? "Domingo (folga)" : "Clique para alternar"}
              className={`flex h-11 flex-col items-center justify-center rounded-md border text-xs ${ESTILO_PONTO[s]} ${domingo ? "cursor-default opacity-70" : "hover:ring-2 hover:ring-brand-300"}`}>
              <span className="font-semibold leading-none">{d}</span>
              <span className="mt-0.5 text-[9px] leading-none">{ROTULO_PONTO[s]}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-600">
        <Leg cor="bg-green-100" t={`Presentes ${contagem.presentes}`} />
        <Leg cor="bg-red-200" t={`Faltas ${contagem.faltas}`} />
        <Leg cor="bg-amber-200" t={`Atestado ${contagem.atestados}`} />
        <Leg cor="bg-purple-200" t={`Feriados ${contagem.feriados}`} />
        <Leg cor="bg-gray-200" t={`Folgas ${contagem.folgas}`} />
      </div>
      <p className="mt-1 text-[11px] text-gray-400">
        Clique num dia para alternar: Presente → Falta → Atestado → Feriado → Folga. Domingo é folga fixa. Atestado não desconta.
      </p>
    </div>
  );
}
function Leg({ cor, t }: { cor: string; t: string }) {
  return <span className="flex items-center gap-1"><span className={`inline-block h-2.5 w-2.5 rounded-sm ${cor}`} /> {t}</span>;
}
