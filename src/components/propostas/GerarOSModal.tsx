"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useEquipe } from "@/components/tarefas/comum";

type Ativ = { descricao: string; setor: string; dias: number };
type Row = Record<string, any>;

const ETAPAS_PADRAO: Ativ[] = [
  { descricao: "Conferir projeto e medir em campo", setor: "Engenharia", dias: 1 },
  { descricao: "Comprar e separar o material", setor: "Compras", dias: 3 },
  { descricao: "Fabricar / preparar", setor: "Fabricação", dias: 3 },
  { descricao: "Executar / montar no local", setor: "Montagem", dias: 3 },
  { descricao: "Inspecionar, limpar e entregar com aceite do cliente", setor: "Qualidade", dias: 1 },
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// soma dias úteis (pula sábado e domingo)
function somarUteis(base: Date, n: number) {
  const d = new Date(base);
  let falta = n;
  while (falta > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) falta--; }
  return d;
}
function proximoUtil(d: Date) { const x = new Date(d); while (x.getDay() === 0 || x.getDay() === 6) x.setDate(x.getDate() + 1); return x; }

// Cria a OS a partir da proposta: título, cliente, valor e etapas (dos itens ou padrão).
export default function GerarOSModal({ prop, itens, onClose }: { prop: Row; itens: Row[]; onClose: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { pessoas } = useEquipe();
  const [titulo, setTitulo] = useState(() => (prop.objeto || itens[0]?.descricao || `OS da ${prop.numero ?? "proposta"}`).slice(0, 120));
  const [inicio, setInicio] = useState(iso(proximoUtil(new Date())));
  const [resp, setResp] = useState("");
  const [local, setLocal] = useState("");
  const [ativs, setAtivs] = useState<Ativ[]>(() =>
    itens.length ? itens.map((i) => ({ descricao: String(i.descricao), setor: "", dias: 1 })) : ETAPAS_PADRAO);
  const [existentes, setExistentes] = useState<Row[]>([]);
  const [contratoId, setContratoId] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("ordens_servico").select("id, numero, titulo").eq("proposta_id", prop.id).then(({ data }) => setExistentes(data ?? []));
    supabase.from("contratos").select("id").eq("proposta_id", prop.id).limit(1).then(({ data }) => setContratoId(data?.[0]?.id ?? null));
  }, [supabase, prop.id]);

  // datas de cada etapa em sequência, a partir do início
  const datas = useMemo(() => {
    let cur = proximoUtil(new Date(inicio + "T00:00:00"));
    return ativs.map((a) => {
      const ini = cur;
      const fim = somarUteis(ini, Math.max(1, a.dias) - 1);
      cur = proximoUtil(somarUteis(fim, 1));
      return { ini: iso(ini), fim: iso(fim) };
    });
  }, [ativs, inicio]);
  const prazo = datas.length ? datas[datas.length - 1].fim : inicio;

  const mudar = (i: number, campos: Partial<Ativ>) => setAtivs((l) => l.map((a, k) => (k === i ? { ...a, ...campos } : a)));
  const mover = (i: number, d: number) => setAtivs((l) => {
    const j = i + d; if (j < 0 || j >= l.length) return l;
    const c = [...l]; [c[i], c[j]] = [c[j], c[i]]; return c;
  });

  async function criar() {
    const lista = ativs.map((a, k) => ({ ...a, ...datas[k] })).filter((a) => a.descricao.trim());
    if (!titulo.trim()) { setErro("Informe o título da OS."); return; }
    setSalvando(true); setErro(null);
    const como = [prop.escopo_desc, ...itens.map((i) => i.referencia ? `• ${i.descricao}: ${i.referencia}` : null)].filter(Boolean).join("\n");
    const { data: os, error } = await supabase.from("ordens_servico").insert({
      titulo: titulo.trim(), cliente_id: prop.cliente_id, proposta_id: prop.id, contrato_id: contratoId,
      motivo: `Proposta ${prop.numero ?? ""} aprovada`.trim(), local: local.trim() || null,
      como_sera_feito: como || prop.objeto || null, prazo, status: "a_fazer",
      responsavel_id: resp || null, valor_venda: prop.valor_total ?? null,
    }).select("id").single();
    if (error) { setSalvando(false); setErro(error.message); return; }
    if (lista.length) {
      const { error: e2 } = await supabase.from("atividades_os").insert(lista.map((a) => ({
        os_id: os.id, descricao: a.descricao.trim(), setor: a.setor.trim() || null,
        data_inicio: a.ini ?? null, data_fim: a.fim ?? null, status: "nao_iniciado",
      })));
      if (e2) { setSalvando(false); setErro(`OS criada, mas as atividades falharam: ${e2.message}`); router.push(`/os/${os.id}`); return; }
    }
    router.push(`/os/${os.id}`);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">🛠 Gerar OS da proposta {prop.numero}</h2>
            <p className="text-sm text-gray-500">Confira as etapas antes de criar. Tudo pode ser editado depois na OS.</p>
          </div>
          <button className="text-gray-400 hover:text-gray-700" onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        {existentes.length > 0 && (
          <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            Esta proposta já tem OS: {existentes.map((o) => (
              <a key={o.id} href={`/os/${o.id}`} className="font-medium underline">{o.numero || o.titulo}</a>
            )).reduce((a: any[], b, i) => (i ? [...a, ", ", b] : [b]), [])}. Criar outra mesmo assim?
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2"><span className="lbl">Título da OS</span>
            <input className="inp" value={titulo} onChange={(e) => setTitulo(e.target.value)} /></label>
          <label className="block"><span className="lbl">Responsável</span>
            <select className="inp" value={resp} onChange={(e) => setResp(e.target.value)}>
              <option value="">— definir depois —</option>
              {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome || p.email}</option>)}
            </select></label>
          <label className="block"><span className="lbl">Local</span>
            <input className="inp" value={local} onChange={(e) => setLocal(e.target.value)} placeholder="obra / endereço" /></label>
          <label className="block"><span className="lbl">Início</span>
            <input type="date" className="inp" value={inicio} onChange={(e) => setInicio(e.target.value)} /></label>
          <div><span className="lbl">Prazo (fim da última etapa)</span><p className="py-2 text-sm font-medium text-gray-800">{prazo.split("-").reverse().join("/")}</p></div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Etapas ({ativs.length})</h3>
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost text-xs ring-1 ring-gray-200" onClick={() => { setAtivs(itens.map((i) => ({ descricao: String(i.descricao), setor: "", dias: 1 }))); }} disabled={!itens.length}>dos itens</button>
            <button className="btn-ghost text-xs ring-1 ring-gray-200" onClick={() => { setAtivs(ETAPAS_PADRAO); }}>etapas padrão</button>
          </div>
        </div>

        <ol className="mt-2 space-y-2">
          {ativs.map((a, i) => (
            <li key={i} className="rounded-lg border p-2">
              <div className="flex items-start gap-2">
                <span className="mt-2 w-5 shrink-0 text-right text-xs text-gray-400">{i + 1}.</span>
                <textarea className="inp min-h-[38px] flex-1 py-1.5 text-sm" rows={1} value={a.descricao} onChange={(e) => mudar(i, { descricao: e.target.value })} />
                <div className="flex shrink-0 flex-col">
                  <button className="px-1 text-xs text-gray-400 hover:text-gray-700" onClick={() => mover(i, -1)} aria-label="Subir">▲</button>
                  <button className="px-1 text-xs text-gray-400 hover:text-gray-700" onClick={() => mover(i, 1)} aria-label="Descer">▼</button>
                </div>
                <button className="mt-1.5 px-1 text-red-400 hover:text-red-600" onClick={() => setAtivs((l) => l.filter((_, k) => k !== i))} aria-label="Remover">✕</button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-7 text-xs text-gray-500">
                <input className="inp w-36 py-1 text-xs" placeholder="setor" value={a.setor} onChange={(e) => mudar(i, { setor: e.target.value })} />
                <input type="number" min={1} className="inp w-16 py-1 text-xs" value={a.dias} onChange={(e) => mudar(i, { dias: Math.max(1, Number(e.target.value) || 1) })} />
                <span>dia(s) úteis · {datas[i]?.ini.split("-").reverse().slice(0, 2).join("/")} → {datas[i]?.fim.split("-").reverse().slice(0, 2).join("/")}</span>
              </div>
            </li>
          ))}
        </ol>
        <button className="mt-2 text-sm text-brand-600 hover:underline" onClick={() => setAtivs((l) => [...l, { descricao: "", setor: "", dias: 1 }])}>+ etapa</button>

        {erro && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{erro}</p>}

        <div className="mt-5 flex justify-end gap-2 border-t pt-4">
          <button className="btn-ghost text-sm" onClick={onClose}>Cancelar</button>
          <button className="btn-primary text-sm" onClick={criar} disabled={salvando}>{salvando ? "Criando…" : "Criar OS"}</button>
        </div>
      </div>
    </div>
  );
}
