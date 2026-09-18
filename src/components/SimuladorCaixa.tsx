"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/format";
import PrintButton from "@/components/PrintButton";

type Row = Record<string, any>;
type Tipo = "pagar" | "receber";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const emDias = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const inicioMes = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); };
const fimMes = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };

export default function SimuladorCaixa() {
  const supabase = useMemo(() => createClient(), []);
  const hoje = new Date().toISOString().slice(0, 10);

  const [rows, setRows] = useState<Row[]>([]);
  const [contas, setContas] = useState<{ id: string; nome: string; saldo_atual: number }[]>([]);
  const [clientes, setClientes] = useState<Record<string, string>>({});
  const [fornecedores, setFornecedores] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [usarSaldo, setUsarSaldo] = useState(true);
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // montagem de lote
  const [loteAberto, setLoteAberto] = useState(false);
  const [orcamento, setOrcamento] = useState("");
  const [estrategia, setEstrategia] = useState<"urgentes" | "quitar">("urgentes");

  // cenários
  const [cenarios, setCenarios] = useState<Row[]>([]);
  const [nomeCenario, setNomeCenario] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [cenariosOff, setCenariosOff] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    const [t, cb, cli, forn] = await Promise.all([
      supabase.from("titulos_financeiros").select("*").eq("status", "aberto").range(0, 9999),
      supabase.from("contas_bancarias").select("id, nome, saldo_atual").eq("ativo", true).order("nome"),
      supabase.from("clientes").select("id, nome").range(0, 9999),
      supabase.from("fornecedores").select("id, nome").range(0, 9999),
    ]);
    if (t.error) setErro(t.error.message);
    setRows(t.data ?? []);
    setContas((cb.data as any[]) ?? []);
    setClientes(Object.fromEntries(((cli.data as any[]) ?? []).map((c) => [c.id, c.nome])));
    setFornecedores(Object.fromEntries(((forn.data as any[]) ?? []).map((f) => [f.id, f.nome])));
    setCarregando(false);
  }, [supabase]);

  useEffect(() => { carregar(); }, [carregar]);

  const dataDe = (r: Row) => (r.vencimento as string) || hoje;
  const parte = (r: Row) =>
    r.tipo === "receber" ? clientes[r.cliente_id] ?? "" : fornecedores[r.fornecedor_id] ?? "";

  // filtro por intervalo de vencimento (De / Até). Sem vencimento fica de fora quando há intervalo.
  const noIntervalo = useCallback((r: Row) => {
    const v = r.vencimento as string | null;
    if (!de && !ate) return true;
    if (!v) return false;
    if (de && v < de) return false;
    if (ate && v > ate) return false;
    return true;
  }, [de, ate]);
  const visiveis = useMemo(() => rows.filter(noIntervalo), [rows, noIntervalo]);

  // ordena: vencidos primeiro, depois por vencimento crescente
  const ordenar = (a: Row, b: Row) => dataDe(a).localeCompare(dataDe(b));
  const receber = useMemo(() => visiveis.filter((r) => r.tipo === "receber").sort(ordenar), [visiveis]);
  const pagar = useMemo(() => visiveis.filter((r) => r.tipo === "pagar").sort(ordenar), [visiveis]);

  const saldoInicial = usarSaldo ? contas.reduce((s, c) => s + Number(c.saldo_atual || 0), 0) : 0;

  const somaSel = (lista: Row[]) =>
    lista.filter((r) => sel.has(r.id)).reduce((s, r) => s + Number(r.valor || 0), 0);
  const totReceber = somaSel(receber);
  const totPagar = somaSel(pagar);
  const liquido = totReceber - totPagar;
  const projetado = saldoInicial + liquido;

  // ---- linha do tempo (saldo acumulado por data) ----
  const timeline = useMemo(() => {
    const selecionados = visiveis.filter((r) => sel.has(r.id));
    const porData = new Map<string, number>();
    for (const r of selecionados) {
      const d = dataDe(r);
      const delta = (r.tipo === "receber" ? 1 : -1) * Number(r.valor || 0);
      porData.set(d, (porData.get(d) || 0) + delta);
    }
    const datas = Array.from(porData.keys()).sort();
    let acum = saldoInicial;
    const pontos: { data: string; delta: number; saldo: number }[] = [];
    for (const d of datas) {
      acum += porData.get(d)!;
      pontos.push({ data: d, delta: porData.get(d)!, saldo: acum });
    }
    const furo = pontos.find((p) => p.saldo < 0) || null;
    const menor = pontos.length ? Math.min(saldoInicial, ...pontos.map((p) => p.saldo)) : saldoInicial;
    return { pontos, furo, menor };
  }, [visiveis, sel, saldoInicial]);

  // ---- seleção ----
  const toggle = (id: string) =>
    setSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const marcar = (lista: Row[], ids: string[], on: boolean) =>
    setSel((prev) => { const n = new Set(prev); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; });
  const limparTudo = () => setSel(new Set());

  // ---- montagem de lote inteligente ----
  const saldoDisponivel = saldoInicial + totReceber;
  const montarLote = () => {
    const orc = orcamento.trim() === "" ? saldoDisponivel : Number(orcamento.replace(/\./g, "").replace(",", "."));
    if (isNaN(orc)) { setAviso("Informe um valor válido de orçamento."); return; }
    const fila = [...pagar].sort((a, b) =>
      estrategia === "urgentes" ? dataDe(a).localeCompare(dataDe(b)) : Number(a.valor || 0) - Number(b.valor || 0)
    );
    let acc = 0;
    const escolhidos: string[] = [];
    for (const r of fila) {
      const v = Number(r.valor || 0);
      if (acc + v <= orc) { acc += v; escolhidos.push(r.id); }
    }
    // preserva os recebimentos marcados; substitui só a seleção de pagamentos
    const idsPagar = new Set(pagar.map((r) => r.id));
    setSel((prev) => {
      const n = new Set(Array.from(prev).filter((id) => !idsPagar.has(id)));
      escolhidos.forEach((id) => n.add(id));
      return n;
    });
    const sobra = orc - acc;
    setAviso(escolhidos.length === 0
      ? `Nenhum título cabe em ${formatCurrency(orc)}.`
      : `Lote montado: ${escolhidos.length} título(s), ${formatCurrency(acc)} — sobra ${formatCurrency(sobra)} do orçamento.`);
  };

  // ---- cenários ----
  const carregarCenarios = useCallback(async () => {
    const { data, error } = await supabase.from("simulacoes_caixa").select("*").order("criado_em", { ascending: false });
    if (error) { setCenariosOff(true); return; }
    setCenariosOff(false); setCenarios(data ?? []);
  }, [supabase]);
  useEffect(() => { carregarCenarios(); }, [carregarCenarios]);

  const salvarCenario = async () => {
    const nome = nomeCenario.trim();
    if (!nome) { setAviso("Dê um nome ao cenário antes de salvar."); return; }
    if (sel.size === 0) { setAviso("Marque ao menos um título para salvar o cenário."); return; }
    setSalvando(true); setAviso(null);
    const { error } = await supabase.from("simulacoes_caixa").insert({
      nome, usar_saldo: usarSaldo, filtro_de: de || null, filtro_ate: ate || null,
      titulo_ids: Array.from(sel),
    });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    setNomeCenario(""); setAviso(`Cenário "${nome}" salvo.`); carregarCenarios();
  };

  const aplicarCenario = (c: Row) => {
    setUsarSaldo(!!c.usar_saldo);
    setDe(c.filtro_de ?? ""); setAte(c.filtro_ate ?? "");
    setSel(new Set((c.titulo_ids ?? []) as string[]));
    setAviso(`Cenário "${c.nome}" carregado.`);
  };

  const excluirCenario = async (c: Row) => {
    if (!confirm(`Excluir o cenário "${c.nome}"?`)) return;
    const { error } = await supabase.from("simulacoes_caixa").delete().eq("id", c.id);
    if (error) { setErro(error.message); return; }
    carregarCenarios();
  };

  const totalAbertoReceber = receber.reduce((s, r) => s + Number(r.valor || 0), 0);
  const totalAbertoPagar = pagar.reduce((s, r) => s + Number(r.valor || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">🎯 Simulador de Caixa</h1>
          <p className="text-sm text-gray-500">Marque títulos em aberto e veja quanto sobra — e em que dia o caixa aperta.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setUsarSaldo((v) => !v)}
            className={`no-print rounded-lg px-3 py-1.5 text-sm ring-1 ${usarSaldo ? "bg-brand-50 text-brand-700 ring-brand-200" : "bg-white text-gray-500 ring-gray-200 hover:bg-gray-50"}`}
            title="Ligar/desligar o saldo atual das contas como ponto de partida"
          >
            {usarSaldo ? "✓ " : ""}Considerar saldo em conta
          </button>
          {sel.size > 0 && (
            <button className="no-print text-sm text-gray-400 hover:text-gray-700" onClick={limparTudo}>limpar seleção</button>
          )}
          <PrintButton />
        </div>
      </div>

      {erro && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}
      {aviso && (
        <div className="flex items-center justify-between rounded-lg bg-brand-50 p-3 text-sm text-brand-700">
          <span>{aviso}</span>
          <button onClick={() => setAviso(null)} className="text-brand-400 hover:text-brand-700">✕</button>
        </div>
      )}

      {/* Filtro por intervalo de vencimento */}
      <div className="no-print flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-3 text-sm ring-1 ring-gray-100">
        <span className="text-gray-500">Vencimento de</span>
        <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="inp !w-auto py-1.5" />
        <span className="text-gray-500">até</span>
        <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="inp !w-auto py-1.5" />
        <div className="mx-1 h-5 w-px bg-gray-200" />
        <button onClick={() => { setDe(""); setAte(hoje); }} className="rounded-full bg-white px-3 py-1 text-xs text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100">Até hoje (vencidos)</button>
        <button onClick={() => { setDe(hoje); setAte(emDias(30)); }} className="rounded-full bg-white px-3 py-1 text-xs text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100">Próximos 30 dias</button>
        <button onClick={() => { setDe(inicioMes()); setAte(fimMes()); }} className="rounded-full bg-white px-3 py-1 text-xs text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100">Este mês</button>
        {(de || ate) && (
          <>
            <span className="text-xs text-gray-400">{visiveis.length} de {rows.length} título(s) no intervalo</span>
            <button onClick={() => { setDe(""); setAte(""); }} className="text-xs text-gray-400 hover:text-gray-700">limpar intervalo</button>
          </>
        )}
      </div>

      {/* Montagem de lote + Cenários */}
      <div className="no-print flex flex-wrap items-start gap-3">
        {/* Montar lote */}
        <div className="flex-1 min-w-[280px]">
          {!loteAberto ? (
            <button onClick={() => setLoteAberto(true)} className="rounded-lg bg-white px-3 py-2 text-sm text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50">
              🧠 Montar lote de pagamento
            </button>
          ) : (
            <div className="rounded-lg bg-white p-3 ring-1 ring-gray-200">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">🧠 Montar lote — “o que dá pra pagar sem furar?”</span>
                <button onClick={() => setLoteAberto(false)} className="text-gray-400 hover:text-gray-700">✕</button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-gray-500">Tenho</span>
                <input
                  inputMode="decimal" placeholder={formatCurrency(saldoDisponivel)}
                  value={orcamento} onChange={(e) => setOrcamento(e.target.value)}
                  className="inp !w-36 py-1.5"
                />
                <button onClick={() => setOrcamento(String(saldoDisponivel.toFixed(2)))} className="text-xs text-brand-600 hover:underline" title="Saldo inicial + recebimentos marcados">
                  usar disponível
                </button>
                <select className="inp !w-auto py-1.5" value={estrategia} onChange={(e) => setEstrategia(e.target.value as any)}>
                  <option value="urgentes">Mais urgentes primeiro</option>
                  <option value="quitar">Quitar mais títulos</option>
                </select>
                <button onClick={montarLote} className="btn-primary py-1.5">Aplicar seleção</button>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Marca automaticamente os pagamentos que cabem no valor, priorizando {estrategia === "urgentes" ? "vencimentos mais próximos/atrasados" : "os títulos de menor valor"}. Os recebimentos marcados são mantidos.
              </p>
            </div>
          )}
        </div>

        {/* Cenários */}
        {!cenariosOff && (
          <div className="flex-1 min-w-[280px] rounded-lg bg-white p-3 ring-1 ring-gray-200">
            <div className="mb-2 flex items-center gap-2">
              <input
                placeholder="Nome do cenário…" value={nomeCenario}
                onChange={(e) => setNomeCenario(e.target.value)}
                className="inp flex-1 py-1.5"
              />
              <button onClick={salvarCenario} disabled={salvando} className="btn-primary py-1.5 disabled:opacity-50">
                {salvando ? "Salvando…" : "💾 Salvar"}
              </button>
            </div>
            {cenarios.length === 0 ? (
              <p className="text-xs text-gray-400">Nenhum cenário salvo ainda.</p>
            ) : (
              <ul className="max-h-32 space-y-1 overflow-y-auto">
                {cenarios.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-gray-50">
                    <button onClick={() => aplicarCenario(c)} className="min-w-0 flex-1 truncate text-left text-gray-700 hover:text-brand-700" title="Carregar cenário">
                      {c.nome}
                      <span className="ml-2 text-xs text-gray-400">{(c.titulo_ids ?? []).length} título(s)</span>
                    </button>
                    <button onClick={() => excluirCenario(c)} className="text-xs text-gray-300 hover:text-red-600" title="Excluir">🗑</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Painel de resultado */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card t="Saldo inicial" sub={usarSaldo ? "em contas" : "desligado"} v={formatCurrency(saldoInicial)} />
        <Card t="+ A receber" sub="selecionado" v={formatCurrency(totReceber)} cor="text-green-600" />
        <Card t="− A pagar" sub="selecionado" v={formatCurrency(totPagar)} cor="text-red-600" />
        <Card
          t="= Saldo projetado"
          sub={`líquido ${liquido >= 0 ? "+" : ""}${formatCurrency(liquido)}`}
          v={formatCurrency(projetado)}
          cor={projetado >= 0 ? "text-green-700" : "text-red-600"}
          destaque
        />
      </div>

      {/* Alerta de furo */}
      {sel.size > 0 && (
        timeline.furo ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            🔴 <b>O caixa fica negativo em {formatDate(timeline.furo.data)}</b> — chegando a {formatCurrency(timeline.furo.saldo)}.
            {" "}Repriorize pagamentos ou antecipe recebimentos antes dessa data.
          </div>
        ) : (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            🟢 <b>Caixa positivo o tempo todo.</b> Menor saldo no período: {formatCurrency(timeline.menor)}.
          </div>
        )
      )}

      {/* Linha do tempo */}
      {timeline.pontos.length > 0 && (
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Linha do tempo do caixa</h2>
            <span className="text-xs text-gray-400">saldo acumulado por vencimento</span>
          </div>
          <SaldoChart pontos={timeline.pontos} saldoInicial={saldoInicial} />
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase text-gray-400">
                <tr><th className="py-1 pr-4">Data</th><th className="py-1 pr-4 text-right">Movimento</th><th className="py-1 text-right">Saldo acumulado</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {timeline.pontos.map((p) => (
                  <tr key={p.data} className={p.saldo < 0 ? "bg-red-50/60" : ""}>
                    <td className="py-1.5 pr-4 font-medium text-gray-700">{formatDate(p.data)}{p.data < hoje ? <span className="ml-1 text-xs text-red-500">(vencido)</span> : null}</td>
                    <td className={`py-1.5 pr-4 text-right tabular-nums ${p.delta >= 0 ? "text-green-600" : "text-red-600"}`}>{p.delta >= 0 ? "+" : ""}{formatCurrency(p.delta)}</td>
                    <td className={`py-1.5 text-right font-semibold tabular-nums ${p.saldo < 0 ? "text-red-600" : "text-gray-900"}`}>{formatCurrency(p.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Duas colunas */}
      {carregando ? (
        <div className="card px-4 py-12 text-center text-gray-400">Carregando títulos em aberto…</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Coluna
            titulo="A Receber" icon="🟢" corTotal="text-green-600"
            lista={receber} sel={sel} hoje={hoje} parte={parte}
            totalAberto={totalAbertoReceber} selecionado={totReceber}
            onToggle={toggle} onMarcar={marcar}
          />
          <Coluna
            titulo="A Pagar" icon="🔴" corTotal="text-red-600"
            lista={pagar} sel={sel} hoje={hoje} parte={parte}
            totalAberto={totalAbertoPagar} selecionado={totPagar}
            onToggle={toggle} onMarcar={marcar}
          />
        </div>
      )}
    </div>
  );
}

// ---------- Coluna ----------
function Coluna({
  titulo, icon, corTotal, lista, sel, hoje, parte, totalAberto, selecionado, onToggle, onMarcar,
}: {
  titulo: string; icon: string; corTotal: string; lista: Row[]; sel: Set<string>;
  hoje: string; parte: (r: Row) => string; totalAberto: number; selecionado: number;
  onToggle: (id: string) => void; onMarcar: (lista: Row[], ids: string[], on: boolean) => void;
}) {
  const [ate, setAte] = useState("");
  const ids = lista.map((r) => r.id);
  const vencidos = lista.filter((r) => (r.vencimento || hoje) < hoje).map((r) => r.id);
  const todosMarcados = ids.length > 0 && ids.every((id) => sel.has(id));
  const qtdSel = lista.filter((r) => sel.has(r.id)).length;

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-gray-100 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold text-gray-900">{icon} {titulo}</h2>
          <span className="text-xs text-gray-400">{lista.length} em aberto · {formatCurrency(totalAberto)}</span>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2 text-xs">
          <button onClick={() => onMarcar(lista, ids, !todosMarcados)} className="rounded-full bg-gray-100 px-3 py-1 text-gray-600 hover:bg-gray-200">
            {todosMarcados ? "Desmarcar todos" : "Marcar todos"}
          </button>
          {vencidos.length > 0 && (
            <button onClick={() => onMarcar(lista, vencidos, true)} className="rounded-full bg-red-50 px-3 py-1 text-red-600 hover:bg-red-100">
              Marcar vencidos ({vencidos.length})
            </button>
          )}
          <span className="flex items-center gap-1 text-gray-400">
            vence até
            <input type="date" value={ate} onChange={(e) => { setAte(e.target.value); if (e.target.value) onMarcar(lista, lista.filter((r) => (r.vencimento || hoje) <= e.target.value).map((r) => r.id), true); }} className="inp !w-auto py-1" />
          </span>
        </div>
      </div>

      {lista.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-gray-400">Nada em aberto.</div>
      ) : (
        <ul className="max-h-[28rem] divide-y divide-gray-100 overflow-y-auto">
          {lista.map((r) => {
            const vencido = (r.vencimento || hoje) < hoje;
            const marcado = sel.has(r.id);
            return (
              <li key={r.id}>
                <label className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-gray-50 ${marcado ? "bg-brand-50/40" : ""}`}>
                  <input type="checkbox" checked={marcado} onChange={() => onToggle(r.id)} className="h-4 w-4 shrink-0 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{r.descricao}</p>
                    <p className="truncate text-xs text-gray-400">{parte(r) || "—"}</p>
                  </div>
                  <div className={`w-20 shrink-0 text-right text-xs ${vencido ? "font-medium text-red-600" : "text-gray-500"}`}>{formatDate(r.vencimento)}</div>
                  <div className="w-24 shrink-0 text-right text-sm font-medium tabular-nums text-gray-900">{formatCurrency(r.valor)}</div>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-4 py-2 text-sm">
        <span className="text-gray-500">{qtdSel} selecionado(s)</span>
        <b className={corTotal}>{formatCurrency(selecionado)}</b>
      </div>
    </div>
  );
}

// ---------- Card KPI ----------
function Card({ t, sub, v, cor = "text-gray-900", destaque = false }: { t: string; sub?: string; v: string; cor?: string; destaque?: boolean }) {
  return (
    <div className={`card p-4 ${destaque ? "ring-2 ring-brand-200" : ""}`}>
      <p className="text-xs text-gray-500">{t}</p>
      <p className={`mt-1 text-2xl font-semibold ${cor}`}>{v}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

// ---------- Gráfico SVG do saldo acumulado ----------
function SaldoChart({ pontos, saldoInicial }: { pontos: { data: string; saldo: number }[]; saldoInicial: number }) {
  const serie = [{ data: "inicial", saldo: saldoInicial }, ...pontos];
  const W = 100, H = 40, pad = 4;
  const saldos = serie.map((p) => p.saldo);
  const max = Math.max(0, ...saldos);
  const min = Math.min(0, ...saldos);
  const span = max - min || 1;
  const x = (i: number) => (serie.length === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (serie.length - 1));
  const y = (s: number) => pad + ((max - s) / span) * (H - 2 * pad);
  const yZero = y(0);
  const linha = serie.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.saldo).toFixed(2)}`).join(" ");
  const area = `${linha} L${x(serie.length - 1).toFixed(2)},${yZero.toFixed(2)} L${x(0).toFixed(2)},${yZero.toFixed(2)} Z`;
  const negativo = min < 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-32 w-full">
      <defs>
        <linearGradient id="fillPos" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22c55e" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* faixa negativa */}
      {negativo && <rect x="0" y={yZero} width={W} height={H - yZero} fill="#fef2f2" />}
      {/* linha do zero */}
      <line x1="0" y1={yZero} x2={W} y2={yZero} stroke="#d1d5db" strokeWidth="0.3" strokeDasharray="1.5 1.5" />
      <path d={area} fill="url(#fillPos)" />
      <path d={linha} fill="none" stroke={negativo ? "#dc2626" : "#16a34a"} strokeWidth="0.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {serie.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.saldo)} r="0.7" fill={p.saldo < 0 ? "#dc2626" : "#16a34a"} />
      ))}
    </svg>
  );
}
