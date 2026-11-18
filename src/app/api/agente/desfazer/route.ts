import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Desfaz uma ação verde recente. A reversão roda sob o RLS do usuário (ele só
// desfaz o que pode tocar); o status em acoes_agente é marcado pelo servidor.
export async function POST(req: Request) {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  const acaoId = String(body?.acao_id ?? "");
  if (!acaoId) return NextResponse.json({ error: "acao_id obrigatório." }, { status: 400 });

  // RLS: o usuário só lê ações próprias (ou gerência)
  const { data: acao } = await sb.from("acoes_agente").select("*").eq("id", acaoId).maybeSingle();
  if (!acao) return NextResponse.json({ error: "Ação não encontrada." }, { status: 404 });
  if (acao.status === "desfeita") return NextResponse.json({ ok: true, ja_desfeita: true });

  const res = acao.resultado ?? {};
  let erro: string | null = null;

  switch (acao.ferramenta) {
    case "criar_tarefa":
      ({ error: erro } = normalizar(await sb.from("tarefas").delete().eq("id", res.tarefa_id)));
      break;
    case "vincular_tarefa":
      ({ error: erro } = normalizar(
        await sb.from("tarefas").update({ vinculo_tipo: null, vinculo_id: null, vinculo_rotulo: null }).eq("id", res.tarefa_id)
      ));
      break;
    case "concluir_tarefa":
      ({ error: erro } = normalizar(await sb.from("tarefas").update({ concluida: false }).eq("id", res.tarefa_id)));
      break;
    case "comentar_tarefa":
      ({ error: erro } = normalizar(await sb.from("tarefa_comentarios").delete().eq("id", res.comentario_id)));
      break;
    // --- amarelas (OS) ---
    case "criar_os":
      ({ error: erro } = normalizar(await sb.from("ordens_servico").delete().eq("id", res.os_id)));
      break;
    case "atribuir_responsavel":
      ({ error: erro } = normalizar(await sb.from("ordens_servico").update({ responsavel_id: res.antes?.responsavel_id ?? null }).eq("id", res.os_id)));
      break;
    case "alterar_prazo_os":
      ({ error: erro } = normalizar(await sb.from("ordens_servico").update({ prazo: res.antes?.prazo ?? null }).eq("id", res.os_id)));
      break;
    case "mudar_status_os":
      ({ error: erro } = normalizar(
        await sb.from("ordens_servico").update({ status: res.antes?.status, motivo_pausa: res.antes?.motivo_pausa ?? null, pausa_obs: res.antes?.pausa_obs ?? null }).eq("id", res.os_id)
      ));
      break;
    case "concluir_os":
      ({ error: erro } = normalizar(await sb.from("ordens_servico").update({ status: res.antes?.status ?? "em_andamento" }).eq("id", res.os_id)));
      if (!erro) {
        // a conclusão abriu a tarefa "Faturar OS"; fecha ela (via service role, pois pode ser de outro responsável)
        const adm = createAdminClient();
        await adm.from("tarefas").update({ concluida: true }).eq("automacao_chave", "faturar:" + res.os_id).eq("concluida", false);
      }
      break;
    case "lancar_apontamento":
      ({ error: erro } = normalizar(await sb.from("os_apontamentos").delete().eq("id", res.apontamento_id)));
      break;
    case "lancar_insumo_os":
      ({ error: erro } = normalizar(await sb.from("insumos_os").delete().eq("id", res.insumo_id)));
      break;
    default:
      return NextResponse.json({ error: "Esta ação não pode ser desfeita." }, { status: 400 });
  }

  if (erro) return NextResponse.json({ error: erro }, { status: 500 });

  const admin = createAdminClient();
  await admin
    .from("acoes_agente")
    .update({ status: "desfeita", decidido_por: user.id, decidido_em: new Date().toISOString() })
    .eq("id", acaoId);

  return NextResponse.json({ ok: true });
}

function normalizar(r: { error: { message: string } | null }): { error: string | null } {
  return { error: r.error ? r.error.message : null };
}
