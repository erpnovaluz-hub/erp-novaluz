"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/format";
import PrintButton from "@/components/PrintButton";

type Colab = { id: string; nome: string; cargo: string | null; salario_base: number | null };
type Tipo = { id: string; nome: string };

// linha editável por colaborador
type Linha = {
  colaborador_id: string;
  nome: string;
  cargo: string | null;
  lancamento_id: string | null;
  titulo_id: string | null;
  salario_liquido: string;
  horas_extras: string;
  descontos: string;
  observacao: string;
  beneficios: Record<string, string>; // tipoId -> valor
};

const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const MESES_LONGO = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];
const CATEGORIA_FOLHA = "Despesas com pessoal (folha/encargos)";

const num = (v: string | number | null | undefined) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  return isNaN(n) ? 0 : n;
};

export default function FolhaView() {
  const supabase = useMemo(() => createClient(), []);
  const hoje = new Date();
  const [ano, setAno] = useState(String(hoje.getFullYear()));
  const [mes, setMes] = useState(String(hoje.getMonth() + 1).padStart(2, "0"));

  const [tipos, setTipos] = useState<Tipo[]>([]);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const competencia = `${ano}-${mes}-01`;
  const anos = useMemo(() => {
    const y = hoje.getFullYear();
    return Array.from({ length: 6 }, (_, i) => String(y - 3 + i));
  }, [hoje]);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null); setMsg(null);
    const [colabRes, tipoRes] = await Promise.all([
      supabase.from("colaboradores").select("id, nome, cargo, salario_base").eq("ativo", true).order("nome").range(0, 4999),
      supabase.from("folha_tipos_beneficio").select("id, nome").eq("ativo", true).order("ordem").range(0, 999),
    ]);
    if (colabRes.error) { setErro(colabRes.error.message); setCarregando(false); return; }
    const colabs: Colab[] = colabRes.data ?? [];
    const tp: Tipo[] = tipoRes.data ?? [];
    setTipos(tp);

    const { data: lancs, error: lErr } = await supabase
      .from("folha_lancamentos").select("*").eq("competencia", competencia).range(0, 4999);
    if (lErr) { setErro(lErr.message); setCarregando(false); return; }
    const lancByColab = Object.fromEntries((lancs ?? []).map((l: any) => [l.colaborador_id, l]));

    const ids = (lancs ?? []).map((l: any) => l.id);
    let benByLanc: Record<string, Record<string, string>> = {};
    if (ids.length) {
      const { data: bens } = await supabase
        .from("folha_lancamento_beneficios").select("lancamento_id, tipo_beneficio_id, valor").in("lancamento_id", ids);
      for (const b of bens ?? []) {
        (benByLanc[b.lancamento_id] ??= {})[b.tipo_beneficio_id] = String(b.valor ?? "");
      }
    }

    const novas: Linha[] = colabs.map((c) => {
      const l = lancByColab[c.id];
      const bens = l ? benByLanc[l.id] ?? {} : {};
      return {
        colaborador_id: c.id,
        nome: c.nome,
        cargo: c.cargo,
        lancamento_id: l?.id ?? null,
        titulo_id: l?.titulo_id ?? null,
        salario_liquido: l ? String(l.salario_liquido ?? "") : "",
        horas_extras: l ? String(l.horas_extras ?? "") : "",
        descontos: l ? String(l.descontos ?? "") : "",
        observacao: l?.observacao ?? "",
        beneficios: Object.fromEntries(tp.map((t) => [t.id, bens[t.id] ?? ""])),
      };
    });
    setLinhas(novas);
    setCarregando(false);
  }, [supabase, competencia]);

  useEffect(() => { carregar(); }, [carregar]);

  const setCampo = (idx: number, campo: keyof Linha, valor: string) =>
    setLinhas((ls) => ls.map((l, i) => (i === idx ? { ...l, [campo]: valor } : l)));
  const setBeneficio = (idx: number, tipoId: string, valor: string) =>
    setLinhas((ls) => ls.map((l, i) => (i === idx ? { ...l, beneficios: { ...l.beneficios, [tipoId]: valor } } : l)));

  const custoLinha = (l: Linha) =>
    num(l.salario_liquido) + num(l.horas_extras) +
    tipos.reduce((s, t) => s + num(l.beneficios[t.id]), 0) - num(l.descontos);

  const temDados = (l: Linha) =>
    !!l.lancamento_id || num(l.salario_liquido) || num(l.horas_extras) || num(l.descontos) ||
    tipos.some((t) => num(l.beneficios[t.id]));

  // totais do rodapé
  const totSalarios = linhas.reduce((s, l) => s + num(l.salario_liquido), 0);
  const totExtras = linhas.reduce((s, l) => s + num(l.horas_extras), 0);
  const totDesc = linhas.reduce((s, l) => s + num(l.descontos), 0);
  const totBenPorTipo = (tid: string) => linhas.reduce((s, l) => s + num(l.beneficios[tid]), 0);
  const totBenef = tipos.reduce((s, t) => s + totBenPorTipo(t.id), 0);
  const totCusto = linhas.reduce((s, l) => s + custoLinha(l), 0);

  async function salvar(): Promise<boolean> {
    setSalvando(true); setErro(null); setMsg(null);
    try {
      for (const l of linhas) {
        if (!temDados(l)) continue;
        const dados = {
          colaborador_id: l.colaborador_id,
          competencia,
          salario_liquido: num(l.salario_liquido),
          horas_extras: num(l.horas_extras),
          descontos: num(l.descontos),
          observacao: l.observacao || null,
        };
        let lancId = l.lancamento_id;
        if (lancId) {
          const { error } = await supabase.from("folha_lancamentos").update(dados).eq("id", lancId);
          if (error) throw error;
        } else {
          const { data, error } = await supabase.from("folha_lancamentos").insert(dados).select("id").single();
          if (error) throw error;
          lancId = data.id;
          l.lancamento_id = lancId; // guarda p/ gerar título depois
        }
        // benefícios: regrava (delete + insert dos não-zerados)
        await supabase.from("folha_lancamento_beneficios").delete().eq("lancamento_id", lancId);
        const bens = tipos
          .filter((t) => num(l.beneficios[t.id]) !== 0)
          .map((t) => ({ lancamento_id: lancId, tipo_beneficio_id: t.id, valor: num(l.beneficios[t.id]) }));
        if (bens.length) {
          const { error } = await supabase.from("folha_lancamento_beneficios").insert(bens);
          if (error) throw error;
        }
      }
      setMsg("Folha salva.");
      return true;
    } catch (e: any) {
      setErro(e.message ?? "Erro ao salvar.");
      return false;
    } finally {
      setSalvando(false);
    }
  }

  async function categoriaFolhaId(): Promise<string | null> {
    const { data } = await supabase.from("categorias_financeiras").select("id").eq("nome", CATEGORIA_FOLHA).limit(1);
    if (data && data.length) return data[0].id;
    const { data: novo, error } = await supabase
      .from("categorias_financeiras").insert({ nome: CATEGORIA_FOLHA, natureza: "despesa", grupo_dre: "despesa_operacional", ordem: 40 }).select("id").single();
    if (error) return null;
    return novo.id;
  }

  async function gerarAPagar() {
    if (!confirm(`Gerar/atualizar as contas a pagar da folha de ${MESES[+mes - 1]}/${ano}?\nUm título por colaborador será criado no Financeiro (Contas a Pagar).`)) return;
    setGerando(true); setErro(null); setMsg(null);
    const ok = await salvar();
    if (!ok) { setGerando(false); return; }
    try {
      const catId = await categoriaFolhaId();
      // vencimento padrão: dia 5 do mês seguinte
      const m = +mes, y = +ano;
      const venc = m === 12 ? `${y + 1}-01-05` : `${y}-${String(m + 1).padStart(2, "0")}-05`;
      const rotulo = `${MESES_LONGO[m - 1]}/${ano}`;
      let criados = 0, atualizados = 0;
      for (const l of linhas) {
        const custo = Math.round(custoLinha(l) * 100) / 100;
        if (custo <= 0 || !l.lancamento_id) continue;
        const titulo = {
          tipo: "pagar",
          descricao: `Folha ${rotulo} — ${l.nome}`,
          valor: custo,
          categoria_id: catId,
          competencia,
          vencimento: venc,
          status: "aberto",
          origem: "folha",
          referencia_id: l.colaborador_id,
        };
        if (l.titulo_id) {
          const { error } = await supabase
            .from("titulos_financeiros")
            .update({ descricao: titulo.descricao, valor: titulo.valor, categoria_id: catId, competencia, vencimento: venc })
            .eq("id", l.titulo_id).eq("status", "aberto");
          if (error) throw error;
          atualizados++;
        } else {
          const { data, error } = await supabase.from("titulos_financeiros").insert(titulo).select("id").single();
          if (error) throw error;
          await supabase.from("folha_lancamentos").update({ titulo_id: data.id }).eq("id", l.lancamento_id);
          l.titulo_id = data.id;
          criados++;
        }
      }
      setMsg(`Contas a pagar: ${criados} criada(s), ${atualizados} atualizada(s). Veja em Financeiro › Contas a Pagar.`);
    } catch (e: any) {
      setErro(e.message ?? "Erro ao gerar contas a pagar.");
    } finally {
      setGerando(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">🧾 Folha do mês</h1>
        <div className="no-print flex items-center gap-2">
          <select className="inp !w-auto py-1.5" value={mes} onChange={(e) => setMes(e.target.value)}>
            {MESES.map((mn, i) => <option key={i} value={String(i + 1).padStart(2, "0")}>{mn}</option>)}
          </select>
          <select className="inp !w-auto py-1.5" value={ano} onChange={(e) => setAno(e.target.value)}>
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <PrintButton />
          <button className="btn-ghost" onClick={salvar} disabled={salvando || carregando}>
            {salvando ? "Salvando…" : "💾 Salvar"}
          </button>
          <button className="btn-primary" onClick={gerarAPagar} disabled={gerando || carregando}>
            {gerando ? "Gerando…" : "➡️ Gerar contas a pagar"}
          </button>
        </div>
      </div>

      {msg && <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{msg}</div>}
      {erro && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      {/* resumo */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <Card titulo="Colaboradores" valor={String(linhas.filter(temDados).length)} plano />
        <Card titulo="Salários líquidos" valor={formatCurrency(totSalarios)} />
        <Card titulo="Benefícios" valor={formatCurrency(totBenef)} />
        <Card titulo="Horas extras" valor={formatCurrency(totExtras)} />
        <Card titulo="Custo total da folha" valor={formatCurrency(totCusto)} destaque />
      </div>

      <div className="card overflow-x-auto">
        {carregando ? (
          <div className="px-4 py-12 text-center text-gray-400">Carregando…</div>
        ) : linhas.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400">
            Nenhum colaborador ativo. Cadastre em RH › Colaboradores.
          </div>
        ) : (
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-3 py-2">Colaborador</th>
                <th className="px-3 py-2 text-right">Salário líquido</th>
                {tipos.map((t) => <th key={t.id} className="px-3 py-2 text-right">{t.nome}</th>)}
                <th className="px-3 py-2 text-right">Horas extras</th>
                <th className="px-3 py-2 text-right">Descontos</th>
                <th className="px-3 py-2 text-right">Custo total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {linhas.map((l, idx) => (
                <tr key={l.colaborador_id} className="hover:bg-gray-50/60">
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900">{l.nome}</div>
                    {l.cargo && <div className="text-xs text-gray-400">{l.cargo}</div>}
                  </td>
                  <td className="px-2 py-1"><CelInput valor={l.salario_liquido} onChange={(v) => setCampo(idx, "salario_liquido", v)} /></td>
                  {tipos.map((t) => (
                    <td key={t.id} className="px-2 py-1"><CelInput valor={l.beneficios[t.id] ?? ""} onChange={(v) => setBeneficio(idx, t.id, v)} /></td>
                  ))}
                  <td className="px-2 py-1"><CelInput valor={l.horas_extras} onChange={(v) => setCampo(idx, "horas_extras", v)} /></td>
                  <td className="px-2 py-1"><CelInput valor={l.descontos} onChange={(v) => setCampo(idx, "descontos", v)} /></td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-gray-900">
                    {formatCurrency(custoLinha(l))}
                    {l.titulo_id && <span title="Título a pagar gerado" className="ml-1 text-green-500">•</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 font-semibold text-gray-900">
                <td className="px-3 py-2">Total ({linhas.filter(temDados).length})</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totSalarios)}</td>
                {tipos.map((t) => <td key={t.id} className="px-3 py-2 text-right tabular-nums">{formatCurrency(totBenPorTipo(t.id))}</td>)}
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totExtras)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totDesc)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-brand-700">{formatCurrency(totCusto)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Dica: preencha o líquido, os benefícios, horas extras e descontos, clique em <b>Salvar</b>. O botão
        <b> Gerar contas a pagar</b> cria um título por colaborador no Financeiro (categoria “{CATEGORIA_FOLHA}”),
        com vencimento no dia 5 do mês seguinte — ao dar baixa, entra no fluxo de caixa e no DRE.
      </p>
    </div>
  );
}

function CelInput({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  return (
    <input
      type="number" step="0.01" inputMode="decimal"
      className="w-24 rounded-md border border-gray-200 px-2 py-1 text-right tabular-nums focus:border-brand-400 focus:outline-none"
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      placeholder="0,00"
    />
  );
}

function Card({ titulo, valor, destaque, plano }: { titulo: string; valor: string; destaque?: boolean; plano?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ${destaque ? "bg-brand-600 text-white" : "bg-white ring-1 ring-gray-100"}`}>
      <p className={`text-xs ${destaque ? "text-white/80" : "text-gray-400"}`}>{titulo}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${plano ? "text-gray-700" : ""}`}>{valor}</p>
    </div>
  );
}
