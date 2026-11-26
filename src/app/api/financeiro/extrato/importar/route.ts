import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lerOFX, lerCSV, chavesDasLinhas, minData, maxData, type ExtratoLido } from "@/lib/financeiro/extrato";
import { extrairComIA, sugerirConta } from "@/lib/financeiro/conciliacao";

export const maxDuration = 120; // PDF + classificação pela IA

// Importa um extrato para uma conta. OFX/CSV são lidos por regra (sem IA); PDF
// (ou CSV que não deu para entender) vai para a IA. O arquivo grande sobe antes
// para o bucket "anexos" (limite de corpo da Vercel) e aqui chega só o caminho.
// Linhas repetidas (mesma chave na conta) são ignoradas → reimportar é seguro.
export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  const contaId = String(body?.conta_bancaria_id ?? "");
  const nome = String(body?.arquivo_nome ?? "extrato");
  const formatoPedido = String(body?.formato ?? "");
  if (!contaId) return NextResponse.json({ error: "Escolha a conta do extrato." }, { status: 400 });

  // a conta precisa ser visível ao usuário (RLS do financeiro)
  const { data: conta } = await sb.from("contas_bancarias").select("id,nome").eq("id", contaId).maybeSingle();
  if (!conta) return NextResponse.json({ error: "Conta não encontrada ou sem acesso ao financeiro." }, { status: 403 });

  let lido: ExtratoLido;
  let formato: "ofx" | "csv" | "pdf" | "texto";
  try {
    if (formatoPedido === "pdf") {
      const caminho = String(body?.caminho ?? "");
      if (!caminho) return NextResponse.json({ error: "Falta o arquivo PDF." }, { status: 400 });
      const { data: blob, error } = await sb.storage.from("anexos").download(caminho);
      if (error || !blob) return NextResponse.json({ error: "Não consegui abrir o PDF: " + (error?.message ?? "") }, { status: 400 });
      const b64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
      const r = await extrairComIA({ pdfBase64: b64 });
      lido = { ...r, periodo_de: minData(r.linhas), periodo_ate: maxData(r.linhas) };
      formato = "pdf";
    } else {
      const txt = String(body?.conteudo ?? "");
      if (!txt.trim()) return NextResponse.json({ error: "Arquivo vazio." }, { status: 400 });
      if (formatoPedido === "ofx") { lido = lerOFX(txt); formato = "ofx"; }
      else {
        lido = lerCSV(txt); formato = "csv";
        if (!lido.linhas.length) {
          // layout que a regra não entendeu → IA lê o texto
          const r = await extrairComIA({ texto: txt });
          lido = { ...r, periodo_de: minData(r.linhas), periodo_ate: maxData(r.linhas) };
          formato = "texto";
        }
      }
    }
  } catch (e: any) {
    return NextResponse.json({ error: "Falha ao ler o extrato: " + (e?.message ?? String(e)) }, { status: 502 });
  }

  if (!lido.linhas.length) return NextResponse.json({ error: "Não encontrei lançamentos neste arquivo." }, { status: 400 });

  const chaves = chavesDasLinhas(lido.linhas);
  const { data: ja } = await sb.from("extrato_linhas").select("chave").eq("conta_bancaria_id", contaId).in("chave", chaves);
  const existentes = new Set((ja ?? []).map((x) => x.chave));
  const novas = lido.linhas.map((l, i) => ({ l, chave: chaves[i] })).filter((x) => !existentes.has(x.chave));

  const { data: ext, error: eExt } = await sb.from("extratos_importados").insert({
    conta_bancaria_id: contaId, arquivo_nome: nome, formato,
    periodo_de: lido.periodo_de, periodo_ate: lido.periodo_ate, saldo_final: lido.saldo_final,
    linhas_novas: novas.length, linhas_repetidas: lido.linhas.length - novas.length,
  }).select("id").single();
  if (eExt) return NextResponse.json({ error: eExt.message }, { status: 400 });

  for (let i = 0; i < novas.length; i += 500) {
    const { error } = await sb.from("extrato_linhas").upsert(
      novas.slice(i, i + 500).map(({ l, chave }) => ({
        extrato_id: ext.id, conta_bancaria_id: contaId, data: l.data, valor: l.valor,
        descricao: l.descricao, documento: l.documento, chave,
      })),
      { onConflict: "conta_bancaria_id,chave", ignoreDuplicates: true },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  let resumo = { total: 0, vincular: 0, baixar: 0, lancar: 0 };
  try { resumo = await sugerirConta(sb, contaId); } catch { /* as linhas ficam; sugestão pode ser refeita */ }

  return NextResponse.json({
    ok: true, extrato_id: ext.id, formato,
    lidas: lido.linhas.length, novas: novas.length, repetidas: lido.linhas.length - novas.length,
    saldo_final: lido.saldo_final, periodo_de: lido.periodo_de, periodo_ate: lido.periodo_ate,
    sugestoes: resumo,
  });
}
