import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enviarParaPerfil } from "@/lib/push";
import { rotuloMudancaStatus } from "@/lib/os";

// Chamado pelo banco (pg_net) a cada notificação nova. Protegido por segredo
// (PUSH_WEBHOOK_SECRET), não por login — por isso o middleware deixa passar.
const ACAO: Record<string, string> = {
  atribuida: "atribuiu a você",
  mencao: "mencionou você",
  comentario: "comentou",
  concluida: "concluiu",
  acompanhar: "incluiu você como acompanhante",
  os_atribuida: "passou para você a OS",
  os_status: "atualizou a OS",
  agente: "avisou (via assistente)",
};

export async function POST(req: Request) {
  // trim: espaço/quebra de linha colados junto (na Vercel ou no config_sistema) não podem travar o envio
  const segredo = process.env.PUSH_WEBHOOK_SECRET?.trim();
  if (!segredo || req.headers.get("x-push-secret")?.trim() !== segredo) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const id = String(body?.notificacao_id ?? "");
  if (!id) return NextResponse.json({ error: "notificacao_id obrigatório" }, { status: 400 });

  try {
    const admin = createAdminClient();
    const { data: n } = await admin.from("notificacoes")
      .select("id, destinatario_id, ator_id, tipo, tarefa_id, os_id, reuniao_id, texto, lida, tarefas(titulo), ordens_servico(numero, titulo)").eq("id", id).maybeSingle();
    if (!n || n.lida) return NextResponse.json({ ok: true, pulado: true });

    let ator = "🤖 Automação";
    if (n.ator_id) {
      const { data: p } = await admin.from("perfis").select("nome, email").eq("id", n.ator_id).maybeSingle();
      ator = (p?.nome || p?.email || "Alguém").split(" ")[0];
    }
    const osInfo = (n as any).ordens_servico as { numero: string | null; titulo: string } | null;
    const titulo = n.os_id
      ? [osInfo?.numero, osInfo?.titulo].filter(Boolean).join(" · ") || "uma OS"
      : (n as any).tarefas?.titulo ?? "uma tarefa";
    const trecho = (n.tipo === "mencao" || n.tipo === "comentario") && n.texto ? `\n“${n.texto}”`
      : n.tipo === "os_status" && n.texto?.includes("→") ? ` → ${rotuloMudancaStatus(n.texto)}` : "";
    // Avisos do assistente (incl. "o meu dia" e o briefing do Maestro) carregam o
    // próprio texto no push — não têm tarefa/OS para resumir.
    const ehAgente = n.tipo === "agente";
    // Avisos de reunião (convite, ata fechada, sugestão de pauta) também levam o próprio texto.
    const ehReuniao = n.tipo === "reuniao";
    const reuniaoId = (n as any).reuniao_id as string | null;
    const r = await enviarParaPerfil(admin, n.destinatario_id, {
      title: ehReuniao ? `📅 Reunião · ${ator}` : ehAgente ? (n.ator_id ? ator : "Assistente") : `${ator} ${ACAO[n.tipo] ?? "atualizou"}`,
      body: ehAgente || ehReuniao ? (n.texto || "Você tem um novo aviso.") : `${titulo}${trecho}`,
      url: reuniaoId ? `/gestao/reunioes/${reuniaoId}` : n.os_id ? `/os/${n.os_id}` : n.tarefa_id ? `/tarefas/caixa?tarefa=${n.tarefa_id}` : "/tarefas/caixa",
      tag: reuniaoId ?? n.os_id ?? n.tarefa_id ?? n.id,
    }, new URL(req.url).origin);
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
