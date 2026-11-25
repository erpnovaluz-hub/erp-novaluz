"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import { useEquipe } from "@/components/tarefas/comum";
import { SeloFarol } from "@/components/gestao/kpiComum";
import { farol, formatarValor, janelaMeses, mesAtual, rotuloMes, UNIDADES, type Catalogo, type Kpi, type Medicao } from "@/lib/kpis";

// Detalhe de um KPI: ficha, histórico de 12 meses com a causa, lançamento
// (valor do manual / causa de qualquer um) e — gerência — meta, tolerância e
// responsável.
export default function KpiDrawer({ kpiId, mes, onClose, onChange }: {
  kpiId: string; mes: string; onClose: () => void; onChange: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const acesso = useAcesso();
  const { pessoas, porId } = useEquipe();
  const [k, setK] = useState<Kpi | null>(null);
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [hist, setHist] = useState<Medicao[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [periodo, setPeriodo] = useState(mes);
  const [valor, setValor] = useState("");
  const [causa, setCausa] = useState("");
  const [meta, setMeta] = useState("");
  const [tol, setTol] = useState("10");
  const [resp, setResp] = useState("");

  const janela = useMemo(() => janelaMeses(mesAtual(), 12).reverse(), []);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("kpis").select("*").eq("id", kpiId).maybeSingle();
    if (!data) { setErro("Indicador não encontrado."); return; }
    const kk = data as Kpi;
    setK(kk);
    setMeta(kk.meta != null ? String(kk.meta) : "");
    setTol(String(kk.tolerancia ?? 10));
    setResp(kk.responsavel_id ?? "");
    if (kk.catalogo_chave) {
      const c = await supabase.from("kpi_catalogo").select("*").eq("chave", kk.catalogo_chave).maybeSingle();
      setCat((c.data as Catalogo) ?? null);
    }
    const h = await supabase.from("kpi_medicoes").select("*").eq("kpi_id", kpiId).gte("periodo", janela[janela.length - 1]).order("periodo", { ascending: false });
    setHist((h.data ?? []) as Medicao[]);
  }, [supabase, kpiId, janela]);

  useEffect(() => { carregar(); }, [carregar]);

  const med = hist.find((h) => h.periodo === periodo);
  useEffect(() => {
    setValor(med?.valor != null && med.origem === "manual" ? String(med.valor) : "");
    setCausa(med?.observacao ?? "");
  }, [med?.valor, med?.observacao, med?.origem, periodo]);

  if (!k) {
    return <Casca onClose={onClose}><p className="p-8 text-center text-sm text-gray-400">{erro ?? "Carregando…"}</p></Casca>;
  }

  const manual = !cat || cat.coleta === "manual";
  const podeLancar = acesso.gerencia || k.responsavel_id === acesso.userId;
  const fAtual = farol(med?.valor, k);
  const unidade = UNIDADES.find((u) => u.key === k.unidade)?.label ?? "";

  function avisar(msg: string) { setOk(msg); setErro(null); setTimeout(() => setOk(null), 2500); }

  async function lancar() {
    setErro(null);
    const v = valor.trim() === "" ? null : Number(valor.replace(",", "."));
    if (manual && (v == null || Number.isNaN(v))) { setErro("Informe o valor do mês."); return; }
    const f = farol(manual ? v : med?.valor, k!);
    if ((f === "vermelho" || f === "amarelo") && !causa.trim()) {
      setErro("Fora da faixa: escreva a causa. Número sem causa não vira decisão.");
      return;
    }
    const { error } = await supabase.rpc("kpi_lancar", { p_kpi: k!.id, p_periodo: periodo, p_valor: v, p_observacao: causa });
    if (error) { setErro(error.message); return; }
    avisar("Lançamento salvo."); await carregar(); onChange();
  }

  async function salvarConfig() {
    setErro(null);
    const m = meta.trim() === "" ? null : Number(meta.replace(",", "."));
    const t = Number(tol.replace(",", "."));
    if (m != null && Number.isNaN(m)) { setErro("Meta inválida."); return; }
    if (Number.isNaN(t) || t < 0 || t > 100) { setErro("Tolerância entre 0 e 100%."); return; }
    const { error } = await supabase.from("kpis").update({ meta: m, tolerancia: t, responsavel_id: resp || null }).eq("id", k!.id);
    if (error) { setErro(error.message); return; }
    avisar("Configuração salva."); await carregar(); onChange();
  }

  return (
    <Casca onClose={onClose}>
      <div className="space-y-4 overflow-y-auto p-5">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{k.nome}</h2>
          <p className="text-sm text-gray-600">{cat?.descricao ?? k.descricao}</p>
        </div>

        {erro && <div className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{erro}</div>}
        {ok && <div className="rounded-lg bg-green-50 p-2 text-sm text-green-700">{ok}</div>}

        <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
          {cat && <p><b>Fórmula:</b> {cat.formula}</p>}
          {cat && <p className="mt-1"><b>Decisão que apoia:</b> {cat.decisao}</p>}
          <p className="mt-1"><b>Sentido:</b> {k.sentido === "maior" ? "↑ maior é melhor" : "↓ menor é melhor"} · <b>Coleta:</b> {manual ? "manual (lançada pelo responsável)" : "automática (do ERP)"}{cat?.foto ? " · foto do mês" : ""}</p>
          {cat?.aviso && <p className="mt-1 text-amber-700">⚠ {cat.aviso}</p>}
        </div>

        {/* Lançamento */}
        {podeLancar && (
          <section className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-800">{manual ? "Lançar valor" : "Registrar a causa"}</h3>
              <select className="inp w-auto py-1 text-sm capitalize" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
                {janela.map((p) => <option key={p} value={p}>{rotuloMes(p)}</option>)}
              </select>
            </div>
            {!manual && (
              <p className="mt-2 text-sm">Valor do sistema: <b>{formatarValor(med?.valor, k.unidade)}</b> <SeloFarol f={fAtual} /></p>
            )}
            <div className="mt-2 grid gap-2 sm:grid-cols-[10rem_1fr]">
              {manual && (
                <div>
                  <label className="lbl">Valor ({unidade})</label>
                  <input className="inp" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
                </div>
              )}
              <div className={manual ? "" : "sm:col-span-2"}>
                <label className="lbl">Causa / comentário (obrigatório se fora da faixa)</label>
                <input className="inp" value={causa} onChange={(e) => setCausa(e.target.value)} placeholder="Ex.: chapa chegou com 10 dias de atraso" />
              </div>
            </div>
            <div className="mt-2 flex justify-end"><button className="btn-primary text-sm" onClick={lancar}>Salvar</button></div>
          </section>
        )}

        {/* Meta / responsável (gerência) */}
        {acesso.gerencia && (
          <section className="rounded-lg border p-3">
            <h3 className="text-sm font-semibold text-gray-800">Meta e responsável</h3>
            <p className="text-xs text-gray-400">Sem meta = medindo linha de base. Defina a meta na reunião mensal, olhando o número real.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <div><label className="lbl">Meta ({unidade})</label><input className="inp" inputMode="decimal" value={meta} onChange={(e) => setMeta(e.target.value)} placeholder="sem meta" /></div>
              <div><label className="lbl">Tolerância amarela (% da meta)</label><input className="inp" inputMode="decimal" value={tol} onChange={(e) => setTol(e.target.value)} /></div>
              <div>
                <label className="lbl">Responsável</label>
                <select className="inp" value={resp} onChange={(e) => setResp(e.target.value)}>
                  <option value="">—</option>
                  {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome || p.email}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-2 flex justify-end"><button className="btn-primary text-sm" onClick={salvarConfig}>Salvar</button></div>
          </section>
        )}

        {/* Histórico */}
        <section>
          <h3 className="text-sm font-semibold text-gray-800">Histórico</h3>
          <table className="mt-2 w-full text-sm">
            <thead><tr className="border-b text-left text-[11px] uppercase tracking-wide text-gray-500">
              <th className="py-1">Mês</th><th className="py-1 text-right">Valor</th><th className="py-1 pl-3">Farol</th><th className="py-1 pl-3">Causa</th>
            </tr></thead>
            <tbody>
              {janela.map((p) => {
                const h = hist.find((x) => x.periodo === p);
                return (
                  <tr key={p} className="border-b align-top">
                    <td className="py-1.5 capitalize text-gray-700">{rotuloMes(p)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatarValor(h?.valor, k.unidade)}</td>
                    <td className="py-1.5 pl-3">{h?.valor != null ? <SeloFarol f={farol(h.valor, k)} compacto /> : <span className="text-gray-300">–</span>}</td>
                    <td className="py-1.5 pl-3 text-xs text-gray-600">{h?.observacao}{h?.registrado_por && h.origem === "manual" ? <span className="text-gray-400"> · {porId[h.registrado_por]?.nome ?? ""}</span> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </Casca>
  );
}

function Casca({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
        style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex justify-end border-b px-3 py-2">
          <button className="btn-ghost text-lg leading-none" onClick={onClose} aria-label="Fechar">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
