// =============================================================================
// Executor das ferramentas. Ações de negócio rodam com ctx.sb (JWT do usuário)
// — o RLS/pode() barra o que ele não pode. Ferramentas verdes registram uma
// linha em acoes_agente (via ctx.admin, pois a tabela não tem policy de escrita)
// com status 'executada', para o log e o Desfazer. Idempotência pela chave.
// =============================================================================
import type { Acao, Contexto, ResultadoFerramenta } from "./tipos";
import { META } from "./ferramentas";

const falta = (campo: string): ResultadoFerramenta => ({ ok: false, erro: `Falta o campo obrigatório: ${campo}` });

// grava a ação executada e devolve o id (para o Desfazer)
async function registrar(ctx: Contexto, acao: Acao, parametros: any): Promise<string | undefined> {
  const { data } = await ctx.admin
    .from("acoes_agente")
    .insert({
      empresa_consultora_id: ctx.empresaId,
      agente: "chat",
      solicitante_id: ctx.usuarioId,
      conversa_id: ctx.conversaId,
      ferramenta: acao.ferramenta,
      parametros,
      vinculo_tipo: acao.vinculo_tipo ?? null,
      vinculo_id: acao.vinculo_id ?? null,
      faixa: acao.faixa,
      status: "executada",
      resultado: acao.resultado ?? null,
      chave_idempotencia: parametros?.chave_idempotencia ?? null,
    })
    .select("id")
    .single();
  return data?.id;
}

export async function executar(nome: string, input: any, ctx: Contexto): Promise<ResultadoFerramenta> {
  const p = input || {};
  const sb = ctx.sb;

  // Amarelas não executam no loop: viram uma proposta pendente (cartão).
  if (META[nome]?.faixa === "amarela") return proporAmarela(nome, p, ctx);

  switch (nome) {
    // ---- LEITURA -------------------------------------------------------------
    case "buscar_tarefas": {
      let q = sb.from("vw_tarefas").select("id,titulo,prazo,prioridade,concluida,responsavel_id,vinculo_tipo,vinculo_id,vinculo_rotulo").limit(20);
      if (p.apenas_abertas !== false) q = q.eq("concluida", false);
      if (p.texto) q = q.ilike("titulo", `%${p.texto}%`);
      if (p.responsavel_id) q = q.eq("responsavel_id", p.responsavel_id);
      if (p.vinculo_tipo) q = q.eq("vinculo_tipo", p.vinculo_tipo);
      if (p.vinculo_id) q = q.eq("vinculo_id", p.vinculo_id);
      const { data, error } = await q;
      return error ? { ok: false, erro: error.message } : { ok: true, dados: data };
    }
    case "buscar_os": {
      let q = sb.from("ordens_servico").select("id,numero,titulo,status,responsavel_id,prazo").limit(20);
      if (p.texto) {
        // vírgula e parênteses são delimitadores do .or() do PostgREST — removê-los evita quebrar a consulta
        const termo = String(p.texto).replace(/[(),]/g, " ").trim();
        if (termo) q = q.or(`titulo.ilike.%${termo}%,numero.ilike.%${termo}%`);
      }
      if (p.status) q = q.eq("status", p.status);
      const { data, error } = await q;
      return error ? { ok: false, erro: error.message } : { ok: true, dados: data };
    }
    case "listar_projetos": {
      const { data, error } = await sb.from("projetos").select("id,nome,privado,arquivado").eq("arquivado", false).limit(50);
      return error ? { ok: false, erro: error.message } : { ok: true, dados: data };
    }
    case "listar_pessoas": {
      const { data, error } = await sb.from("perfis").select("id,nome,papel,ativo").eq("ativo", true).limit(100);
      return error ? { ok: false, erro: error.message } : { ok: true, dados: data };
    }
    case "listar_modelos": {
      const { data, error } = await sb.from("modelos_projeto").select("id,nome,descricao").limit(50);
      return error ? { ok: false, erro: error.message } : { ok: true, dados: data };
    }

    // ---- VERDES --------------------------------------------------------------
    case "criar_tarefa": {
      if (!p.titulo) return falta("titulo");
      // idempotência: mesma chave já executada → devolve a ação anterior
      if (p.chave_idempotencia) {
        const { data: ja } = await ctx.admin
          .from("acoes_agente")
          .select("id,resultado")
          .eq("empresa_consultora_id", ctx.empresaId)
          .eq("chave_idempotencia", p.chave_idempotencia)
          .eq("status", "executada")
          .maybeSingle();
        if (ja) {
          return { ok: true, dados: { repetida: true }, acao: {
            id: ja.id, ferramenta: nome, faixa: "verde", resumo: "Tarefa já existia (pedido repetido)",
            link: ja.resultado?.tarefa_id ? `/tarefas/caixa?tarefa=${ja.resultado.tarefa_id}` : null, reversivel: false,
            resultado: ja.resultado,
          } };
        }
      }
      const { data, error } = await sb.from("tarefas").insert({
        titulo: p.titulo, descricao: p.descricao ?? null, prazo: p.prazo ?? null,
        prioridade: p.prioridade ?? "media", responsavel_id: p.responsavel_id ?? null,
        projeto_id: p.projeto_id ?? null, vinculo_tipo: p.vinculo_tipo ?? null,
        vinculo_id: p.vinculo_id ?? null, vinculo_rotulo: p.vinculo_rotulo ?? null,
      }).select("id,titulo").single();
      if (error) return { ok: false, erro: error.message };
      const acao: Acao = {
        ferramenta: nome, faixa: "verde", vinculo_tipo: p.vinculo_tipo ?? null, vinculo_id: p.vinculo_id ?? null,
        resumo: `Tarefa criada: ${data.titulo}`, link: `/tarefas/caixa?tarefa=${data.id}`,
        reversivel: true, resultado: { tarefa_id: data.id },
      };
      acao.id = await registrar(ctx, acao, p);
      return { ok: true, dados: { tarefa_id: data.id }, acao };
    }
    case "atualizar_tarefa": {
      if (!p.tarefa_id) return falta("tarefa_id");
      const campos: any = {};
      for (const k of ["prazo", "prioridade", "descricao", "responsavel_id"]) if (p[k] !== undefined) campos[k] = p[k];
      if (Object.keys(campos).length === 0) return { ok: false, erro: "Nada para atualizar" };
      const { data, error } = await sb.from("tarefas").update(campos).eq("id", p.tarefa_id).select("id,titulo").single();
      if (error) return { ok: false, erro: error.message };
      const acao: Acao = { ferramenta: nome, faixa: "verde", resumo: `Tarefa atualizada: ${data.titulo}`,
        link: `/tarefas/caixa?tarefa=${data.id}`, reversivel: META[nome].reversivel, resultado: { tarefa_id: data.id } };
      acao.id = await registrar(ctx, acao, p);
      return { ok: true, dados: { tarefa_id: data.id }, acao };
    }
    case "vincular_tarefa": {
      if (!p.tarefa_id) return falta("tarefa_id");
      if (!p.vinculo_tipo || !p.vinculo_id) return falta("vinculo_tipo/vinculo_id");
      const { data, error } = await sb.from("tarefas")
        .update({ vinculo_tipo: p.vinculo_tipo, vinculo_id: p.vinculo_id, vinculo_rotulo: p.vinculo_rotulo ?? null })
        .eq("id", p.tarefa_id).select("id,titulo").single();
      if (error) return { ok: false, erro: error.message };
      const acao: Acao = { ferramenta: nome, faixa: "verde", vinculo_tipo: p.vinculo_tipo, vinculo_id: p.vinculo_id,
        resumo: `Tarefa vinculada: ${data.titulo}`, link: `/tarefas/caixa?tarefa=${data.id}`,
        reversivel: true, resultado: { tarefa_id: data.id } };
      acao.id = await registrar(ctx, acao, p);
      return { ok: true, dados: { tarefa_id: data.id }, acao };
    }
    case "concluir_tarefa": {
      if (!p.tarefa_id) return falta("tarefa_id");
      const { data, error } = await sb.from("tarefas").update({ concluida: true }).eq("id", p.tarefa_id).select("id,titulo").single();
      if (error) return { ok: false, erro: error.message };
      const acao: Acao = { ferramenta: nome, faixa: "verde", resumo: `Tarefa concluída: ${data.titulo}`,
        link: `/tarefas/caixa?tarefa=${data.id}`, reversivel: true, resultado: { tarefa_id: data.id } };
      acao.id = await registrar(ctx, acao, p);
      return { ok: true, dados: { tarefa_id: data.id }, acao };
    }
    case "comentar_tarefa": {
      if (!p.tarefa_id) return falta("tarefa_id");
      if (!p.texto) return falta("texto");
      const { data, error } = await sb.from("tarefa_comentarios")
        .insert({ tarefa_id: p.tarefa_id, texto: p.texto, mencoes: p.mencoes ?? [] }).select("id").single();
      if (error) return { ok: false, erro: error.message };
      const acao: Acao = { ferramenta: nome, faixa: "verde", resumo: "Comentário adicionado",
        link: `/tarefas/caixa?tarefa=${p.tarefa_id}`, reversivel: true, resultado: { comentario_id: data.id } };
      acao.id = await registrar(ctx, acao, p);
      return { ok: true, dados: { comentario_id: data.id }, acao };
    }
    case "notificar_usuario": {
      if (!p.dest_id) return falta("dest_id");
      if (!p.texto) return falta("texto");
      const { data, error } = await sb.rpc("agente_notificar", {
        p_dest: p.dest_id, p_texto: p.texto, p_tarefa: p.tarefa_id ?? null, p_os: p.os_id ?? null,
      });
      if (error) return { ok: false, erro: error.message };
      const acao: Acao = { ferramenta: nome, faixa: "verde", resumo: "Aviso enviado",
        link: null, reversivel: false, resultado: { notificacao_id: data } };
      acao.id = await registrar(ctx, acao, p);
      return { ok: true, dados: { notificacao_id: data }, acao };
    }
    case "criar_projeto_de_modelo": {
      if (!p.modelo_id) return falta("modelo_id");
      if (!p.nome) return falta("nome");
      const { data, error } = await sb.rpc("criar_projeto_de_modelo", {
        p_modelo: p.modelo_id, p_nome: p.nome, p_privado: p.privado ?? false,
        ...(p.data_base ? { p_data_base: p.data_base } : {}),
      });
      if (error) return { ok: false, erro: error.message };
      const acao: Acao = { ferramenta: nome, faixa: "verde", resumo: `Projeto criado: ${p.nome}`,
        link: `/tarefas/projetos/${data}`, reversivel: false, resultado: { projeto_id: data } };
      acao.id = await registrar(ctx, acao, p);
      return { ok: true, dados: { projeto_id: data }, acao };
    }

    default:
      return { ok: false, erro: `Ferramenta desconhecida: ${nome}` };
  }
}

// ---- AMARELAS: propor (pendente) e executar (no confirmar) -------------------

export function resumoAmarela(nome: string, p: any): string {
  switch (nome) {
    case "criar_os":
      return `Criar OS: "${p.titulo}"` + (p.prazo ? ` · prazo ${p.prazo}` : "") + (p.custo_estimado ? ` · R$ ${p.custo_estimado}` : "");
    case "atribuir_responsavel":
      return "Definir o responsável da OS";
    case "alterar_prazo_os":
      return `Mudar o prazo da OS para ${p.prazo}`;
    case "mudar_status_os":
      return `Mudar o status da OS para ${p.status}` + (p.motivo_pausa ? ` (${p.motivo_pausa})` : "");
    case "lancar_apontamento":
      return `Lançar ${p.horas}h (${p.tipo || "normal"}) na OS`;
    case "lancar_insumo_os":
      return `Lançar insumo: ${p.descricao} × ${p.quantidade ?? 1}`;
    case "concluir_os":
      return "Concluir a OS (abre a tarefa de faturar)";
    default:
      return nome;
  }
}

async function proporAmarela(nome: string, p: any, ctx: Contexto): Promise<ResultadoFerramenta> {
  // pausar OS exige motivo — valida já na proposta (antes só falhava no confirmar)
  if (nome === "mudar_status_os" && p.status === "pausada" && !p.motivo_pausa) {
    return { ok: false, erro: "Para pausar a OS é obrigatório informar o motivo (campo motivo_pausa)." };
  }
  const valor = typeof p.custo_estimado === "number" ? p.custo_estimado : typeof p.custo_unitario === "number" ? p.custo_unitario : null;
  const acao: Acao = {
    ferramenta: nome,
    faixa: "amarela",
    status: "pendente",
    vinculo_tipo: p.os_id ? "os" : null,
    vinculo_id: p.os_id ?? null,
    resumo: resumoAmarela(nome, p),
    parametros: p,
    valor,
    reversivel: META[nome].reversivel,
  };
  const { data, error } = await ctx.admin
    .from("acoes_agente")
    .insert({
      empresa_consultora_id: ctx.empresaId,
      agente: "chat",
      solicitante_id: ctx.usuarioId,
      conversa_id: ctx.conversaId,
      ferramenta: nome,
      parametros: p,
      vinculo_tipo: acao.vinculo_tipo,
      vinculo_id: acao.vinculo_id,
      faixa: "amarela",
      status: "pendente",
      justificativa: resumoAmarela(nome, p),
    })
    .select("id")
    .single();
  if (error) return { ok: false, erro: error.message };
  acao.id = data.id;
  return {
    ok: true,
    dados: { pendente: true, mensagem: "Proposta registrada. Aguardando o usuário confirmar no cartão — não repita a proposta." },
    acao,
  };
}

// Mapeia a ferramenta amarela para a ação do dispatcher agente_os.
const ACAO_OS: Record<string, string> = {
  criar_os: "criar",
  atribuir_responsavel: "responsavel",
  alterar_prazo_os: "prazo",
  mudar_status_os: "status",
  concluir_os: "concluir",
  lancar_apontamento: "apontamento",
  lancar_insumo_os: "insumo",
};

// Executa a ação amarela já confirmada, sob o RLS do usuário (ctx.sb). Lê o
// before-image para o Desfazer. Devolve a ação 'executada' com link e resultado.
export async function executarAmarela(
  row: { id: string; ferramenta: string; parametros: any },
  ctx: Contexto,
): Promise<ResultadoFerramenta> {
  const nome = row.ferramenta;
  const p = row.parametros || {};
  const pAcao = ACAO_OS[nome];
  if (!pAcao) return { ok: false, erro: `Ação amarela desconhecida: ${nome}` };

  // before-image
  let antes: Record<string, any> | undefined;
  if (p.os_id && nome !== "criar_os" && nome !== "lancar_apontamento" && nome !== "lancar_insumo_os") {
    const { data: os } = await ctx.sb.from("ordens_servico").select("status,motivo_pausa,pausa_obs,prazo,responsavel_id").eq("id", p.os_id).maybeSingle();
    antes = os ?? undefined;
  }

  const { data, error } = await ctx.sb.rpc("agente_os", { p_acao: pAcao, p });
  if (error) return { ok: false, erro: error.message };

  const ids = (data as any) || {};
  const osId = ids.os_id ?? p.os_id ?? null;
  const resultado = { ...ids, antes };
  const acao: Acao = {
    id: row.id,
    ferramenta: nome,
    faixa: "amarela",
    status: "executada",
    vinculo_tipo: osId ? "os" : null,
    vinculo_id: osId,
    resumo: resumoAmarela(nome, p),
    link: osId ? `/os/${osId}` : null,
    reversivel: META[nome].reversivel,
    resultado,
  };
  return { ok: true, dados: ids, acao };
}
