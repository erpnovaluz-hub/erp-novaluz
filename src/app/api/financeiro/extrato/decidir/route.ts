import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { padraoDescricao } from "@/lib/financeiro/extrato";

export const maxDuration = 60;

type Item = {
  linha_id: string;
  acao: "vincular" | "baixar" | "lancar" | "ignorar" | "reabrir";
  titulo_id?: string | null;
  descricao?: string | null;
  categoria_id?: string | null;
  subcategoria_id?: string | null;
  fornecedor_id?: string | null;
  cliente_id?: string | null;
};

// Confirma (em lote) o que o financeiro marcou na tela de conciliação. É uma
// ação de pessoa, sob o RLS dela. Cada linha é tratada sozinha: uma que falha
// não derruba as outras. 'reabrir' desfaz exatamente o que a linha fez.
export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const itens: Item[] = Array.isArray(body?.itens) ? body.itens.slice(0, 500) : [];
  if (!itens.length) return NextResponse.json({ error: "Nada selecionado." }, { status: 400 });

  const resultados: { linha_id: string; ok: boolean; erro?: string }[] = [];
  for (const it of itens) {
    try {
      await tratar(sb, user.id, it);
      resultados.push({ linha_id: it.linha_id, ok: true });
    } catch (e: any) {
      resultados.push({ linha_id: it.linha_id, ok: false, erro: e?.message ?? String(e) });
    }
  }
  return NextResponse.json({ ok: true, resultados, falhas: resultados.filter((r) => !r.ok).length });
}

async function tratar(sb: any, userId: string, it: Item) {
  const { data: l } = await sb.from("extrato_linhas").select("*").eq("id", it.linha_id).maybeSingle();
  if (!l) throw new Error("Linha não encontrada.");
  const agora = new Date().toISOString();
  const tipo = Number(l.valor) > 0 ? "receber" : "pagar";
  const valor = Math.abs(Number(l.valor));
  const fecha = (campos: Record<string, any>) =>
    sb.from("extrato_linhas").update({ ...campos, decidido_por: userId, decidido_em: agora }).eq("id", l.id).eq("status", "pendente");

  if (it.acao === "reabrir") return reabrir(sb, l);
  if (l.status !== "pendente") throw new Error("Linha já decidida.");

  if (it.acao === "ignorar") {
    const { error } = await fecha({ status: "ignorado" });
    if (error) throw new Error(error.message);
    return;
  }

  if (it.acao === "vincular") {
    const { data: t } = await sb.from("titulos_financeiros").select("id,status,valor").eq("id", it.titulo_id).maybeSingle();
    if (!t || t.status !== "pago") throw new Error("O título para vincular precisa estar pago.");
    const { error } = await fecha({ status: "conciliado", efeito: "vinculo", titulo_id: t.id });
    if (error) throw new Error(error.message);
    return;
  }

  if (it.acao === "baixar") {
    const { data: t } = await sb.from("titulos_financeiros")
      .select("id,status,valor,conta_bancaria_id,data_pagamento,forma_pagamento").eq("id", it.titulo_id).maybeSingle();
    if (!t || t.status !== "aberto") throw new Error("O título não está mais em aberto.");
    const { error: e1 } = await sb.rpc("agente_financeiro", {
      p_acao: "baixar",
      p: { titulo_id: t.id, conta_bancaria_id: l.conta_bancaria_id, data_pagamento: l.data, valor: valor },
    });
    if (e1) throw new Error(e1.message);
    const { error } = await fecha({ status: "conciliado", efeito: "baixa", titulo_id: t.id, antes: t });
    if (error) throw new Error(error.message);
    return;
  }

  if (it.acao === "lancar") {
    const descricao = (it.descricao || l.descricao || (tipo === "pagar" ? "Saída" : "Entrada")).slice(0, 200);
    const { data: r, error: e1 } = await sb.rpc("agente_financeiro", {
      p_acao: "criar_pago",
      p: {
        tipo, descricao, valor, data_pagamento: l.data, conta_bancaria_id: l.conta_bancaria_id,
        categoria_id: it.categoria_id ?? null, subcategoria_id: it.subcategoria_id ?? null,
        fornecedor_id: tipo === "pagar" ? it.fornecedor_id ?? null : null,
        cliente_id: tipo === "receber" ? it.cliente_id ?? null : null,
      },
    });
    if (e1) throw new Error(e1.message);
    const { error } = await fecha({ status: "conciliado", efeito: "lancamento", titulo_id: r?.titulo_id ?? null });
    if (error) throw new Error(error.message);

    // aprende: a mesma descrição de extrato, da próxima vez, já vem classificada
    const padrao = padraoDescricao(l.descricao ?? "");
    if (padrao && (it.categoria_id || it.fornecedor_id || it.cliente_id)) {
      const { data: reg } = await sb.from("regras_conciliacao").select("id,usos").eq("tipo", tipo).eq("padrao", padrao).maybeSingle();
      const campos = {
        descricao, categoria_id: it.categoria_id ?? null, subcategoria_id: it.subcategoria_id ?? null,
        fornecedor_id: tipo === "pagar" ? it.fornecedor_id ?? null : null,
        cliente_id: tipo === "receber" ? it.cliente_id ?? null : null, atualizado_em: agora,
      };
      if (reg) await sb.from("regras_conciliacao").update({ ...campos, usos: (reg.usos ?? 0) + 1 }).eq("id", reg.id);
      else await sb.from("regras_conciliacao").insert({ tipo, padrao, ...campos });
    }
    return;
  }

  throw new Error("Ação desconhecida.");
}

// Desfaz: vínculo só solta; baixa volta o título para aberto como estava
// (o trigger estorna o saldo); lançamento cancela (estorna) e apaga o título.
async function reabrir(sb: any, l: any) {
  if (l.status === "conciliado" && l.titulo_id) {
    if (l.efeito === "baixa") {
      const a = l.antes ?? {};
      const { error } = await sb.from("titulos_financeiros").update({
        status: "aberto", valor: a.valor ?? undefined, conta_bancaria_id: a.conta_bancaria_id ?? null,
        forma_pagamento: a.forma_pagamento ?? null,
      }).eq("id", l.titulo_id).eq("status", "pago");
      if (error) throw new Error(error.message);
    } else if (l.efeito === "lancamento") {
      const { error } = await sb.from("titulos_financeiros").update({ status: "cancelado" }).eq("id", l.titulo_id).eq("status", "pago");
      if (error) throw new Error(error.message);
      await sb.from("titulos_financeiros").delete().eq("id", l.titulo_id).eq("status", "cancelado");
    }
  }
  const { error } = await sb.from("extrato_linhas").update({
    status: "pendente", efeito: null, titulo_id: null, antes: null, decidido_por: null, decidido_em: null,
  }).eq("id", l.id);
  if (error) throw new Error(error.message);
}
