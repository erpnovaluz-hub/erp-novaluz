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
