// =============================================================================
// Executor das ferramentas. Ações de negócio rodam com ctx.sb (JWT do usuário)
// — o RLS/pode() barra o que ele não pode. Ferramentas verdes registram uma
// linha em acoes_agente (via ctx.admin, pois a tabela não tem policy de escrita)
// com status 'executada', para o log e o Desfazer. Idempotência pela chave.
// =============================================================================
import type { Acao, Contexto, ResultadoFerramenta } from "./tipos";
import { META, FERRAMENTAS_TAREFA, FERRAMENTAS_LANCAMENTO } from "./ferramentas";
import { indicadoresFinanceiros, checagensFinanceiras, projecaoCaixa, tendenciaFinanceira } from "./financeiro";
import { ehGestao, executarGestao, executarAmarelaGestao, resumoAmarelaGestao, AMARELAS_GESTAO } from "./gestao";

const falta = (campo: string): ResultadoFerramenta => ({ ok: false, erro: `Falta o campo obrigatório: ${campo}` });
const hojeStr = () => new Date().toISOString().slice(0, 10);
const brl = (v: number) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

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

  // Ritmo de Gestão (Bloco 3): trava própria (requisito por ferramenta) + RLS/RPCs.
  // Só existe no chat de gestão.
  if (ehGestao(nome)) {
    if (ctx.modo !== "gestao") return { ok: false, erro: "Ferramenta disponível só no chat de gestão." };
    return executarGestao(nome, p, ctx);
  }

  // Trava de tier (defesa em profundidade; o RLS não limita, pois quase todos
  // são admin). Três níveis: dono executa tudo; gerência cria/mantém tarefas;
  // consulta só leitura. Mesmo que o modelo tente, aqui é barrado.
  if (META[nome]?.faixa !== "leitura" && !ctx.podeAgir) {
    const ehTarefa = ctx.podeTarefas && FERRAMENTAS_TAREFA.has(nome);
    const ehLancamento = !!ctx.podeLancar && FERRAMENTAS_LANCAMENTO.has(nome);
    if (!ehTarefa && !ehLancamento) {
      return {
        ok: false,
        erro: ctx.podeTarefas
          ? "Esta ação (OS/financeiro) é uma determinação do administrador. No seu acesso eu crio e organizo tarefas; OS e caixa são para consulta."
          : "Modo consulta: aqui você só consulta dados. Criar/alterar é feito pelo administrador ou pela gerência.",
      };
    }
  }

  // Amarelas não executam no loop: viram uma proposta pendente (cartão).
  if (META[nome]?.faixa === "amarela" || META[nome]?.faixa === "vermelha") return proporAmarela(nome, p, ctx);

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
      // e-mail e papel entram para desambiguar homônimos (dois "Pedro" na empresa).
      // Exclui o próprio usuário-agente (não é responsável de tarefa/OS).
      const { data, error } = await sb.from("perfis").select("id,nome,email,papel").eq("ativo", true).neq("papel", "agente").limit(100);
      if (error) return { ok: false, erro: error.message };
      const pessoas = (data ?? []) as any[];
      // e-mail antigo pode estar em branco em perfis — completa pelo auth (sempre tem)
      if (pessoas.some((x) => !x.email)) {
        try {
          const { data: lu } = await ctx.admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
          const m = new Map<string, string>();
          for (const u of lu?.users ?? []) if (u.email) m.set(u.id, u.email);
          for (const x of pessoas) if (!x.email) x.email = m.get(x.id) ?? null;
        } catch {
          /* sem e-mail do auth: segue com o que houver em perfis */
        }
      }
      return { ok: true, dados: pessoas };
    }
    case "listar_modelos": {
      const { data, error } = await sb.from("modelos_projeto").select("id,nome,descricao").limit(50);
      return error ? { ok: false, erro: error.message } : { ok: true, dados: data };
    }
    case "listar_empresas": {
      const { data, error } = await sb.from("empresas_consultoras").select("id,nome").limit(50);
      return error ? { ok: false, erro: error.message } : { ok: true, dados: data };
    }

    // ---- FINANCEIRO · leitura (F0) -------------------------------------------
    // Lê sob o RLS do usuário: quem não tem financeiro simplesmente não vê nada.
    case "posicao_caixa": {
      const { data: contas, error } = await sb.from("contas_bancarias").select("nome,saldo_atual").eq("empresa_consultora_id", ctx.empresaId);
      if (error) return { ok: false, erro: error.message };
      const ind = await indicadoresFinanceiros(sb, ctx.empresaId);
      return { ok: true, dados: {
        contas,
        caixa_total: ind.caixa_total,
        a_receber_aberto: ind.a_receber_aberto,
        a_pagar_aberto: ind.a_pagar_aberto,
        vencidos_receber: ind.vencidos_receber,
        vencidos_pagar: ind.vencidos_pagar,
      } };
    }
    case "buscar_titulos": {
      let q = sb.from("titulos_financeiros")
        .select("id,tipo,descricao,valor,vencimento,status,cliente_id,fornecedor_id,categoria_id")
        .eq("empresa_consultora_id", ctx.empresaId)
        .order("vencimento", { ascending: true, nullsFirst: false })
        .limit(50);
      if (p.tipo) q = q.eq("tipo", p.tipo);
      if (p.vencidos) q = q.eq("status", "aberto").lt("vencimento", hojeStr());
      else if (p.status) q = q.eq("status", p.status);
      else q = q.neq("status", "cancelado");
      if (p.texto) {
        const termo = String(p.texto).replace(/[(),]/g, " ").trim();
        if (termo) q = q.ilike("descricao", `%${termo}%`);
      }
      const { data, error } = await q;
      return error ? { ok: false, erro: error.message } : { ok: true, dados: data };
    }
    case "indicadores_financeiros": {
      return { ok: true, dados: await indicadoresFinanceiros(sb, ctx.empresaId) };
    }
    case "dre_resumo": {
      let q = sb.from("vw_dre").select("competencia,grupo_dre,natureza,tipo,total").eq("empresa_consultora_id", ctx.empresaId).order("competencia", { ascending: false }).limit(200);
      if (p.competencia) q = q.eq("competencia", p.competencia);
      const { data, error } = await q;
      return error ? { ok: false, erro: error.message } : { ok: true, dados: data };
    }
    case "conferir_financeiro": {
      return { ok: true, dados: await checagensFinanceiras(sb, ctx.empresaId) };
    }

    // ---- FINANCEIRO · lançamentos por documento (0074) -----------------------
    case "listar_contas": {
      const { data, error } = await sb.from("contas_bancarias").select("id,nome,tipo,saldo_atual").eq("ativo", true).order("nome");
      return error ? { ok: false, erro: error.message } : { ok: true, dados: data };
    }
    case "listar_categorias": {
      const [c, sc] = await Promise.all([
        sb.from("categorias_financeiras").select("id,nome,natureza").eq("ativo", true).order("nome"),
        sb.from("subcategorias_financeiras").select("id,nome,categoria_id").eq("ativo", true).order("nome").range(0, 999),
      ]);
      if (c.error) return { ok: false, erro: c.error.message };
      return { ok: true, dados: { categorias: c.data, subcategorias: sc.data ?? [] } };
    }
    case "buscar_fornecedor": {
      const doc = String(p.documento ?? "").replace(/\D/g, "");
      const termo = String(p.texto ?? "").replace(/[(),%]/g, " ").trim();
      if (!doc && !termo) return falta("documento ou texto");
      const { data, error } = await sb.from("fornecedores").select("id,nome,documento,forma_pagamento").eq("ativo", true).range(0, 4999);
      if (error) return { ok: false, erro: error.message };
      const t = termo.toLowerCase();
      const achados = (data ?? []).filter((f: any) =>
        (doc && String(f.documento ?? "").replace(/\D/g, "") === doc) || (t && String(f.nome ?? "").toLowerCase().includes(t)),
      ).slice(0, 15);
      return { ok: true, dados: achados.length ? achados : { nenhum: true, dica: "Não cadastrado: informe fornecedor_nome e fornecedor_documento no lançamento — ele é cadastrado ao confirmar." } };
    }
    case "candidatos_baixa": {
      if (!p.tipo || typeof p.valor !== "number") return falta("tipo/valor");
      const valores = [p.valor, p.valor_original].filter((v) => typeof v === "number" && v > 0) as number[];
      const dataRef = /^\d{4}-\d{2}-\d{2}$/.test(p.data ?? "") ? p.data : hojeStr();
      const mais = (n: number) => new Date(Date.parse(dataRef) + n * 86400000).toISOString().slice(0, 10);
      let forn: string | null = null;
      const doc = String(p.fornecedor_documento ?? "").replace(/\D/g, "");
      if (doc) {
        const { data: fs } = await sb.from("fornecedores").select("id,documento").range(0, 4999);
        forn = (fs ?? []).find((f: any) => String(f.documento ?? "").replace(/\D/g, "") === doc)?.id ?? null;
      }
      const sel = "id,tipo,descricao,valor,vencimento,status,data_pagamento,fornecedor_id,cliente_id,conta_bancaria_id";
      const [ab, pg] = await Promise.all([
        sb.from("titulos_financeiros").select(sel).eq("tipo", p.tipo).eq("status", "aberto").limit(300)
          .or(`vencimento.is.null,and(vencimento.gte.${mais(-60)},vencimento.lte.${mais(45)})`),
        sb.from("titulos_financeiros").select(sel).eq("tipo", p.tipo).eq("status", "pago")
          .gte("data_pagamento", mais(-5)).lte("data_pagamento", mais(5)).limit(300),
      ]);
      if (ab.error) return { ok: false, erro: ab.error.message };
      const bateValor = (v: number) => valores.some((x) => Math.abs(Number(v) - x) < 0.005);
      const palavras = String(p.texto ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      const bateTexto = (d: string) => palavras.some((w) => String(d ?? "").toLowerCase().includes(w));
      const pontua = (x: any) => (bateValor(x.valor) ? 3 : 0) + (forn && x.fornecedor_id === forn ? 2 : 0) + (bateTexto(x.descricao) ? 1 : 0);
      const em_aberto = (ab.data ?? []).map((x: any) => ({ ...x, pontos: pontua(x) })).filter((x: any) => x.pontos >= 2)
        .sort((a: any, b: any) => b.pontos - a.pontos).slice(0, 8);
      const ja_pagos = (pg.data ?? []).filter((x: any) => bateValor(x.valor) && (!forn || x.fornecedor_id === forn || bateTexto(x.descricao))).slice(0, 5);
      return { ok: true, dados: { fornecedor_id: forn, em_aberto, ja_pagos_parecidos: ja_pagos } };
    }

    // ---- FINANCEIRO · projeções e crescimento (F3) ---------------------------
    case "projecao_caixa": {
      return { ok: true, dados: await projecaoCaixa(sb, ctx.empresaId) };
    }
    case "cenario_caixa": {
      const base = await projecaoCaixa(sb, ctx.empresaId);
      const cenario = await projecaoCaixa(sb, ctx.empresaId, {
        atraso_receber_dias: p.atraso_receber_dias,
        corte_receber_pct: p.corte_receber_pct,
        custo_fixo_novo_mensal: p.custo_fixo_novo_mensal,
        investimento_pontual: p.investimento_pontual,
      });
      return { ok: true, dados: { base, cenario, impacto_90: cenario.saldo_90 - base.saldo_90 } };
    }
    case "tendencia_financeira": {
      const meses = Math.min(24, Math.max(2, Number(p.meses) || 6));
      return { ok: true, dados: await tendenciaFinanceira(sb, ctx.empresaId, meses) };
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

    // ---- FINANCEIRO · verdes (F1) --------------------------------------------
    case "criar_cobranca": {
      if (!p.titulo_id) return falta("titulo_id");
      const { data: t } = await sb.from("titulos_financeiros").select("descricao,valor").eq("id", p.titulo_id).maybeSingle();
      const { data, error } = await sb.from("tarefas").insert({
        titulo: `Cobrar: ${t?.descricao ?? "título a receber"}`,
        descricao: p.observacao ?? null,
        responsavel_id: p.responsavel_id ?? null,
        prioridade: "alta",
        vinculo_tipo: "titulo",
        vinculo_id: p.titulo_id,
        vinculo_rotulo: t ? `${t.descricao} · ${brl(Number(t.valor))}` : null,
      }).select("id,titulo").single();
      if (error) return { ok: false, erro: error.message };
      const acao: Acao = { ferramenta: nome, faixa: "verde", vinculo_tipo: "titulo", vinculo_id: p.titulo_id,
        resumo: `Cobrança criada: ${data.titulo}`, link: `/tarefas/caixa?tarefa=${data.id}`, reversivel: true, resultado: { tarefa_id: data.id } };
      acao.id = await registrar(ctx, acao, p);
      return { ok: true, dados: { tarefa_id: data.id }, acao };
    }
    case "salvar_cenario_caixa": {
      if (!p.nome) return falta("nome");
      const { data, error } = await sb.from("simulacoes_caixa").insert({
        nome: p.nome,
        usar_saldo: p.usar_saldo ?? true,
        filtro_de: p.de ?? null,
        filtro_ate: p.ate ?? null,
        titulo_ids: p.titulo_ids ?? [],
      }).select("id,nome").single();
      if (error) return { ok: false, erro: error.message };
      const acao: Acao = { ferramenta: nome, faixa: "verde", resumo: `Cenário salvo: ${data.nome}`,
        link: `/financeiro`, reversivel: true, resultado: { simulacao_id: data.id } };
      acao.id = await registrar(ctx, acao, p);
      return { ok: true, dados: { simulacao_id: data.id }, acao };
    }

    default:
      return { ok: false, erro: `Ferramenta desconhecida: ${nome}` };
  }
}

// ---- AMARELAS: propor (pendente) e executar (no confirmar) -------------------

export function resumoAmarela(nome: string, p: any): string {
  if (AMARELAS_GESTAO.has(nome)) return resumoAmarelaGestao(nome, p);
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
    case "criar_titulo":
      return `Criar título a ${p.tipo === "receber" ? "receber" : "pagar"}: "${p.descricao}" · ${brl(Number(p.valor))}` + (p.vencimento ? ` · venc ${p.vencimento}` : "") +
        (p.fornecedor_nome && !p.fornecedor_id ? ` · fornecedor ${p.fornecedor_nome}` : "");
    case "alterar_vencimento_titulo":
      return `Reagendar o vencimento do título para ${p.vencimento}`;
    case "baixar_titulo":
      return `DAR BAIXA: "${p.titulo_descricao ?? "título"}" pago em ${p.data_pagamento} · ${brl(Number(p.valor))}` + (p.conta_nome ? ` · conta ${p.conta_nome}` : "");
    case "lancar_pago":
      return `LANÇAR PAGO (${p.tipo === "receber" ? "entrada" : "saída"}): "${p.descricao}" em ${p.data_pagamento} · ${brl(Number(p.valor))}` +
        (p.conta_nome ? ` · conta ${p.conta_nome}` : "") +
        (p.competencia ? ` · comp. ${String(p.competencia).slice(5, 7)}/${String(p.competencia).slice(0, 4)}` : "") +
        (p.fornecedor_nome && !p.fornecedor_id ? ` · fornecedor ${p.fornecedor_nome}` : "");
    default:
      return nome;
  }
}

async function proporAmarela(nome: string, p: any, ctx: Contexto): Promise<ResultadoFerramenta> {
  // pausar OS exige motivo — valida já na proposta (antes só falhava no confirmar)
  if (nome === "mudar_status_os" && p.status === "pausada" && !p.motivo_pausa) {
    return { ok: false, erro: "Para pausar a OS é obrigatório informar o motivo (campo motivo_pausa)." };
  }
  const valor =
    typeof p.valor === "number" ? p.valor
    : typeof p.custo_estimado === "number" ? p.custo_estimado
    : typeof p.custo_unitario === "number" ? p.custo_unitario
    : null;
  const faixa = META[nome].faixa === "vermelha" ? "vermelha" : "amarela";
  // vermelha mexe no saldo: valida o essencial já na proposta
  if (faixa === "vermelha") {
    if (!p.conta_bancaria_id) return { ok: false, erro: "Falta a conta (conta_bancaria_id). Use listar_contas e, se houver mais de uma, pergunte de qual conta saiu/entrou o dinheiro." };
    if (!(Number(p.valor) > 0)) return { ok: false, erro: "Falta o valor pago (maior que zero)." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.data_pagamento ?? "")) return { ok: false, erro: "Falta a data do pagamento (AAAA-MM-DD)." };
  }
  const acao: Acao = {
    ferramenta: nome,
    faixa,
    status: "pendente",
    vinculo_tipo: p.os_id ? "os" : p.titulo_id ? "titulo" : null,
    vinculo_id: p.os_id ?? p.titulo_id ?? null,
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
      faixa,
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

// Ferramentas amarelas financeiras → dispatcher agente_financeiro (NÃO mexem
// em saldo: criar_titulo nasce 'aberto'; vencimento reagenda em aberto).
const ACAO_FIN: Record<string, string> = {
  criar_titulo: "criar_titulo",
  alterar_vencimento_titulo: "vencimento",
  // vermelhas (0074): mexem no saldo, só após o clique da pessoa
  baixar_titulo: "baixar",
  lancar_pago: "criar_pago",
};

// Executa a ação amarela já confirmada, sob o RLS do usuário (ctx.sb). Lê o
// before-image para o Desfazer. Devolve a ação 'executada' com link e resultado.
export async function executarAmarela(
  row: { id: string; ferramenta: string; parametros: any },
  ctx: Contexto,
): Promise<ResultadoFerramenta> {
  const nome = row.ferramenta;
  const p = row.parametros || {};

  if (AMARELAS_GESTAO.has(nome)) return executarAmarelaGestao(row, ctx);

  // Financeiro: cria título 'aberto' ou reagenda vencimento (sob RLS do usuário).
  const pAcaoFin = ACAO_FIN[nome];
  if (pAcaoFin) {
    let antesFin: Record<string, any> | undefined;
    if (nome === "alterar_vencimento_titulo" && p.titulo_id) {
      const { data: t } = await ctx.sb.from("titulos_financeiros").select("vencimento").eq("id", p.titulo_id).maybeSingle();
      antesFin = t ?? undefined;
    }
    if (nome === "baixar_titulo" && p.titulo_id) {
      const { data: t } = await ctx.sb.from("titulos_financeiros")
        .select("status,valor,conta_bancaria_id,forma_pagamento,anexo_caminho").eq("id", p.titulo_id).maybeSingle();
      if (!t) return { ok: false, erro: "Título não encontrado." };
      if (t.status !== "aberto") return { ok: false, erro: `O título já está ${t.status} — nada foi feito.` };
      antesFin = t;
    }
    const { data, error } = await ctx.sb.rpc("agente_financeiro", { p_acao: pAcaoFin, p });
    if (error) return { ok: false, erro: error.message };
    const ids = (data as any) || {};
    const titId = ids.titulo_id ?? p.titulo_id ?? null;
    const acao: Acao = {
      id: row.id,
      ferramenta: nome,
      faixa: META[nome].faixa,
      status: "executada",
      vinculo_tipo: titId ? "titulo" : null,
      vinculo_id: titId,
      resumo: resumoAmarela(nome, p),
      link: "/financeiro",
      reversivel: META[nome].reversivel,
      resultado: { ...ids, antes: antesFin },
    };
    return { ok: true, dados: ids, acao };
  }

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
