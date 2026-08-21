"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/format";

type Opt = { id: string; nome: string };

export default function ParceladoPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [tipo, setTipo] = useState<"pagar" | "receber">("pagar");
  const [descricao, setDescricao] = useState("");
  const [valorTotal, setValorTotal] = useState("");
  const [numParcelas, setNumParcelas] = useState("1");
  const [primeiroVenc, setPrimeiroVenc] = useState(new Date().toISOString().slice(0, 10));
  const [intervalo, setIntervalo] = useState("30");
  const [fornecedorId, setFornecedorId] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [categoriaId, setCategoriaId] = useState("");

  const [fornecedores, setFornecedores] = useState<Opt[]>([]);
  const [clientes, setClientes] = useState<Opt[]>([]);
  const [categorias, setCategorias] = useState<Opt[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  useEffect(() => {
    (async () => {
      const [f, c, cat] = await Promise.all([
        supabase.from("fornecedores").select("id, nome").order("nome"),
        supabase.from("clientes").select("id, nome").order("nome"),
        supabase.from("categorias_financeiras").select("id, nome").order("ordem"),
      ]);
      setFornecedores(f.data ?? []);
      setClientes(c.data ?? []);
      setCategorias(cat.data ?? []);
    })();
  }, [supabase]);

  // prévia das parcelas
  const preview = useMemo(() => {
    const total = parseFloat(valorTotal);
    const n = parseInt(numParcelas);
    if (isNaN(total) || isNaN(n) || n < 1 || total <= 0) return [];
    const base = Math.round((total / n) * 100) / 100;
    const inter = parseInt(intervalo) || 30;
    const linhas: { i: number; valor: number; venc: string }[] = [];
    let acum = 0;
    const d0 = new Date(primeiroVenc + "T00:00:00");
    for (let i = 1; i <= n; i++) {
      const valor = i < n ? base : Math.round((total - acum) * 100) / 100;
      acum += base;
      const d = new Date(d0);
      d.setDate(d.getDate() + (i - 1) * inter);
      linhas.push({ i, valor, venc: d.toISOString().slice(0, 10) });
    }
    return linhas;
  }, [valorTotal, numParcelas, intervalo, primeiroVenc]);

  async function gravar(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setSalvando(true);
    const { data, error } = await supabase.rpc("gerar_parcelas", {
      p_tipo: tipo,
      p_descricao: descricao,
      p_valor_total: parseFloat(valorTotal),
      p_num_parcelas: parseInt(numParcelas),
      p_primeiro_venc: primeiroVenc,
      p_intervalo_dias: parseInt(intervalo) || 30,
      p_fornecedor: tipo === "pagar" ? fornecedorId || null : null,
      p_cliente: tipo === "receber" ? clienteId || null : null,
      p_categoria: categoriaId || null,
    });
    setSalvando(false);
    if (error) {
      setMsg({ tipo: "erro", texto: error.message });
      return;
    }
    setMsg({ tipo: "ok", texto: `${data} parcela(s) criada(s) com sucesso.` });
    setDescricao("");
    setValorTotal("");
    setNumParcelas("1");
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">📆 Lançamento parcelado</h1>
        <p className="text-sm text-gray-500">Gera vários títulos (contas a pagar/receber) de uma compra/venda parcelada.</p>
      </div>

      <form onSubmit={gravar} className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="lbl">Tipo</label>
            <select className="inp" value={tipo} onChange={(e) => setTipo(e.target.value as any)}>
              <option value="pagar">Despesa (a pagar)</option>
              <option value="receber">Receita (a receber)</option>
            </select>
          </div>
          <div>
            <label className="lbl">Descrição <span className="text-red-500">*</span></label>
            <input className="inp" value={descricao} onChange={(e) => setDescricao(e.target.value)} required placeholder="Ex.: Compra de chapas — Ferragens Silva" />
          </div>

          {tipo === "pagar" ? (
            <div>
              <label className="lbl">Fornecedor</label>
              <select className="inp" value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)}>
                <option value="">—</option>
                {fornecedores.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className="lbl">Cliente</label>
              <select className="inp" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
                <option value="">—</option>
                {clientes.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="lbl">Categoria</label>
            <select className="inp" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
              <option value="">—</option>
              {categorias.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          </div>

          <div>
            <label className="lbl">Valor total <span className="text-red-500">*</span></label>
            <input className="inp" type="number" step="0.01" value={valorTotal} onChange={(e) => setValorTotal(e.target.value)} required />
          </div>
          <div>
            <label className="lbl">Nº de parcelas <span className="text-red-500">*</span></label>
            <input className="inp" type="number" min="1" value={numParcelas} onChange={(e) => setNumParcelas(e.target.value)} required />
          </div>
          <div>
            <label className="lbl">1º vencimento</label>
            <input className="inp" type="date" value={primeiroVenc} onChange={(e) => setPrimeiroVenc(e.target.value)} />
          </div>
          <div>
            <label className="lbl">Intervalo (dias)</label>
            <input className="inp" type="number" value={intervalo} onChange={(e) => setIntervalo(e.target.value)} />
          </div>
        </div>

        {preview.length > 0 && (
          <div className="rounded-lg border border-gray-200">
            <div className="border-b bg-gray-50 px-4 py-2 text-xs font-medium uppercase text-gray-500">
              Prévia — {preview.length} parcela(s), total {formatCurrency(preview.reduce((s, p) => s + p.valor, 0))}
            </div>
            <div className="max-h-56 overflow-y-auto divide-y divide-gray-100 text-sm">
              {preview.map((p) => (
                <div key={p.i} className="flex justify-between px-4 py-1.5">
                  <span className="text-gray-600">Parcela {p.i}/{preview.length} · vence {formatDate(p.venc)}</span>
                  <span className="font-medium">{formatCurrency(p.valor)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {msg && (
          <p className={`text-sm ${msg.tipo === "ok" ? "text-green-600" : "text-red-600"}`}>{msg.texto}</p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => router.push("/e/titulos_financeiros")}>
            Ver títulos
          </button>
          <button className="btn-primary" disabled={salvando || preview.length === 0}>
            {salvando ? "Gerando…" : "Gerar parcelas"}
          </button>
        </div>
      </form>
    </div>
  );
}
