-- ERP NOVALUZ — SETUP COMPLETO (0001..0028)


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0001_core.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM NOVALUZ — 0001 NÚCLEO UNIVERSAL
-- PostgreSQL / Supabase · snake_case · multi-tenant por empresa_consultora_id
-- =============================================================================

create extension if not exists pgcrypto;

-- TENANT ----------------------------------------------------------------------
create table if not exists empresas_consultoras (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  documento     text,
  ativo         boolean not null default true,
  data_cadastro timestamptz not null default now()
);

-- PERFIS: liga auth.users -> tenant (base do RLS multi-tenant) -----------------
create table if not exists perfis (
  id                    uuid primary key references auth.users(id) on delete cascade,
  empresa_consultora_id uuid not null references empresas_consultoras(id),
  nome                  text,
  papel                 text not null default 'membro',   -- admin|membro
  criado_em             timestamptz not null default now()
);

-- helper: tenant do usuário logado
create or replace function auth_empresa_id()
returns uuid
language sql stable
security definer
set search_path = public
as $$
  select empresa_consultora_id from perfis where id = auth.uid()
$$;

-- CLIENTES --------------------------------------------------------------------
create table if not exists clientes (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  nome                  text not null,
  segmento              text,
  origem                text,
  status                text not null default 'ativo',
  data_cadastro         timestamptz not null default now(),
  responsavel_comercial text,
  nivel_relacionamento  text
);

-- CONTATOS --------------------------------------------------------------------
create table if not exists contatos (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  cliente_id            uuid not null references clientes(id) on delete cascade,
  nome                  text not null,
  cargo                 text,
  telefone              text,
  email                 text,
  e_decisor             boolean not null default false
);

-- INTERACOES ------------------------------------------------------------------
create table if not exists interacoes (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  cliente_id            uuid not null references clientes(id) on delete cascade,
  contato_id            uuid references contatos(id) on delete set null,
  data                  timestamptz not null default now(),
  tipo                  text not null check (tipo in ('ligacao','visita','whatsapp','email','reuniao')),
  resumo                text,
  proximo_passo         text,
  responsavel           text
);

-- OPORTUNIDADES ---------------------------------------------------------------
create table if not exists oportunidades (
  id                        uuid primary key default gen_random_uuid(),
  empresa_consultora_id     uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  cliente_id                uuid not null references clientes(id) on delete cascade,
  titulo                    text not null,
  valor_estimado            numeric(14,2),
  etapa                     text not null default 'prospeccao'
                              check (etapa in ('prospeccao','proposta_enviada','negociacao','fechado_ganho','fechado_perdido')),
  probabilidade             numeric(5,2),
  data_prevista_fechamento  date,
  origem                    text,
  motivo_perda              text,
  atualizado_em             timestamptz not null default now()
);

-- PROPOSTAS -------------------------------------------------------------------
create table if not exists propostas (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  oportunidade_id       uuid not null references oportunidades(id) on delete cascade,
  numero                text,
  data                  date not null default current_date,
  valor                 numeric(14,2),
  validade              date,
  versao                integer not null default 1,
  status                text not null default 'rascunho' check (status in ('rascunho','enviada','aprovada','recusada'))
);

-- CONTRATOS -------------------------------------------------------------------
create table if not exists contratos (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  cliente_id            uuid not null references clientes(id) on delete cascade,
  proposta_id           uuid references propostas(id) on delete set null,
  numero                text,
  data_inicio           date,
  data_fim              date,
  tipo                  text check (tipo in ('pontual','recorrente')),
  valor                 numeric(14,2),
  status                text not null default 'ativo' check (status in ('ativo','encerrado','suspenso'))
);

-- FATURAMENTO -----------------------------------------------------------------
create table if not exists faturamento (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  contrato_id           uuid not null references contratos(id) on delete cascade,
  cliente_id            uuid not null references clientes(id) on delete cascade,
  competencia           date not null,
  valor_previsto        numeric(14,2),
  valor_realizado       numeric(14,2),
  data_pagamento        date,
  status                text not null default 'previsto' check (status in ('previsto','pago','atrasado'))
);

-- TAREFAS_FOLLOWUP ------------------------------------------------------------
create table if not exists tarefas_followup (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  cliente_id            uuid not null references clientes(id) on delete cascade,
  responsavel           text,
  descricao             text not null,
  prazo                 date,
  status                text not null default 'aberta',
  origem                text check (origem in ('reuniao','pipeline','pos_venda','cobranca')),
  data_criacao          timestamptz not null default now()
);

-- DOCUMENTOS ------------------------------------------------------------------
create table if not exists documentos (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  cliente_id            uuid not null references clientes(id) on delete cascade,
  tipo                  text,
  referencia            text,
  data                  date not null default current_date
);

-- ÍNDICES ---------------------------------------------------------------------
create index if not exists idx_clientes_tenant       on clientes(empresa_consultora_id);
create index if not exists idx_clientes_status       on clientes(empresa_consultora_id, status);
create index if not exists idx_contatos_cliente      on contatos(cliente_id);
create index if not exists idx_interacoes_cliente    on interacoes(cliente_id);
create index if not exists idx_interacoes_data       on interacoes(empresa_consultora_id, data desc);
create index if not exists idx_oport_cliente         on oportunidades(cliente_id);
create index if not exists idx_oport_etapa           on oportunidades(empresa_consultora_id, etapa);
create index if not exists idx_oport_previsao        on oportunidades(data_prevista_fechamento);
create index if not exists idx_propostas_oport       on propostas(oportunidade_id);
create index if not exists idx_propostas_status_val  on propostas(empresa_consultora_id, status, validade);
create index if not exists idx_contratos_cliente     on contratos(cliente_id);
create index if not exists idx_contratos_status_fim  on contratos(empresa_consultora_id, status, data_fim);
create index if not exists idx_fat_cliente           on faturamento(cliente_id);
create index if not exists idx_fat_status            on faturamento(empresa_consultora_id, status);
create index if not exists idx_fat_competencia       on faturamento(empresa_consultora_id, competencia);
create index if not exists idx_tarefas_status_prazo  on tarefas_followup(empresa_consultora_id, status, prazo);
create index if not exists idx_tarefas_cliente       on tarefas_followup(cliente_id);
create index if not exists idx_documentos_cliente    on documentos(cliente_id);


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0002_msfort.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM NOVALUZ — 0002 MÓDULO MSFORT (metalurgia / serviço industrial)
-- Conecta ao núcleo por cliente_id/contrato_id. Não altera o núcleo.
-- =============================================================================

create table if not exists colaboradores (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  nome                  text not null,
  funcao_padrao         text,
  ativo                 boolean not null default true
);

create table if not exists obras_servicos (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  cliente_id            uuid not null references clientes(id) on delete cascade,
  contrato_id           uuid references contratos(id) on delete set null,
  tipo_servico          text check (tipo_servico in ('diarista','solda','montagem','manutencao_cimbramento','ajuste_campo')),
  local                 text,
  data_inicio           date,
  data_fim_prevista     date,
  data_fim_real         date,
  status                text not null default 'planejada' check (status in ('planejada','em_execucao','concluida','parada'))
);

create table if not exists alocacao_equipe (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  obra_id               uuid not null references obras_servicos(id) on delete cascade,
  colaborador_id        uuid not null references colaboradores(id),
  funcao                text,
  data                  date not null,
  horas_trabalhadas     numeric(6,2)
);

create table if not exists materiais_por_obra (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  obra_id               uuid not null references obras_servicos(id) on delete cascade,
  item                  text not null,
  quantidade            numeric(14,3),
  custo_unitario        numeric(14,2),
  fornecedor            text
);

create table if not exists manutencao_recorrente (
  id                     uuid primary key default gen_random_uuid(),
  empresa_consultora_id  uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  cliente_id             uuid not null references clientes(id) on delete cascade,
  equipamento_estrutura  text not null,
  periodicidade_dias     integer not null,
  ultima_execucao        date,
  proxima_prevista       date
);

create index if not exists idx_obras_cliente     on obras_servicos(cliente_id);
create index if not exists idx_obras_contrato    on obras_servicos(contrato_id);
create index if not exists idx_obras_status      on obras_servicos(empresa_consultora_id, status);
create index if not exists idx_alocacao_obra     on alocacao_equipe(obra_id);
create index if not exists idx_alocacao_colab    on alocacao_equipe(colaborador_id, data);
create index if not exists idx_materiais_obra    on materiais_por_obra(obra_id);
create index if not exists idx_manut_cliente     on manutencao_recorrente(cliente_id);
create index if not exists idx_manut_proxima     on manutencao_recorrente(empresa_consultora_id, proxima_prevista);


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0003_rls.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM NOVALUZ — 0003 RLS (Row Level Security) multi-tenant
-- Isola cada linha por empresa_consultora_id = tenant do usuário logado.
-- =============================================================================

-- perfis: cada um enxerga só o próprio perfil ---------------------------------
alter table perfis enable row level security;
drop policy if exists perfis_self on perfis;
create policy perfis_self on perfis
  using (id = auth.uid());

-- empresas_consultoras: usuário vê só o próprio tenant ------------------------
alter table empresas_consultoras enable row level security;
drop policy if exists empresa_self on empresas_consultoras;
create policy empresa_self on empresas_consultoras
  using (id = auth_empresa_id());

-- Macro aplicada a todas as tabelas de dados (núcleo + módulo) -----------------
do $$
declare t text;
begin
  foreach t in array array[
    'clientes','contatos','interacoes','oportunidades','propostas',
    'contratos','faturamento','tarefas_followup','documentos',
    'colaboradores','obras_servicos','alocacao_equipe',
    'materiais_por_obra','manutencao_recorrente'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists tenant_all on %I;', t);
    execute format($f$
      create policy tenant_all on %I
        using      (empresa_consultora_id = auth_empresa_id())
        with check (empresa_consultora_id = auth_empresa_id());
    $f$, t);
  end loop;
end $$;


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0004_erp_cadastros.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0004 CADASTROS DO ERP
-- Fornecedores, produtos/insumos, depósitos, categorias financeiras, contas.
-- =============================================================================

-- FORNECEDORES ----------------------------------------------------------------
create table if not exists fornecedores (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  nome                  text not null,
  documento             text,
  telefone              text,
  email                 text,
  contato               text,
  ativo                 boolean not null default true
);

-- DEPÓSITOS / ALMOXARIFADOS ---------------------------------------------------
create table if not exists depositos (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  nome                  text not null,
  local                 text,
  ativo                 boolean not null default true
);

-- PRODUTOS / INSUMOS (custo médio vive aqui) ----------------------------------
create table if not exists produtos (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  codigo                text,
  nome                  text not null,
  tipo                  text not null default 'insumo' check (tipo in ('insumo','produto','servico')),
  unidade               text not null default 'un',
  custo_medio           numeric(14,4) not null default 0,   -- mantido por trigger
  estoque_minimo        numeric(14,3) not null default 0,
  ativo                 boolean not null default true
);

-- CATEGORIAS FINANCEIRAS (plano de contas simplificado) -----------------------
create table if not exists categorias_financeiras (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  nome                  text not null,
  natureza              text not null check (natureza in ('receita','despesa')),
  ativo                 boolean not null default true
);

-- CONTAS BANCÁRIAS / CAIXA (saldo mantido por trigger) ------------------------
create table if not exists contas_bancarias (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  nome                  text not null,
  tipo                  text not null default 'banco' check (tipo in ('banco','caixa')),
  saldo_inicial         numeric(14,2) not null default 0,
  saldo_atual           numeric(14,2) not null default 0,   -- mantido por trigger
  ativo                 boolean not null default true
);

-- saldo_atual começa igual ao saldo_inicial
create or replace function _init_saldo_conta()
returns trigger language plpgsql as $$
begin
  if new.saldo_atual is null or new.saldo_atual = 0 then
    new.saldo_atual := coalesce(new.saldo_inicial, 0);
  end if;
  return new;
end $$;

drop trigger if exists trg_init_saldo_conta on contas_bancarias;
create trigger trg_init_saldo_conta
  before insert on contas_bancarias
  for each row execute function _init_saldo_conta();

create index if not exists idx_fornecedores_tenant on fornecedores(empresa_consultora_id);
create index if not exists idx_depositos_tenant     on depositos(empresa_consultora_id);
create index if not exists idx_produtos_tenant       on produtos(empresa_consultora_id);
create index if not exists idx_produtos_nome         on produtos(empresa_consultora_id, nome);
create index if not exists idx_categorias_tenant     on categorias_financeiras(empresa_consultora_id);
create index if not exists idx_contas_tenant         on contas_bancarias(empresa_consultora_id);


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0005_estoque.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0005 ESTOQUE (movimentações + saldos + custo médio)
-- Modelo append-only: movimentações não se editam; para corrigir, lance um
-- ajuste. Triggers mantêm saldo (por depósito) e custo médio (por produto).
-- =============================================================================

-- SALDOS por (produto, depósito) ----------------------------------------------
create table if not exists saldos_estoque (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  produto_id            uuid not null references produtos(id) on delete cascade,
  deposito_id           uuid not null references depositos(id) on delete cascade,
  quantidade            numeric(14,3) not null default 0,
  atualizado_em         timestamptz not null default now(),
  unique (produto_id, deposito_id)
);

-- MOVIMENTAÇÕES (append-only) -------------------------------------------------
create table if not exists movimentacoes_estoque (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  produto_id            uuid not null references produtos(id),
  deposito_id           uuid not null references depositos(id),
  tipo                  text not null check (tipo in ('entrada','saida','ajuste')),
  quantidade            numeric(14,3) not null check (quantidade > 0),
  custo_unitario        numeric(14,4),          -- obrigatório na entrada; na saída é preenchido pelo custo médio
  origem                text not null default 'manual' check (origem in ('manual','compra','producao','ajuste','inventario')),
  referencia_id         uuid,                   -- pedido de compra, obra, etc.
  data                  timestamptz not null default now(),
  observacao            text
);

create index if not exists idx_mov_estoque_produto on movimentacoes_estoque(produto_id);
create index if not exists idx_mov_estoque_data     on movimentacoes_estoque(empresa_consultora_id, data desc);
create index if not exists idx_saldos_produto        on saldos_estoque(produto_id);

-- TRIGGER: aplica a movimentação ao saldo e ao custo médio ---------------------
create or replace function aplicar_movimentacao_estoque()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saldo_atual numeric(14,3);
  v_custo_atual numeric(14,4);
  v_novo_saldo  numeric(14,3);
begin
  -- garante linha de saldo
  insert into saldos_estoque (empresa_consultora_id, produto_id, deposito_id, quantidade)
  values (new.empresa_consultora_id, new.produto_id, new.deposito_id, 0)
  on conflict (produto_id, deposito_id) do nothing;

  select quantidade into v_saldo_atual
  from saldos_estoque where produto_id = new.produto_id and deposito_id = new.deposito_id for update;

  select custo_medio into v_custo_atual from produtos where id = new.produto_id;

  if new.tipo = 'entrada' then
    if new.custo_unitario is null then
      raise exception 'Entrada de estoque exige custo_unitario';
    end if;
    -- custo médio ponderado (considera saldo total do produto em todos os depósitos)
    declare
      v_saldo_total numeric(14,3);
    begin
      select coalesce(sum(quantidade),0) into v_saldo_total from saldos_estoque where produto_id = new.produto_id;
      update produtos
        set custo_medio = case when (v_saldo_total + new.quantidade) > 0
                               then ((v_saldo_total * v_custo_atual) + (new.quantidade * new.custo_unitario)) / (v_saldo_total + new.quantidade)
                               else new.custo_unitario end
        where id = new.produto_id;
    end;
    update saldos_estoque set quantidade = quantidade + new.quantidade, atualizado_em = now()
      where produto_id = new.produto_id and deposito_id = new.deposito_id;

  elsif new.tipo = 'saida' then
    v_novo_saldo := v_saldo_atual - new.quantidade;
    if v_novo_saldo < 0 then
      raise exception 'Estoque insuficiente: saldo % , saída %', v_saldo_atual, new.quantidade;
    end if;
    -- registra o custo da saída pelo custo médio vigente (não altera custo médio)
    new.custo_unitario := v_custo_atual;
    update saldos_estoque set quantidade = v_novo_saldo, atualizado_em = now()
      where produto_id = new.produto_id and deposito_id = new.deposito_id;

  elsif new.tipo = 'ajuste' then
    -- ajuste define a quantidade como delta assinado via sinal em observacao? Simplificado:
    -- trata ajuste como entrada/saída conforme custo informado; aqui soma direto.
    update saldos_estoque set quantidade = quantidade + new.quantidade, atualizado_em = now()
      where produto_id = new.produto_id and deposito_id = new.deposito_id;
  end if;

  return new;
end $$;

drop trigger if exists trg_mov_estoque on movimentacoes_estoque;
create trigger trg_mov_estoque
  before insert on movimentacoes_estoque
  for each row execute function aplicar_movimentacao_estoque();


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0006_financeiro.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0006 FINANCEIRO (títulos + caixa + baixa automática)
-- Baixar um título (status -> pago, com conta) gera movimento de caixa e
-- atualiza o saldo da conta. Reverter (pago -> aberto) desfaz.
-- =============================================================================

-- MOVIMENTAÇÕES DE CAIXA (extrato) --------------------------------------------
create table if not exists movimentacoes_caixa (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  conta_bancaria_id     uuid not null references contas_bancarias(id) on delete cascade,
  tipo                  text not null check (tipo in ('credito','debito')),
  valor                 numeric(14,2) not null,
  data                  date not null default current_date,
  titulo_id             uuid,
  descricao             text
);

-- TÍTULOS a pagar / a receber -------------------------------------------------
create table if not exists titulos_financeiros (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  tipo                  text not null check (tipo in ('pagar','receber')),
  descricao             text not null,
  cliente_id            uuid references clientes(id) on delete set null,
  fornecedor_id         uuid references fornecedores(id) on delete set null,
  categoria_id          uuid references categorias_financeiras(id) on delete set null,
  valor                 numeric(14,2) not null,
  vencimento            date,
  status                text not null default 'aberto' check (status in ('aberto','pago','cancelado')),
  data_pagamento        date,
  conta_bancaria_id     uuid references contas_bancarias(id) on delete set null,
  origem                text not null default 'manual' check (origem in ('manual','compra','contrato','faturamento')),
  referencia_id         uuid,
  criado_em             timestamptz not null default now()
);

create index if not exists idx_titulos_tenant   on titulos_financeiros(empresa_consultora_id);
create index if not exists idx_titulos_status    on titulos_financeiros(empresa_consultora_id, status, vencimento);
create index if not exists idx_titulos_tipo      on titulos_financeiros(empresa_consultora_id, tipo);
create index if not exists idx_caixa_conta        on movimentacoes_caixa(conta_bancaria_id);

-- helper: aplica ou reverte no caixa/saldo
create or replace function _mov_caixa_do_titulo(p_titulo titulos_financeiros, p_sinal int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credito boolean;
begin
  if p_titulo.conta_bancaria_id is null then
    raise exception 'Baixa exige conta_bancaria_id';
  end if;
  v_credito := (p_titulo.tipo = 'receber');

  if p_sinal > 0 then
    insert into movimentacoes_caixa (empresa_consultora_id, conta_bancaria_id, tipo, valor, data, titulo_id, descricao)
    values (p_titulo.empresa_consultora_id, p_titulo.conta_bancaria_id,
            case when v_credito then 'credito' else 'debito' end,
            p_titulo.valor, coalesce(p_titulo.data_pagamento, current_date), p_titulo.id, p_titulo.descricao);
  else
    delete from movimentacoes_caixa where titulo_id = p_titulo.id;
  end if;

  update contas_bancarias
    set saldo_atual = saldo_atual + p_sinal * (case when v_credito then p_titulo.valor else -p_titulo.valor end)
    where id = p_titulo.conta_bancaria_id;
end $$;

-- TRIGGER: baixa / estorno ----------------------------------------------------
create or replace function processar_baixa_titulo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'pago' then
      if new.data_pagamento is null then new.data_pagamento := current_date; end if;
      perform _mov_caixa_do_titulo(new, 1);
    end if;
    return new;
  end if;

  -- UPDATE
  if old.status <> 'pago' and new.status = 'pago' then
    if new.data_pagamento is null then new.data_pagamento := current_date; end if;
    perform _mov_caixa_do_titulo(new, 1);
  elsif old.status = 'pago' and new.status <> 'pago' then
    perform _mov_caixa_do_titulo(old, -1);
    new.data_pagamento := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_baixa_titulo on titulos_financeiros;
create trigger trg_baixa_titulo
  before insert or update on titulos_financeiros
  for each row execute function processar_baixa_titulo();

-- VIEW de fluxo de caixa (crédito - débito por dia) ---------------------------
create or replace view vw_fluxo_caixa as
select
  empresa_consultora_id,
  data,
  sum(case when tipo = 'credito' then valor else 0 end) as entradas,
  sum(case when tipo = 'debito'  then valor else 0 end) as saidas,
  sum(case when tipo = 'credito' then valor else -valor end) as liquido
from movimentacoes_caixa
group by empresa_consultora_id, data
order by data desc;


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0007_compras.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0007 COMPRAS (pedido + itens + recebimento)
-- Receber o pedido (status -> recebido) gera:
--   1) entrada de estoque para cada item (alimenta saldo + custo médio)
--   2) um título financeiro a pagar para o fornecedor
-- Depende de: 0005 (estoque), 0006 (financeiro), 0004 (cadastros)
-- =============================================================================

create table if not exists pedidos_compra (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  numero                text,
  fornecedor_id         uuid not null references fornecedores(id),
  deposito_id           uuid references depositos(id),
  categoria_id          uuid references categorias_financeiras(id),
  data                  date not null default current_date,
  vencimento            date,
  valor_total           numeric(14,2) not null default 0,   -- mantido por trigger dos itens
  status                text not null default 'aberto' check (status in ('aberto','recebido','cancelado')),
  observacao            text
);

create table if not exists itens_pedido_compra (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  pedido_id             uuid not null references pedidos_compra(id) on delete cascade,
  produto_id            uuid not null references produtos(id),
  quantidade            numeric(14,3) not null check (quantidade > 0),
  custo_unitario        numeric(14,4) not null,
  subtotal              numeric(14,2) generated always as (round((quantidade * custo_unitario)::numeric, 2)) stored
);

create index if not exists idx_pedcompra_tenant on pedidos_compra(empresa_consultora_id, status);
create index if not exists idx_itenspc_pedido    on itens_pedido_compra(pedido_id);

-- recalcula o total do pedido a partir dos itens ------------------------------
create or replace function recalcular_total_pedido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_pedido uuid;
begin
  v_pedido := coalesce(new.pedido_id, old.pedido_id);
  update pedidos_compra p
    set valor_total = coalesce((select sum(subtotal) from itens_pedido_compra where pedido_id = v_pedido), 0)
    where p.id = v_pedido;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_total_pedido on itens_pedido_compra;
create trigger trg_total_pedido
  after insert or update or delete on itens_pedido_compra
  for each row execute function recalcular_total_pedido();

-- recebimento -----------------------------------------------------------------
create or replace function processar_recebimento_pedido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  it record;
  v_dep uuid;
begin
  if old.status = 'recebido' or new.status <> 'recebido' then
    return new;
  end if;
  if new.deposito_id is null then
    raise exception 'Recebimento exige depósito de destino no pedido';
  end if;
  v_dep := new.deposito_id;

  -- 1) entradas de estoque
  for it in select * from itens_pedido_compra where pedido_id = new.id loop
    insert into movimentacoes_estoque
      (empresa_consultora_id, produto_id, deposito_id, tipo, quantidade, custo_unitario, origem, referencia_id, observacao)
    values
      (new.empresa_consultora_id, it.produto_id, v_dep, 'entrada', it.quantidade, it.custo_unitario, 'compra', new.id,
       'Recebimento pedido ' || coalesce(new.numero, new.id::text));
  end loop;

  -- 2) título a pagar
  insert into titulos_financeiros
    (empresa_consultora_id, tipo, descricao, fornecedor_id, categoria_id, valor, vencimento, status, origem, referencia_id)
  values
    (new.empresa_consultora_id, 'pagar',
     'Pedido de compra ' || coalesce(new.numero, new.id::text),
     new.fornecedor_id, new.categoria_id, new.valor_total, new.vencimento, 'aberto', 'compra', new.id);

  return new;
end $$;

drop trigger if exists trg_receb_pedido on pedidos_compra;
create trigger trg_receb_pedido
  before update on pedidos_compra
  for each row execute function processar_recebimento_pedido();


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0008_producao.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0008 PRODUÇÃO / ORDEM DE SERVIÇO
-- Evolui o módulo MSFORT: a obra_servico é a OS. Consumo de material dá baixa
-- no estoque; alocação de equipe (0002) fornece a mão de obra. View consolida
-- custo real (material + mão de obra) × orçado. Uso: controle na Impacto.
-- =============================================================================

-- custo-hora do colaborador e orçamento da OS
alter table colaboradores  add column if not exists custo_hora   numeric(14,2) not null default 0;
alter table obras_servicos add column if not exists custo_orcado numeric(14,2) not null default 0;

-- CONSUMO DE MATERIAL na obra (gera saída de estoque) -------------------------
create table if not exists consumo_producao (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  obra_id               uuid not null references obras_servicos(id) on delete cascade,
  produto_id            uuid not null references produtos(id),
  deposito_id           uuid not null references depositos(id),
  quantidade            numeric(14,3) not null check (quantidade > 0),
  data                  date not null default current_date,
  observacao            text
);

create index if not exists idx_consumo_obra on consumo_producao(obra_id);

-- trigger: consumo -> saída de estoque ----------------------------------------
create or replace function processar_consumo_producao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into movimentacoes_estoque
    (empresa_consultora_id, produto_id, deposito_id, tipo, quantidade, origem, referencia_id, observacao)
  values
    (new.empresa_consultora_id, new.produto_id, new.deposito_id, 'saida', new.quantidade, 'producao', new.obra_id,
     'Consumo na obra ' || new.obra_id::text);
  return new;
end $$;

drop trigger if exists trg_consumo_producao on consumo_producao;
create trigger trg_consumo_producao
  after insert on consumo_producao
  for each row execute function processar_consumo_producao();

-- VIEW: custo real da obra (material das saídas de produção + mão de obra) -----
create or replace view vw_custo_obra as
select
  o.id                     as obra_id,
  o.empresa_consultora_id,
  o.local,
  o.cliente_id,
  o.custo_orcado,
  coalesce(mat.total, 0)   as custo_material,
  coalesce(mao.total, 0)   as custo_mao_obra,
  coalesce(mat.total, 0) + coalesce(mao.total, 0) as custo_real,
  o.custo_orcado - (coalesce(mat.total, 0) + coalesce(mao.total, 0)) as saldo_orcamento
from obras_servicos o
left join (
  select referencia_id as obra_id, sum(quantidade * coalesce(custo_unitario,0)) as total
  from movimentacoes_estoque
  where origem = 'producao' and tipo = 'saida'
  group by referencia_id
) mat on mat.obra_id = o.id
left join (
  select a.obra_id, sum(a.horas_trabalhadas * c.custo_hora) as total
  from alocacao_equipe a
  join colaboradores c on c.id = a.colaborador_id
  group by a.obra_id
) mao on mao.obra_id = o.id;


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0009_rls_erp.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0009 RLS dos módulos de ERP
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'fornecedores','depositos','produtos','categorias_financeiras','contas_bancarias',
    'saldos_estoque','movimentacoes_estoque','movimentacoes_caixa','titulos_financeiros',
    'pedidos_compra','itens_pedido_compra','consumo_producao'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists tenant_all on %I;', t);
    execute format($f$
      create policy tenant_all on %I
        using      (empresa_consultora_id = auth_empresa_id())
        with check (empresa_consultora_id = auth_empresa_id());
    $f$, t);
  end loop;
end $$;

-- Views: executam com o RLS do usuário que consulta (senão vazam entre tenants).
-- Requer PostgreSQL 15+ (Supabase já é 15+).
alter view vw_fluxo_caixa set (security_invoker = on);
alter view vw_custo_obra  set (security_invoker = on);


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0010_financeiro_dre_parcelas.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0010 FINANCEIRO: DRE + parcelamento
-- 1) categorias ganham grupo_dre + ordem (base de DRE e relatórios)
-- 2) títulos ganham competência + dados de parcela
-- 3) função seed_categorias_dre(tenant) — plano de contas padrão
-- 4) função gerar_parcelas(...) — cria N títulos a pagar/receber parcelados
-- =============================================================================

-- 1) DRE nas categorias -------------------------------------------------------
alter table categorias_financeiras
  add column if not exists grupo_dre text,
  add column if not exists ordem     int not null default 100;

-- idempotência do seed
create unique index if not exists uq_categoria_nome
  on categorias_financeiras(empresa_consultora_id, nome);

-- 2) competência + parcelas nos títulos ---------------------------------------
alter table titulos_financeiros
  add column if not exists competencia         date,
  add column if not exists parcela_numero      int,
  add column if not exists parcela_total        int,
  add column if not exists grupo_parcelamento  uuid;

create index if not exists idx_titulos_grupo_parc on titulos_financeiros(grupo_parcelamento);
create index if not exists idx_titulos_competencia on titulos_financeiros(empresa_consultora_id, competencia);

-- 3) plano de contas padrão (DRE) ---------------------------------------------
create or replace function seed_categorias_dre(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into categorias_financeiras (empresa_consultora_id, nome, natureza, grupo_dre, ordem) values
    (p_tenant, 'Receita de serviços',                 'receita', 'receita', 10),
    (p_tenant, 'Receita de vendas',                   'receita', 'receita', 11),
    (p_tenant, 'Receita de locação',                  'receita', 'receita', 12),
    (p_tenant, 'Impostos sobre faturamento',          'despesa', 'deducao', 20),
    (p_tenant, 'Custo de material / insumos',          'despesa', 'custo', 30),
    (p_tenant, 'Custo de mão de obra direta',          'despesa', 'custo', 31),
    (p_tenant, 'Custo de terceiros / subcontratação',  'despesa', 'custo', 32),
    (p_tenant, 'Custo de equipamentos / locação',      'despesa', 'custo', 33),
    (p_tenant, 'Despesas com pessoal (folha/encargos)','despesa', 'despesa_operacional', 40),
    (p_tenant, 'Despesas administrativas',             'despesa', 'despesa_operacional', 41),
    (p_tenant, 'Despesas comerciais / marketing',      'despesa', 'despesa_operacional', 42),
    (p_tenant, 'Ocupação (aluguel/energia/água)',      'despesa', 'despesa_operacional', 43),
    (p_tenant, 'Manutenção e frota',                   'despesa', 'despesa_operacional', 44),
    (p_tenant, 'Impostos e taxas',                     'despesa', 'despesa_operacional', 45),
    (p_tenant, 'Juros e tarifas bancárias',            'despesa', 'despesa_financeira', 50),
    (p_tenant, 'Outras receitas',                      'receita', 'outras', 90),
    (p_tenant, 'Outras despesas',                      'despesa', 'outras', 91),
    (p_tenant, 'Investimentos / imobilizado',          'despesa', 'outras', 92)
  on conflict (empresa_consultora_id, nome) do nothing;
end $$;

-- 4) geração de parcelas ------------------------------------------------------
-- Cria N títulos, dividindo o total (a última parcela ajusta o arredondamento).
-- Chamar via RPC pelo app (usuário autenticado).
create or replace function gerar_parcelas(
  p_tipo            text,               -- 'pagar' | 'receber'
  p_descricao       text,
  p_valor_total     numeric,
  p_num_parcelas    int,
  p_primeiro_venc   date,
  p_intervalo_dias  int default 30,
  p_fornecedor      uuid default null,
  p_cliente         uuid default null,
  p_categoria       uuid default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := auth_empresa_id();
  v_grupo  uuid := gen_random_uuid();
  v_base   numeric := round(p_valor_total / p_num_parcelas, 2);
  v_acum   numeric := 0;
  v_valor  numeric;
  v_venc   date;
  i        int;
begin
  if v_tenant is null then
    raise exception 'Usuário sem tenant (não autenticado)';
  end if;
  if p_num_parcelas < 1 then
    raise exception 'Número de parcelas deve ser >= 1';
  end if;

  for i in 1..p_num_parcelas loop
    if i < p_num_parcelas then
      v_valor := v_base;
      v_acum  := v_acum + v_base;
    else
      v_valor := round(p_valor_total - v_acum, 2);   -- última fecha o total
    end if;
    v_venc := p_primeiro_venc + ((i - 1) * p_intervalo_dias);

    insert into titulos_financeiros
      (empresa_consultora_id, tipo, descricao, fornecedor_id, cliente_id, categoria_id,
       valor, vencimento, competencia, status, origem,
       parcela_numero, parcela_total, grupo_parcelamento)
    values
      (v_tenant, p_tipo,
       p_descricao || ' (' || i || '/' || p_num_parcelas || ')',
       p_fornecedor, p_cliente, p_categoria,
       v_valor, v_venc, v_venc, 'aberto', 'manual',
       i, p_num_parcelas, v_grupo);
  end loop;

  return p_num_parcelas;
end $$;

-- 5) VIEW de apoio ao DRE (por competência e grupo) ---------------------------
create or replace view vw_dre as
select
  t.empresa_consultora_id,
  date_trunc('month', coalesce(t.competencia, t.vencimento))::date as competencia,
  coalesce(c.grupo_dre, 'sem_categoria') as grupo_dre,
  c.natureza,
  t.tipo,
  sum(t.valor) as total
from titulos_financeiros t
left join categorias_financeiras c on c.id = t.categoria_id
where t.status <> 'cancelado'
group by 1, 2, 3, 4, 5;

alter view vw_dre set (security_invoker = on);


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0011_import_helpers.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0011 apoio à importação de histórico financeiro
-- Dá ao gatilho de baixa um "modo importação": quando a sessão define
-- app.pular_baixa = 'on', títulos já 'pago' são gravados como histórico SEM
-- gerar movimento de caixa (o dinheiro entrou/saiu antes do sistema existir).
-- No uso normal do app o gatilho continua igual (baixa move o caixa).
-- =============================================================================

create or replace function processar_baixa_titulo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- modo importação: preserva o status, não mexe no caixa
  if coalesce(current_setting('app.pular_baixa', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'pago' then
      if new.data_pagamento is null then new.data_pagamento := current_date; end if;
      perform _mov_caixa_do_titulo(new, 1);
    end if;
    return new;
  end if;

  -- UPDATE
  if old.status <> 'pago' and new.status = 'pago' then
    if new.data_pagamento is null then new.data_pagamento := current_date; end if;
    perform _mov_caixa_do_titulo(new, 1);
  elsif old.status = 'pago' and new.status <> 'pago' then
    perform _mov_caixa_do_titulo(old, -1);
    new.data_pagamento := null;
  end if;
  return new;
end $$;


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0012_resumos.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0012 views de resumo (evita o teto de 1000 linhas do
-- PostgREST em somatórios; o app passa a ler totais já agregados no banco).
-- =============================================================================

create or replace view vw_titulos_resumo as
select
  empresa_consultora_id,
  tipo,
  status,
  sum(valor)  as total,
  count(*)    as qtd
from titulos_financeiros
group by empresa_consultora_id, tipo, status;

alter view vw_titulos_resumo set (security_invoker = on);


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0013_subcategorias.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0013 subcategorias financeiras (2º nível abaixo da categoria)
-- categoria (com grupo_dre) -> subcategoria (detalhe). Título aponta para ambas.
-- =============================================================================

create table if not exists subcategorias_financeiras (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  categoria_id          uuid not null references categorias_financeiras(id) on delete cascade,
  nome                  text not null,
  ativo                 boolean not null default true
);

create unique index if not exists uq_subcategoria_nome
  on subcategorias_financeiras(empresa_consultora_id, categoria_id, nome);
create index if not exists idx_subcategoria_categoria
  on subcategorias_financeiras(categoria_id);

alter table titulos_financeiros
  add column if not exists subcategoria_id uuid references subcategorias_financeiras(id) on delete set null;

-- RLS
alter table subcategorias_financeiras enable row level security;
drop policy if exists tenant_all on subcategorias_financeiras;
create policy tenant_all on subcategorias_financeiras
  using      (empresa_consultora_id = auth_empresa_id())
  with check (empresa_consultora_id = auth_empresa_id());


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0014_impacto_producao.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0014 MÓDULO IMPACTO / PRODUÇÃO
-- Cadastro de peças (peso, valor/kg) + lançamentos de produção por cliente,
-- com peso e valor totais calculados. Base do controle específico Impacto.
-- =============================================================================

-- CADASTRO DE PEÇAS ------------------------------------------------------------
create table if not exists pecas (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  nome                  text not null,
  peso                  numeric(12,3) not null default 0,   -- kg por unidade
  valor_kg              numeric(12,4) not null default 0,   -- R$/kg
  tipo                  text,                                -- LD | LP | LPP | ...
  ativo                 boolean not null default true
);
create unique index if not exists uq_peca_nome on pecas(empresa_consultora_id, nome);

-- LANÇAMENTOS DE PRODUÇÃO ------------------------------------------------------
create table if not exists producao (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  data                  date not null default current_date,
  cliente_id            uuid references clientes(id) on delete set null,
  colaborador_id        uuid references colaboradores(id) on delete set null,
  peca_id               uuid references pecas(id) on delete set null,
  peca_nome             text,
  categoria             text,
  tipo                  text,
  quantidade            numeric(14,3) not null default 0,
  peso_unit             numeric(12,3) not null default 0,
  valor_unit            numeric(12,4) not null default 0,    -- R$/kg da produção
  peso_total            numeric(16,3) generated always as (quantidade * peso_unit) stored,
  valor_total           numeric(16,2) generated always as (round((quantidade * peso_unit * valor_unit)::numeric, 2)) stored
);

create index if not exists idx_producao_cliente on producao(empresa_consultora_id, cliente_id);
create index if not exists idx_producao_data    on producao(empresa_consultora_id, data);
create index if not exists idx_producao_peca     on producao(peca_id);

-- RLS
do $$
declare t text;
begin
  foreach t in array array['pecas','producao'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists tenant_all on %I;', t);
    execute format($f$
      create policy tenant_all on %I
        using (empresa_consultora_id = auth_empresa_id())
        with check (empresa_consultora_id = auth_empresa_id());
    $f$, t);
  end loop;
end $$;

-- VIEW: resumo de produção por cliente (controle Impacto)
create or replace view vw_producao_cliente as
select
  p.empresa_consultora_id,
  p.cliente_id,
  c.nome as cliente,
  count(*)            as lancamentos,
  sum(p.quantidade)   as pecas,
  sum(p.peso_total)   as peso_total,
  sum(p.valor_total)  as valor_total
from producao p
left join clientes c on c.id = p.cliente_id
group by p.empresa_consultora_id, p.cliente_id, c.nome;

alter view vw_producao_cliente set (security_invoker = on);


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0015_servicos.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0015 tabela de preços de serviços (Impacto)
-- A peça passa por um serviço; o preço do kg (ou da unidade) vem do serviço.
-- valor_total passa a considerar a unidade do serviço (KG x UND).
-- Depende de 0014.
-- =============================================================================

create table if not exists servicos (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  nome                  text not null,
  unidade               text not null default 'KG',   -- KG | UND
  valor                 numeric(12,4) not null default 0,  -- preço por kg ou por unidade
  ativo                 boolean not null default true
);
create unique index if not exists uq_servico_nome on servicos(empresa_consultora_id, nome);

alter table producao
  add column if not exists servico_id uuid references servicos(id) on delete set null,
  add column if not exists unidade    text;   -- copiada do serviço (KG/UND) p/ o cálculo

-- recria valor_total ciente da unidade:
--   UND  -> quantidade * valor_unit
--   KG   -> quantidade * peso_unit * valor_unit
-- a view vw_producao_cliente depende da coluna: removê-la antes, recriar depois.
drop view if exists vw_producao_cliente;

alter table producao drop column if exists valor_total;
alter table producao add column valor_total numeric(16,2) generated always as (
  round((case when upper(coalesce(unidade, 'KG')) = 'UND'
              then quantidade * valor_unit
              else quantidade * peso_unit * valor_unit end)::numeric, 2)
) stored;

create or replace view vw_producao_cliente as
select
  p.empresa_consultora_id,
  p.cliente_id,
  c.nome as cliente,
  count(*)            as lancamentos,
  sum(p.quantidade)   as pecas,
  sum(p.peso_total)   as peso_total,
  sum(p.valor_total)  as valor_total
from producao p
left join clientes c on c.id = p.cliente_id
group by p.empresa_consultora_id, p.cliente_id, c.nome;
alter view vw_producao_cliente set (security_invoker = on);

create index if not exists idx_producao_servico on producao(servico_id);

-- RLS
alter table servicos enable row level security;
drop policy if exists tenant_all on servicos;
create policy tenant_all on servicos
  using (empresa_consultora_id = auth_empresa_id())
  with check (empresa_consultora_id = auth_empresa_id());


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0016_ordens_servico.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0016 ORDENS DE SERVIÇO (item 4)
-- OS (plano de ação) por cliente + atividades + insumos. Espelha PlanosAcao +
-- Atividades da planilha, com controle de atividades e insumos por OS.
-- =============================================================================

create table if not exists ordens_servico (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  cliente_id            uuid references clientes(id) on delete set null,
  titulo                text not null,
  motivo                text,
  local                 text,
  como_sera_feito       text,
  responsavel           text,
  prazo                 date,
  data_realizado        date,
  custo_estimado        numeric(14,2) not null default 0,
  urgencia              text check (urgencia in ('baixa','media','alta')),
  status                text not null default 'a_fazer' check (status in ('a_fazer','em_andamento','concluido','cancelado'))
);

create table if not exists atividades_os (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  os_id                 uuid not null references ordens_servico(id) on delete cascade,
  descricao             text not null,
  colaborador_id        uuid references colaboradores(id) on delete set null,
  setor                 text,
  data_inicio           date,
  data_fim              date,
  status                text not null default 'nao_iniciado'
                          check (status in ('nao_iniciado','em_andamento','concluido','parado')),
  conclusao_pct         numeric(5,2) not null default 0,   -- 0..100
  alocacao_pct          numeric(5,2) not null default 100
);

create table if not exists insumos_os (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  os_id                 uuid not null references ordens_servico(id) on delete cascade,
  produto_id            uuid references produtos(id) on delete set null,
  descricao             text not null,
  quantidade            numeric(14,3) not null default 1,
  custo_unitario        numeric(14,2) not null default 0,
  custo_total           numeric(16,2) generated always as (round((quantidade * custo_unitario)::numeric, 2)) stored
);

create index if not exists idx_os_cliente     on ordens_servico(empresa_consultora_id, cliente_id);
create index if not exists idx_os_status       on ordens_servico(empresa_consultora_id, status);
create index if not exists idx_atividades_os   on atividades_os(os_id);
create index if not exists idx_insumos_os      on insumos_os(os_id);

-- RLS
do $$
declare t text;
begin
  foreach t in array array['ordens_servico','atividades_os','insumos_os'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists tenant_all on %I;', t);
    execute format($f$
      create policy tenant_all on %I
        using (empresa_consultora_id = auth_empresa_id())
        with check (empresa_consultora_id = auth_empresa_id());
    $f$, t);
  end loop;
end $$;

-- VIEW: progresso e custo por OS (atividades + insumos)
create or replace view vw_os_resumo as
select
  o.id as os_id,
  o.empresa_consultora_id,
  o.custo_estimado,
  coalesce(a.qtd, 0)         as atividades,
  coalesce(a.concluidas, 0)  as atividades_concluidas,
  coalesce(a.progresso, 0)   as progresso_pct,
  coalesce(i.custo, 0)       as custo_insumos
from ordens_servico o
left join (
  select os_id, count(*) as qtd,
         count(*) filter (where status = 'concluido') as concluidas,
         round(avg(conclusao_pct), 1) as progresso
  from atividades_os group by os_id
) a on a.os_id = o.id
left join (
  select os_id, sum(custo_total) as custo from insumos_os group by os_id
) i on i.os_id = o.id;

alter view vw_os_resumo set (security_invoker = on);


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0017_bonus.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0017 BÔNUS de produção
-- Regras por tipo de peça (mínimo/dia, bônus fixo, bônus por 50 acima do mínimo)
-- + produção diária de bônus por funcionário (contagem LD/LP/LPP/NA).
-- Cálculo: por dia, se contagem do tipo >= mínimo ->
--          fixo + floor((contagem - mínimo)/50) * bonus_por_50. Somado no intervalo.
-- =============================================================================

create table if not exists bonus_regras (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  tipo                  text not null,          -- LD | LP | LPP
  minimo                numeric(12,2) not null default 0,   -- peças/dia
  bonus_fixo            numeric(12,2) not null default 0,
  bonus_por_50          numeric(12,2) not null default 0,
  ativo                 boolean not null default true
);
create unique index if not exists uq_bonus_regra_tipo on bonus_regras(empresa_consultora_id, tipo);

create table if not exists bonus_producao (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  data                  date not null,
  colaborador_id        uuid references colaboradores(id) on delete set null,
  ld                    numeric(12,2) not null default 0,
  lp                    numeric(12,2) not null default 0,
  lpp                   numeric(12,2) not null default 0,
  na                    numeric(12,2) not null default 0
);
create index if not exists idx_bonus_prod_data  on bonus_producao(empresa_consultora_id, data);
create index if not exists idx_bonus_prod_colab on bonus_producao(colaborador_id);

do $$
declare t text;
begin
  foreach t in array array['bonus_regras','bonus_producao'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists tenant_all on %I;', t);
    execute format($f$
      create policy tenant_all on %I
        using (empresa_consultora_id = auth_empresa_id())
        with check (empresa_consultora_id = auth_empresa_id());
    $f$, t);
  end loop;
end $$;


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0018_servico_bonus.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0018 marca serviços que contam para bônus
-- O bônus é calculado a partir da PRODUÇÃO, considerando apenas os lançamentos
-- cujo serviço tem conta_bonus = true (Limpeza+Preparação e Desamassar).
-- =============================================================================

alter table servicos add column if not exists conta_bonus boolean not null default false;

-- marca os dois serviços de bônus (por nome; ajuste depois se precisar)
update servicos set conta_bonus = true
  where nome ilike '%desamassar%' or nome ilike '%limpeza%prepara%';


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0019_propostas_tecnicas.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0019 PROPOSTAS TÉCNICAS (documento comercial)
-- Enriquece propostas (apresentação, escopo, premissas, condições) + itens com
-- foto + total automático. Vínculo manual: OS/contrato -> proposta.
-- =============================================================================

alter table propostas
  alter column oportunidade_id drop not null;

alter table propostas
  add column if not exists cliente_id      uuid references clientes(id) on delete set null,
  add column if not exists objeto          text,
  add column if not exists apresentacao    text,
  add column if not exists premissas       text,
  add column if not exists prazo_entrega   text,
  add column if not exists pagamento       text,
  add column if not exists entrega_frete   text,
  add column if not exists impostos        text,
  add column if not exists escopo_desc     text,
  add column if not exists valor_total     numeric(14,2) not null default 0;

-- itens da proposta (com foto)
create table if not exists itens_proposta (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  proposta_id           uuid not null references propostas(id) on delete cascade,
  ordem                 int not null default 0,
  descricao             text not null,
  referencia            text,
  quantidade            numeric(14,3) not null default 1,
  valor_unit            numeric(14,2) not null default 0,
  valor_total           numeric(16,2) generated always as (round((quantidade * valor_unit)::numeric, 2)) stored,
  foto                  text          -- caminho em /fotos-proposta/... ou URL
);
create index if not exists idx_itens_proposta on itens_proposta(proposta_id);

-- recalcula o total da proposta a partir dos itens
create or replace function recalc_proposta_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_prop uuid;
begin
  v_prop := coalesce(new.proposta_id, old.proposta_id);
  update propostas p
    set valor_total = coalesce((select sum(valor_total) from itens_proposta where proposta_id = v_prop), 0)
    where p.id = v_prop;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_proposta_total on itens_proposta;
create trigger trg_proposta_total
  after insert or update or delete on itens_proposta
  for each row execute function recalc_proposta_total();

-- vínculo manual OS -> proposta / contrato
alter table ordens_servico
  add column if not exists proposta_id uuid references propostas(id) on delete set null,
  add column if not exists contrato_id uuid references contratos(id) on delete set null;

-- contrato: campos do documento (gerado a partir da proposta)
alter table contratos
  add column if not exists objeto      text,
  add column if not exists condicoes   text,
  add column if not exists escopo_desc text;

-- RLS itens_proposta
alter table itens_proposta enable row level security;
drop policy if exists tenant_all on itens_proposta;
create policy tenant_all on itens_proposta
  using (empresa_consultora_id = auth_empresa_id())
  with check (empresa_consultora_id = auth_empresa_id());


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0020_cliente_dados.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0020 dados do cliente para documentos (proposta/contrato)
-- =============================================================================
alter table clientes
  add column if not exists cnpj      text,
  add column if not exists telefone  text,
  add column if not exists email     text,
  add column if not exists endereco  text;


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0021_precificador.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0021 PRECIFICADOR (custos por categoria + margem + impostos)
-- Preço sugerido = (custo_direto + overhead) / (1 - margem% - impostos% - comissao% - taxa_cartao%)
-- Custo separado por categoria (material, mão de obra, equipamento, terceiro, frete, outros).
-- =============================================================================

alter table produtos
  add column if not exists categoria       text,
  add column if not exists tempo_horas      numeric(10,2) not null default 0,
  add column if not exists margem_alvo       numeric(6,2)  not null default 0,   -- % desejada
  add column if not exists preco_lista       numeric(14,2) not null default 0,
  add column if not exists custo_direto       numeric(14,2) not null default 0,  -- mantido por trigger
  add column if not exists preco_sugerido     numeric(14,2) not null default 0;  -- salvo pelo precificador

create table if not exists composicao_custo (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  produto_id            uuid not null references produtos(id) on delete cascade,
  categoria             text not null default 'material'
                          check (categoria in ('material','mao_de_obra','equipamento','terceiro','frete','outros')),
  descricao             text not null,
  quantidade            numeric(14,3) not null default 1,
  custo_unitario        numeric(14,4) not null default 0,
  custo_total           numeric(16,2) generated always as (round((quantidade * custo_unitario)::numeric, 2)) stored
);
create index if not exists idx_composicao_produto on composicao_custo(produto_id);

-- parâmetros de precificação (uma linha por tenant)
create table if not exists parametros_preco (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id() unique,
  overhead_metodo       text not null default 'hora' check (overhead_metodo in ('hora','percentual','nenhum')),
  overhead_hora         numeric(12,2) not null default 0,   -- R$/hora (método 'hora')
  overhead_perc         numeric(6,2)  not null default 0,   -- % sobre custo direto (método 'percentual')
  impostos_perc         numeric(6,2)  not null default 0,   -- % sobre o preço (Simples/ISS...)
  comissao_perc         numeric(6,2)  not null default 0,   -- % sobre o preço
  taxa_cartao_perc      numeric(6,2)  not null default 0,   -- % sobre o preço
  meta_faturamento      numeric(14,2) not null default 0
);

-- trigger: mantém produtos.custo_direto = soma da composição
create or replace function recalc_custo_direto()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_prod uuid;
begin
  v_prod := coalesce(new.produto_id, old.produto_id);
  update produtos p
    set custo_direto = coalesce((select sum(custo_total) from composicao_custo where produto_id = v_prod), 0)
    where p.id = v_prod;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_custo_direto on composicao_custo;
create trigger trg_custo_direto
  after insert or update or delete on composicao_custo
  for each row execute function recalc_custo_direto();

-- RLS
do $$
declare t text;
begin
  foreach t in array array['composicao_custo','parametros_preco'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists tenant_all on %I;', t);
    execute format($f$
      create policy tenant_all on %I
        using (empresa_consultora_id = auth_empresa_id())
        with check (empresa_consultora_id = auth_empresa_id());
    $f$, t);
  end loop;
end $$;


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0022_demandas.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0022 DEMANDAS (painel de controle — foco Impacto)
-- Demandas que não são produção: quem pediu, o quê, data, valor, entrega,
-- responsável, status e motivo de bloqueio (por que não anda).
-- =============================================================================

create table if not exists demandas (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  cliente_id            uuid references clientes(id) on delete set null,
  titulo                text not null,
  descricao             text,
  solicitante           text,                      -- quem solicitou
  responsavel           text,                      -- responsável interno
  data_solicitacao      date not null default current_date,
  data_entrega_prevista date,
  data_entrega_real     date,
  valor_cobrado         numeric(14,2),
  prioridade            text check (prioridade in ('baixa','media','alta')),
  status                text not null default 'aberta'
                          check (status in ('aberta','em_andamento','bloqueada','concluida','cancelada')),
  bloqueio              text,                      -- motivo do bloqueio / por que não anda
  criado_em             timestamptz not null default now()
);

create index if not exists idx_demandas_cliente on demandas(empresa_consultora_id, cliente_id);
create index if not exists idx_demandas_status  on demandas(empresa_consultora_id, status);

alter table demandas enable row level security;
drop policy if exists tenant_all on demandas;
create policy tenant_all on demandas
  using (empresa_consultora_id = auth_empresa_id())
  with check (empresa_consultora_id = auth_empresa_id());


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0023_obra_painel.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0023 OS como obra + campos do painel de obras (TV)
-- =============================================================================
alter table ordens_servico
  add column if not exists is_obra     boolean not null default false,
  add column if not exists gargalos    text,   -- o que está travando / atenção
  add column if not exists orientacoes text;   -- principais cuidados / orientações


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0024_contrato.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0024 contrato: cláusulas (objeto/condicoes/escopo já em 0019)
-- =============================================================================
alter table contratos
  add column if not exists clausulas text;


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0025_numeracao_secoes.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0025 numeração automática + seções de almoxarifado
-- Gera número sequencial por tenant/tipo/ano (ex.: PC-2026-0001) quando o
-- campo numero vem vazio. Produtos ganham 'secao' (EPIs, elétricos, etc.).
-- =============================================================================

-- sequências
create table if not exists sequencias (
  empresa_consultora_id uuid not null default auth_empresa_id(),
  tipo                  text not null,
  ano                   int  not null,
  ultimo                int  not null default 0,
  primary key (empresa_consultora_id, tipo, ano)
);
alter table sequencias enable row level security;
drop policy if exists tenant_all on sequencias;
create policy tenant_all on sequencias
  using (empresa_consultora_id = auth_empresa_id())
  with check (empresa_consultora_id = auth_empresa_id());

-- gera o próximo número: PREFIXO-ANO-0001
create or replace function proximo_numero(p_prefixo text, p_tipo text)
returns text language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := auth_empresa_id(); v_ano int := extract(year from now())::int; v_n int;
begin
  if v_tenant is null then return null; end if;
  insert into sequencias (empresa_consultora_id, tipo, ano, ultimo)
    values (v_tenant, p_tipo, v_ano, 1)
    on conflict (empresa_consultora_id, tipo, ano) do update set ultimo = sequencias.ultimo + 1
    returning ultimo into v_n;
  return p_prefixo || '-' || v_ano || '-' || lpad(v_n::text, 4, '0');
end $$;

-- trigger genérico: preenche numero se vier vazio. args: (prefixo, tipo)
create or replace function set_numero_auto()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.numero is null or new.numero = '' then
    new.numero := proximo_numero(tg_argv[0], tg_argv[1]);
  end if;
  return new;
end $$;

drop trigger if exists trg_num on pedidos_compra;
create trigger trg_num before insert on pedidos_compra for each row execute function set_numero_auto('PC', 'pedido_compra');

drop trigger if exists trg_num on propostas;
create trigger trg_num before insert on propostas for each row execute function set_numero_auto('PROP', 'proposta');

drop trigger if exists trg_num on contratos;
create trigger trg_num before insert on contratos for each row execute function set_numero_auto('C', 'contrato');

-- OS ganha numero
alter table ordens_servico add column if not exists numero text;
drop trigger if exists trg_num on ordens_servico;
create trigger trg_num before insert on ordens_servico for each row execute function set_numero_auto('OS', 'ordem_servico');

-- seção de almoxarifado no produto
alter table produtos add column if not exists secao text;


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0026_fluxo_mensal.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0026 fluxo de caixa mensal a partir dos títulos financeiros
-- Conecta o fluxo ao financeiro: realizado (pago, por data de pagamento) e
-- previsto (em aberto, por vencimento), por mês.
-- =============================================================================
create or replace view vw_fluxo_mensal as
select
  empresa_consultora_id,
  date_trunc('month', case when status = 'pago' then data_pagamento else vencimento end)::date as mes,
  sum(case when tipo = 'receber' and status = 'pago'   then valor else 0 end) as entradas,
  sum(case when tipo = 'pagar'   and status = 'pago'   then valor else 0 end) as saidas,
  sum(case when tipo = 'receber' and status = 'aberto' then valor else 0 end) as a_receber,
  sum(case when tipo = 'pagar'   and status = 'aberto' then valor else 0 end) as a_pagar
from titulos_financeiros
where status <> 'cancelado'
  and (case when status = 'pago' then data_pagamento else vencimento end) is not null
group by 1, 2;

alter view vw_fluxo_mensal set (security_invoker = on);


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0027_admin_central.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0027 administrador central (multiempresa)
-- Papel 'super' = admin central: enxerga/gerencia todas as empresas e perfis.
-- Usuários normais continuam isolados na sua empresa (RLS já existente).
-- =============================================================================

alter table perfis add column if not exists email text;

-- é super admin?
create or replace function is_super()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfis where id = auth.uid() and papel = 'super')
$$;

-- empresas_consultoras: super vê todas e pode criar/editar; usuário vê a sua
drop policy if exists empresa_self on empresas_consultoras;
drop policy if exists empresa_acesso on empresas_consultoras;
create policy empresa_acesso on empresas_consultoras
  using (id = auth_empresa_id() or is_super())
  with check (is_super());

-- perfis: super gerencia todos; usuário vê/edita o próprio
drop policy if exists perfis_self on perfis;
drop policy if exists perfis_acesso on perfis;
create policy perfis_acesso on perfis
  using (id = auth.uid() or is_super())
  with check (is_super() or id = auth.uid());


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0028_modo_suporte.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- CRM/ERP NOVALUZ — 0028 modo suporte (super admin "entra" numa empresa)
-- O super admin escolhe uma empresa_ativa; auth_empresa_id() passa a apontar
-- para ela, e todo o RLS operacional escopa àquela empresa (ver/editar tudo).
-- =============================================================================

alter table perfis add column if not exists empresa_ativa uuid references empresas_consultoras(id) on delete set null;

-- super com empresa_ativa definida "vira" aquela empresa; demais usam a sua
create or replace function auth_empresa_id()
returns uuid language sql stable security definer set search_path = public as $$
  select case
           when papel = 'super' and empresa_ativa is not null then empresa_ativa
           else empresa_consultora_id
         end
  from perfis where id = auth.uid()
$$;

