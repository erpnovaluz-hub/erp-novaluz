import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { carregarAcesso } from "@/lib/acessoServidor";
import { podeArea } from "@/lib/permissoes";

export const maxDuration = 60;

// Sugere as etapas (atividades) da OS a partir do escopo da proposta, usando a API da Anthropic.
// A chave fica só no servidor (ANTHROPIC_API_KEY). Os dados são lidos com o login do usuário (RLS).
const MODELO = process.env.IA_MODELO || "claude-opus-5-5";

const FERRAMENTA = {
  name: "plano_os",
  description: "Plano de execução da ordem de serviço, em etapas sequenciais.",
  input_schema: {
    type: "object",
    properties: {
      atividades: {
        type: "array",
        description: "Etapas na ordem de execução (de 3 a 12).",
        items: {
          type: "object",
          properties: {
            descricao: { type: "string", description: "O que fazer, verbo no infinitivo, curto e objetivo (até ~140 caracteres)." },
            setor: { type: "string", description: "Quem executa: Compras, Almoxarifado, Fabricação, Montagem, Elétrica, Logística, Engenharia, Qualidade…" },
            dias: { type: "number", description: "Duração estimada em dias úteis (mínimo 1)." },
          },
          required: ["descricao", "dias"],
        },
      },
      observacao: { type: "string", description: "Riscos ou pontos de atenção para a equipe de campo (1 a 3 frases). Opcional." },
    },
    required: ["atividades"],
  },
};

export async function POST(req: Request) {
  const acesso = await carregarAcesso();
  if (!acesso.perfil) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!podeArea(acesso, "comercial", "ver") || !podeArea(acesso, "os", "editar"))
    return NextResponse.json({ error: "Sem permissão para gerar OS." }, { status: 403 });

  const chave = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!chave) return NextResponse.json({ error: "IA não configurada: falta a variável ANTHROPIC_API_KEY na Vercel." }, { status: 501 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  const id = String(body?.proposta_id ?? "");
  if (!id) return NextResponse.json({ error: "Informe a proposta." }, { status: 400 });

  const supabase = createClient();
  const [{ data: p }, { data: itens }] = await Promise.all([
    supabase.from("propostas").select("numero, objeto, apresentacao, premissas, escopo_desc, prazo_entrega, entrega_frete").eq("id", id).maybeSingle(),
    supabase.from("itens_proposta").select("descricao, referencia, quantidade").eq("proposta_id", id).order("ordem"),
  ]);
  if (!p) return NextResponse.json({ error: "Proposta não encontrada." }, { status: 404 });

  // Valores ficam de fora: a IA só precisa do escopo.
  const escopo = [
    p.objeto && `Objeto: ${p.objeto}`,
    p.escopo_desc && `Escopo: ${p.escopo_desc}`,
    p.premissas && `Premissas e critérios técnicos: ${p.premissas}`,
    p.prazo_entrega && `Prazo de entrega combinado: ${p.prazo_entrega}`,
    p.entrega_frete && `Entrega/frete: ${p.entrega_frete}`,
    (itens ?? []).length && "Itens:\n" + (itens ?? []).map((i: any, n: number) =>
      `${n + 1}. ${i.descricao} (qtd ${Number(i.quantidade)})${i.referencia ? ` — ${i.referencia}` : ""}`).join("\n"),
  ].filter(Boolean).join("\n\n");

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": chave, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 2000,
      system:
        "Você é o planejador de obras de uma empresa brasileira de engenharia, montagem e manutenção (estruturas metálicas, " +
        "elétrica, civil). A partir do escopo vendido, monte o plano de execução da ordem de serviço em etapas práticas para " +
        "a equipe de campo: preparação (medição/conferência de projeto, compra e separação de material), fabricação ou " +
        "preparação, execução/montagem, inspeção e entrega com aceite do cliente. Use só o que o escopo indica — não invente " +
        "serviços que não foram vendidos. Português do Brasil.",
      tools: [FERRAMENTA],
      tool_choice: { type: "tool", name: "plano_os" },
      messages: [{ role: "user", content: `Proposta ${p.numero ?? ""}\n\n${escopo}` }],
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    return NextResponse.json({ error: `IA indisponível (${r.status}): ${t.slice(0, 200)}` }, { status: 502 });
  }
  const j = await r.json();
  const uso = (j.content ?? []).find((c: any) => c.type === "tool_use");
  const atividades = ((uso?.input?.atividades ?? []) as any[])
    .filter((a) => a && String(a.descricao ?? "").trim())
    .slice(0, 20)
    .map((a) => ({ descricao: String(a.descricao).trim(), setor: a.setor ? String(a.setor).trim() : "", dias: Math.max(1, Math.round(Number(a.dias) || 1)) }));
  if (!atividades.length) return NextResponse.json({ error: "A IA não devolveu etapas. Tente de novo." }, { status: 502 });
  return NextResponse.json({ atividades, observacao: uso?.input?.observacao ?? null });
}
