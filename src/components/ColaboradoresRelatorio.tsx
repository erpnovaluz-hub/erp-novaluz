"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/format";
import ReportPrintHeader from "@/components/ReportPrintHeader";
import { useAcesso } from "@/components/AcessoProvider";

type Colab = {
  id: string; nome: string; cargo: string | null; funcao_padrao: string | null;
  data_admissao: string | null; salario_base: number | null; custo_hora: number | null; ativo: boolean;
};

type Modelo = "relatorio" | "simples" | "assinatura";
type Agrupar = "" | "cargo" | "funcao_padrao";
type Ordem = "nome" | "admissao" | "salario";
type ColKey = "cargo" | "funcao_padrao" | "data_admissao" | "tempo" | "salario_base" | "custo_hora" | "ativo";

const COLUNAS: { key: ColKey; label: string; valor?: boolean }[] = [
  { key: "cargo", label: "Cargo" },
  { key: "funcao_padrao", label: "Função" },
  { key: "data_admissao", label: "Admissão" },
  { key: "tempo", label: "Tempo de casa" },
  { key: "salario_base", label: "Salário base", valor: true },
  { key: "custo_hora", label: "Custo/hora", valor: true },
  { key: "ativo", label: "Situação" },
];

const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };
const txt = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

function tempoDeCasa(adm: string | null): { meses: number; texto: string } | null {
  if (!adm) return null;
  const a = new Date(adm + "T00:00:00"), h = new Date();
  let meses = (h.getFullYear() - a.getFullYear()) * 12 + (h.getMonth() - a.getMonth());
  if (h.getDate() < a.getDate()) meses -= 1;
  if (meses < 0) return null;
  return { meses, texto: textoMeses(meses) };
}
function textoMeses(meses: number) {
  const anos = Math.floor(meses / 12), m = meses % 12;
  const partes = [anos ? `${anos} ano${anos > 1 ? "s" : ""}` : "", m ? `${m} ${m > 1 ? "meses" : "mês"}` : ""].filter(Boolean);
  return partes.join(" e ") || "< 1 mês";
}

export default function ColaboradoresRelatorio() {
  const supabase = useMemo(() => createClient(), []);
  const verValores = useAcesso().gerencia;   // salários: só gerência (igual à lista)
  const [lista, setLista] = useState<Colab[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // filtros
  const [situacao, setSituacao] = useState<"ativos" | "inativos" | "todos">("ativos");
  const [cargo, setCargo] = useState("");
  const [funcao, setFuncao] = useState("");
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("nome");
  const [agrupar, setAgrupar] = useState<Agrupar>("");

  // opções de impressão
  const [modelo, setModelo] = useState<Modelo>("relatorio");
  const [cols, setCols] = useState<Record<ColKey, boolean>>({
    cargo: true, funcao_padrao: true, data_admissao: true, tempo: true, salario_base: true, custo_hora: false, ativo: false,
  });
  const [paisagem, setPaisagem] = useState(false);
  const [resumo, setResumo] = useState(true);
  const [titulo, setTitulo] = useState("");
  const [linhasExtras, setLinhasExtras] = useState(0);

  useEffect(() => {
    (async () => {
      setCarregando(true);
      const { data, error } = await supabase.from("colaboradores")
        .select("id, nome, cargo, funcao_padrao, data_admissao, salario_base, custo_hora, ativo")
        .order("nome").range(0, 4999);
      if (error) setErro(error.message);
      setLista((data ?? []) as Colab[]);
      setCarregando(false);
    })();
  }, [supabase]);

  const cargos = useMemo(() => [...new Set(lista.map((c) => txt(c.cargo)).filter(Boolean))].sort(), [lista]);
  const funcoes = useMemo(() => [...new Set(lista.map((c) => txt(c.funcao_padrao)).filter(Boolean))].sort(), [lista]);

  const filtrados = useMemo(() => {
    const b = busca.trim().toUpperCase();
    const r = lista.filter((c) =>
      (situacao === "todos" || (situacao === "ativos" ? c.ativo : !c.ativo))
      && (!cargo || txt(c.cargo) === cargo)
      && (!funcao || txt(c.funcao_padrao) === funcao)
      && (!b || c.nome.toUpperCase().includes(b)));
    const porNome = (a: Colab, z: Colab) => a.nome.localeCompare(z.nome, "pt-BR");
    if (ordem === "admissao") r.sort((a, z) => (a.data_admissao ?? "9999").localeCompare(z.data_admissao ?? "9999") || porNome(a, z));
    else if (ordem === "salario") r.sort((a, z) => num(z.salario_base) - num(a.salario_base) || porNome(a, z));
    else r.sort(porNome);
    return r;
  }, [lista, situacao, cargo, funcao, busca, ordem]);

  const grupos = useMemo(() => {
    if (!agrupar) return [{ nome: "", itens: filtrados }];
    const map = new Map<string, Colab[]>();
    for (const c of filtrados) {
      const k = txt(c[agrupar]) || "SEM " + (agrupar === "cargo" ? "CARGO" : "FUNÇÃO");
      (map.get(k) ?? map.set(k, []).get(k)!).push(c);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR")).map(([nome, itens]) => ({ nome, itens }));
  }, [filtrados, agrupar]);

  const tot = useMemo(() => {
    const ativos = filtrados.filter((c) => c.ativo);
    const comSal = ativos.filter((c) => num(c.salario_base) > 0);
    const folha = comSal.reduce((s, c) => s + num(c.salario_base), 0);
    const tempos = ativos.map((c) => tempoDeCasa(c.data_admissao)?.meses).filter((m): m is number => m != null);
    return {
      total: filtrados.length, ativos: ativos.length, inativos: filtrados.length - ativos.length,
      folha, media: comSal.length ? folha / comSal.length : 0,
      semCargo: filtrados.filter((c) => !txt(c.cargo)).length,
      semSalario: ativos.length - comSal.length,
      tempoMedio: tempos.length ? Math.round(tempos.reduce((s, m) => s + m, 0) / tempos.length) : null,
    };
  }, [filtrados]);

  const porCargo = useMemo(() => {
    const map: Record<string, { qtd: number; folha: number }> = {};
    for (const c of filtrados.filter((x) => x.ativo)) {
      const k = txt(c.cargo) || "SEM CARGO";
      (map[k] ??= { qtd: 0, folha: 0 });
      map[k].qtd += 1; map[k].folha += num(c.salario_base);
    }
    return Object.entries(map).sort((a, b) => b[1].qtd - a[1].qtd || a[0].localeCompare(b[0]));
  }, [filtrados]);

  // colunas efetivas conforme modelo
  const colunas = useMemo(() => {
    if (modelo === "simples") return COLUNAS.filter((c) => c.key === "funcao_padrao");
    if (modelo === "assinatura") return COLUNAS.filter((c) => c.key === "funcao_padrao");
    return COLUNAS.filter((c) => cols[c.key] && (verValores || !c.valor) && !(agrupar && c.key === agrupar));
  }, [modelo, cols, verValores, agrupar]);
  const mostraTotalSal = modelo === "relatorio" && colunas.some((c) => c.key === "salario_base");
  const nCols = 1 + 1 + colunas.length + (modelo === "assinatura" ? 1 : 0);

  const filtroDesc = [
    situacao === "ativos" ? "Ativos" : situacao === "inativos" ? "Inativos" : "Ativos e inativos",
    cargo && `Cargo: ${cargo}`, funcao && `Função: ${funcao}`, busca.trim() && `Busca: “${busca.trim()}”`,
    agrupar && `Agrupado por ${agrupar === "cargo" ? "cargo" : "função"}`,
  ].filter(Boolean).join(" · ");

  const tituloImpresso = titulo.trim()
    || (modelo === "assinatura" ? "Lista de assinatura — colaboradores" : modelo === "simples" ? "Lista de colaboradores" : "Relatório de colaboradores");

  function celula(c: Colab, k: ColKey) {
    switch (k) {
      case "cargo": return c.cargo || <span className="text-gray-300">—</span>;
      case "funcao_padrao": return c.funcao_padrao || <span className="text-gray-300">—</span>;
      case "data_admissao": return c.data_admissao ? formatDate(c.data_admissao) : <span className="text-gray-300">—</span>;
      case "tempo": return tempoDeCasa(c.data_admissao)?.texto ?? <span className="text-gray-300">—</span>;
      case "salario_base": return num(c.salario_base) ? formatCurrency(c.salario_base) : <span className="text-gray-300">—</span>;
      case "custo_hora": return num(c.custo_hora) ? formatCurrency(c.custo_hora) : <span className="text-gray-300">—</span>;
      case "ativo": return c.ativo ? "Ativo" : <span className="text-amber-700">Inativo</span>;
    }
  }
  const direita = (k: ColKey) => k === "salario_base" || k === "custo_hora";

  let seq = 0;

  return (
    <div>
      <style>{`@media print { @page { size: A4 ${paisagem ? "landscape" : "portrait"}; } }`}</style>
      <ReportPrintHeader titulo={tituloImpresso} periodo={`${filtrados.length} colaborador(es)`} subtitulo={filtroDesc} />

      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">👷 Relatório de colaboradores</h1>
          <p className="text-sm text-gray-500">{filtroDesc}</p>
        </div>
        <button className="btn-primary" onClick={() => window.print()}>🖨️ Imprimir / Salvar PDF</button>
      </div>

      {/* filtros */}
      <div className="no-print card mb-3 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <Campo rotulo="Situação">
          <select className="inp" value={situacao} onChange={(e) => setSituacao(e.target.value as any)}>
            <option value="ativos">Só ativos</option>
            <option value="inativos">Só inativos</option>
            <option value="todos">Todos</option>
          </select>
        </Campo>
        <Campo rotulo="Cargo">
          <select className="inp" value={cargo} onChange={(e) => setCargo(e.target.value)}>
            <option value="">Todos</option>
            {cargos.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Função">
          <select className="inp" value={funcao} onChange={(e) => setFuncao(e.target.value)}>
            <option value="">Todas</option>
            {funcoes.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Buscar nome">
          <input className="inp" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome…" />
        </Campo>
        <Campo rotulo="Ordenar por">
          <select className="inp" value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)}>
            <option value="nome">Nome</option>
            <option value="admissao">Admissão (mais antigo)</option>
            {verValores && <option value="salario">Salário (maior)</option>}
          </select>
        </Campo>
        <Campo rotulo="Agrupar por">
          <select className="inp" value={agrupar} onChange={(e) => setAgrupar(e.target.value as Agrupar)}>
            <option value="">Não agrupar</option>
            <option value="cargo">Cargo</option>
            <option value="funcao_padrao">Função</option>
          </select>
        </Campo>
      </div>

      {/* opções de impressão */}
      <div className="no-print card mb-5 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Opções de impressão</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {([
            ["relatorio", "📊 Relatório completo", "colunas à escolha + resumo"],
            ["simples", "📋 Lista simples", "nº, nome e função"],
            ["assinatura", "✍️ Lista de assinatura", "treinamento, EPI, reunião…"],
          ] as [Modelo, string, string][]).map(([k, rot, dica]) => (
            <button key={k} onClick={() => setModelo(k)}
              className={`rounded-lg px-3 py-2 text-left text-sm ring-1 ${modelo === k ? "bg-brand-50 text-brand-700 ring-brand-300" : "bg-white text-gray-700 ring-gray-200 hover:bg-gray-50"}`}>
              <span className="font-medium">{rot}</span>
              <span className="block text-[11px] text-gray-400">{dica}</span>
            </button>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {modelo === "relatorio" ? (
            <div className="lg:col-span-2">
              <p className="mb-1.5 text-xs text-gray-500">Colunas</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {COLUNAS.filter((c) => verValores || !c.valor).map((c) => (
                  <label key={c.key} className="flex items-center gap-1.5 text-sm text-gray-700">
                    <input type="checkbox" checked={cols[c.key]} onChange={(e) => setCols({ ...cols, [c.key]: e.target.checked })} />
                    {c.label}
                  </label>
                ))}
              </div>
              <label className="mt-3 flex items-center gap-1.5 text-sm text-gray-700">
                <input type="checkbox" checked={resumo} onChange={(e) => setResumo(e.target.checked)} />
                Imprimir resumo (totais e quantidade por cargo)
              </label>
            </div>
          ) : (
            <div className="lg:col-span-2 space-y-3">
              <Campo rotulo="Título no papel (opcional)">
                <input className="inp" value={titulo} onChange={(e) => setTitulo(e.target.value)}
                  placeholder={modelo === "assinatura" ? "Ex.: Treinamento NR-12 — 16/10/2026" : "Lista de colaboradores"} />
              </Campo>
              {modelo === "assinatura" && (
                <Campo rotulo="Linhas em branco no final (visitantes / novatos)">
                  <input type="number" min={0} max={30} className="inp !w-24" value={linhasExtras}
                    onChange={(e) => setLinhasExtras(Math.max(0, Math.min(30, +e.target.value || 0)))} />
                </Campo>
              )}
            </div>
          )}
          <div>
            <p className="mb-1.5 text-xs text-gray-500">Orientação da folha</p>
            <div className="flex gap-2">
              <button onClick={() => setPaisagem(false)} className={`rounded-lg px-3 py-1.5 text-sm ring-1 ${!paisagem ? "bg-brand-50 text-brand-700 ring-brand-300" : "ring-gray-200"}`}>▯ Retrato</button>
              <button onClick={() => setPaisagem(true)} className={`rounded-lg px-3 py-1.5 text-sm ring-1 ${paisagem ? "bg-brand-50 text-brand-700 ring-brand-300" : "ring-gray-200"}`}>▭ Paisagem</button>
            </div>
            {modelo === "relatorio" && (
              <Campo rotulo="Título no papel (opcional)" className="mt-3">
                <input className="inp" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Relatório de colaboradores" />
              </Campo>
            )}
          </div>
        </div>
      </div>

      {erro && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      {carregando ? (
        <div className="card px-4 py-16 text-center text-gray-400">Carregando…</div>
      ) : (
        <>
          {/* resumo */}
          {modelo === "relatorio" && (
            <div className={resumo ? "" : "no-print"}>
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Kpi titulo="Colaboradores" valor={String(tot.total)} destaque />
                <Kpi titulo="Ativos" valor={String(tot.ativos)} />
                <Kpi titulo="Inativos" valor={String(tot.inativos)} />
                <Kpi titulo="Tempo médio de casa" valor={tot.tempoMedio == null ? "—" : textoMeses(tot.tempoMedio)} />
                {verValores && <Kpi titulo="Folha base (ativos)" valor={formatCurrency(tot.folha)} />}
                {verValores && <Kpi titulo="Salário médio" valor={formatCurrency(tot.media)} />}
              </div>
              {(tot.semCargo > 0 || (verValores && tot.semSalario > 0)) && (
                <p className="no-print mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  ⚠️ Cadastro incompleto: {tot.semCargo > 0 && `${tot.semCargo} sem cargo`}
                  {tot.semCargo > 0 && verValores && tot.semSalario > 0 && " · "}
                  {verValores && tot.semSalario > 0 && `${tot.semSalario} ativo(s) sem salário base (fora da média)`}.
                </p>
              )}
              {porCargo.length > 1 && (
                <div className="card mb-5 p-4">
                  <h2 className="mb-2 text-sm font-semibold text-gray-700">Ativos por cargo</h2>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-left text-xs uppercase text-gray-400">
                        <th className="py-1.5">Cargo</th>
                        <th className="py-1.5 text-right">Qtd</th>
                        {verValores && <th className="py-1.5 text-right">Folha base</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {porCargo.map(([k, v]) => (
                        <tr key={k}>
                          <td className="py-1.5 text-gray-800">{k}</td>
                          <td className="py-1.5 text-right tabular-nums">{v.qtd}</td>
                          {verValores && <td className="py-1.5 text-right tabular-nums">{v.folha ? formatCurrency(v.folha) : "—"}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* listagem */}
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase text-gray-400">
                  <th className="w-10 px-3 py-2 text-right">Nº</th>
                  <th className="px-3 py-2">Nome</th>
                  {colunas.map((c) => <th key={c.key} className={`px-3 py-2 ${direita(c.key) ? "text-right" : ""}`}>{c.label}</th>)}
                  {modelo === "assinatura" && <th className="w-[38%] px-3 py-2">Assinatura</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtrados.length === 0 && (
                  <tr><td colSpan={nCols} className="px-3 py-12 text-center text-gray-400">Nenhum colaborador com esses filtros.</td></tr>
                )}
                {grupos.map((g) => (
                  <GrupoLinhas key={g.nome || "_"} nome={g.nome} qtd={g.itens.length} nCols={nCols}>
                    {g.itens.map((c) => {
                      seq += 1;
                      return (
                        <tr key={c.id} className={modelo === "assinatura" ? "h-10" : ""}>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-400">{seq}</td>
                          <td className="px-3 py-2 font-medium text-gray-900">{c.nome}</td>
                          {colunas.map((col) => <td key={col.key} className={`px-3 py-2 text-gray-700 ${direita(col.key) ? "text-right tabular-nums" : ""}`}>{celula(c, col.key)}</td>)}
                          {modelo === "assinatura" && <td className="px-3 py-2" />}
                        </tr>
                      );
                    })}
                  </GrupoLinhas>
                ))}
                {modelo === "assinatura" && Array.from({ length: linhasExtras }, (_, i) => (
                  <tr key={"extra" + i} className="h-10">
                    <td className="px-3 py-2 text-right tabular-nums text-gray-400">{filtrados.length + i + 1}</td>
                    <td className="px-3 py-2" /><td className="px-3 py-2" /><td className="px-3 py-2" />
                  </tr>
                ))}
              </tbody>
              {mostraTotalSal && filtrados.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-gray-200 font-semibold">
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2">Total ({filtrados.length})</td>
                    {colunas.map((c) => (
                      <td key={c.key} className={`px-3 py-2 ${direita(c.key) ? "text-right tabular-nums" : ""}`}>
                        {c.key === "salario_base" ? formatCurrency(filtrados.reduce((s, x) => s + num(x.salario_base), 0)) : ""}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {modelo === "assinatura" && (
            <div className="mt-10 grid grid-cols-2 gap-10 text-center text-xs text-gray-600">
              <div className="border-t border-gray-400 pt-1">Responsável</div>
              <div className="border-t border-gray-400 pt-1">Data</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GrupoLinhas({ nome, qtd, nCols, children }: { nome: string; qtd: number; nCols: number; children: React.ReactNode }) {
  return (
    <>
      {nome && (
        <tr className="bg-gray-50">
          <td colSpan={nCols} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
            {nome} <span className="font-normal text-gray-400">· {qtd}</span>
          </td>
        </tr>
      )}
      {children}
    </>
  );
}
function Campo({ rotulo, className = "", children }: { rotulo: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs text-gray-500">{rotulo}</span>
      {children}
    </label>
  );
}
function Kpi({ titulo, valor, destaque }: { titulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ${destaque ? "bg-brand-600 text-white" : "bg-white ring-1 ring-gray-100"}`}>
      <p className={`text-xs ${destaque ? "text-white/80" : "text-gray-400"}`}>{titulo}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{valor}</p>
    </div>
  );
}
