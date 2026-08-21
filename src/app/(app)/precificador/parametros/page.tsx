"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Row = Record<string, any>;

export default function ParametrosPreco() {
  const supabase = useMemo(() => createClient(), []);
  const [row, setRow] = useState<Row | null>(null);
  const [f, setF] = useState<Row>({});
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: string, v: any) => setF((o) => ({ ...o, [k]: v }));

  useEffect(() => {
    supabase.from("parametros_preco").select("*").maybeSingle().then(({ data }) => {
      setRow(data);
      setF(data ?? { overhead_metodo: "hora", overhead_hora: 0, overhead_perc: 0, impostos_perc: 0, comissao_perc: 0, taxa_cartao_perc: 0, meta_faturamento: 0 });
    });
  }, [supabase]);

  async function salvar() {
    const payload = {
      overhead_metodo: f.overhead_metodo, overhead_hora: Number(f.overhead_hora || 0), overhead_perc: Number(f.overhead_perc || 0),
      impostos_perc: Number(f.impostos_perc || 0), comissao_perc: Number(f.comissao_perc || 0),
      taxa_cartao_perc: Number(f.taxa_cartao_perc || 0), meta_faturamento: Number(f.meta_faturamento || 0),
    };
    const { error } = row?.id
      ? await supabase.from("parametros_preco").update(payload).eq("id", row.id)
      : await supabase.from("parametros_preco").insert(payload);
    setMsg(error ? error.message : "✓ Parâmetros salvos");
    setTimeout(() => setMsg(null), 2500);
  }

  return (
    <div className="max-w-xl">
      <div className="mb-4 flex items-center gap-2 text-sm text-gray-400">
        <Link href="/precificador" className="hover:text-gray-700">Precificador</Link> <span>/</span> <span className="text-gray-600">Parâmetros</span>
      </div>
      <h1 className="mb-4 text-xl font-semibold text-gray-900">⚙️ Parâmetros de precificação</h1>

      <div className="card space-y-4 p-5">
        <div>
          <label className="lbl">Método de overhead</label>
          <select className="inp" value={f.overhead_metodo ?? "hora"} onChange={(e) => set("overhead_metodo", e.target.value)}>
            <option value="hora">Por hora (R$/h × tempo)</option>
            <option value="percentual">Percentual sobre o custo direto</option>
            <option value="nenhum">Não usar overhead</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Overhead R$/hora" k="overhead_hora" f={f} set={set} />
          <Campo label="Overhead % (s/ custo)" k="overhead_perc" f={f} set={set} />
          <Campo label="Impostos % (s/ preço)" k="impostos_perc" f={f} set={set} />
          <Campo label="Comissão % (s/ preço)" k="comissao_perc" f={f} set={set} />
          <Campo label="Taxa cartão % (s/ preço)" k="taxa_cartao_perc" f={f} set={set} />
          <Campo label="Meta faturamento/mês" k="meta_faturamento" f={f} set={set} />
        </div>
        {msg && <p className="text-sm text-green-600">{msg}</p>}
        <button className="btn-primary" onClick={salvar}>Salvar parâmetros</button>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Preço sugerido = (custo direto + overhead) ÷ (1 − margem% − impostos% − comissão% − taxa cartão%). Impostos, comissão e taxa de cartão são % sobre o preço de venda.
      </p>
    </div>
  );
}

function Campo({ label, k, f, set }: { label: string; k: string; f: any; set: (k: string, v: any) => void }) {
  return (
    <div>
      <label className="lbl">{label}</label>
      <input className="inp" type="number" step="any" value={f[k] ?? 0} onChange={(e) => set(k, e.target.value)} />
    </div>
  );
}
