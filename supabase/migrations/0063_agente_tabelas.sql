-- =============================================================================
-- CRM/ERP NOVALUZ — 0063 Tabelas do agente (Fase 1 do Funcionário Digital)
--
-- Fila de ações, histórico do chat, log de execução e premissas por empresa.
-- Padrão do ERP: empresa_consultora_id + RLS. A ESCRITA destas tabelas é feita
-- pelo servidor (rota /api/agente/*, com service role) ou por RPCs definer —
-- por isso só há policy de LEITURA para o usuário (mesmo padrão de notificacoes).
-- Exceções: a gerência DECIDE ações (update de acoes_agente) e GERE premissas.
--
-- Depende de 0040 (auth_empresa_id, is_gerente).
-- =============================================================================

-- 1) Histórico do chat --------------------------------------------------------
create table if not exists agente_conversas (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  usuario_id            uuid not null references perfis(id) on delete cascade default auth.uid(),
  titulo                text,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);
create index if not exists idx_agente_conversas_usuario on agente_conversas(usuario_id, atualizado_em desc);

create table if not exists agente_mensagens (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  conversa_id           uuid not null references agente_conversas(id) on delete cascade,
  papel                 text not null check (papel in ('user','assistant','tool')),
  conteudo              text,
  ferramenta            text,          -- nome da ferramenta, quando papel = 'tool'
  payload               jsonb,         -- parâmetros/resultado da ferramenta
  criado_em             timestamptz not null default now()
);
create index if not exists idx_agente_mensagens_conversa on agente_mensagens(conversa_id, criado_em);

-- 2) Fila de ações (verde já entra como 'executada'; amarela/vermelha pendem) --
create table if not exists acoes_agente (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  agente                text not null default 'chat' check (agente in ('chat','maestro','sentinela')),
  solicitante_id        uuid references perfis(id) on delete set null,
  conversa_id           uuid references agente_conversas(id) on delete set null,
  ferramenta            text not null,
  parametros            jsonb not null default '{}'::jsonb,
  vinculo_tipo          text check (vinculo_tipo in ('os','obra','cliente','oportunidade','proposta','titulo','requisicao','pedido','tarefa')),
  vinculo_id            uuid,
  justificativa         text,
  faixa                 text not null check (faixa in ('verde','amarela','vermelha')),
  status                text not null default 'pendente'
                          check (status in ('pendente','aprovada','rejeitada','executada','falhou','desfeita')),
  decidido_por          uuid references perfis(id) on delete set null,
  decidido_em           timestamptz,
  resultado             jsonb,
  chave_idempotencia    text,
  criado_em             timestamptz not null default now()
);
create index if not exists idx_acoes_agente_fila on acoes_agente(empresa_consultora_id, status, criado_em desc);
create index if not exists idx_acoes_agente_vinculo on acoes_agente(vinculo_tipo, vinculo_id);
-- idempotência: a mesma chave nunca gera duas ações (reaproveita a ideia de automacao_chave)
create unique index if not exists uq_acoes_agente_chave
  on acoes_agente(empresa_consultora_id, chave_idempotencia) where chave_idempotencia is not null;

-- 3) Log de auditoria / custo -------------------------------------------------
create table if not exists agente_execucoes (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  agente                text not null default 'chat',
  origem                text not null check (origem in ('chat','ronda')),
  usuario_id            uuid references perfis(id) on delete set null,
  conversa_id           uuid references agente_conversas(id) on delete set null,
  ferramentas_chamadas  text[] not null default '{}',
  tokens_entrada        int not null default 0,
  tokens_saida          int not null default 0,
  custo                 numeric(12,6) not null default 0,
  erro                  text,
  criado_em             timestamptz not null default now()
);
create index if not exists idx_agente_execucoes on agente_execucoes(empresa_consultora_id, criado_em desc);

-- 4) Premissas por empresa (gerência edita) -----------------------------------
create table if not exists premissas_agente (
  empresa_consultora_id uuid not null references empresas_consultoras(id) on delete cascade default auth_empresa_id(),
  chave                 text not null,
  valor                 text,
  agente                text,          -- null = vale para todos
  ativo                 boolean not null default true,
  atualizado_em         timestamptz not null default now(),
  primary key (empresa_consultora_id, chave)
);

-- 5) RLS ----------------------------------------------------------------------
alter table agente_conversas  enable row level security;
alter table agente_mensagens  enable row level security;
alter table acoes_agente      enable row level security;
alter table agente_execucoes  enable row level security;
alter table premissas_agente  enable row level security;

-- conversas: dono ou gerência leem; escrita pelo servidor (service role)
drop policy if exists agente_conversas_ler on agente_conversas;
create policy agente_conversas_ler on agente_conversas for select
  using (empresa_consultora_id = (select auth_empresa_id())
         and (usuario_id = (select auth.uid()) or (select is_gerente())));

-- mensagens: quem pode ver a conversa
drop policy if exists agente_mensagens_ler on agente_mensagens;
create policy agente_mensagens_ler on agente_mensagens for select
  using (empresa_consultora_id = (select auth_empresa_id())
         and exists (select 1 from agente_conversas c
                      where c.id = conversa_id
                        and (c.usuario_id = (select auth.uid()) or (select is_gerente()))));

-- ações: solicitante ou gerência leem; gerência DECIDE (update); criação pelo servidor
drop policy if exists acoes_agente_ler on acoes_agente;
drop policy if exists acoes_agente_decidir on acoes_agente;
create policy acoes_agente_ler on acoes_agente for select
  using (empresa_consultora_id = (select auth_empresa_id())
         and (solicitante_id = (select auth.uid()) or (select is_gerente())));
create policy acoes_agente_decidir on acoes_agente for update
  using      (empresa_consultora_id = (select auth_empresa_id()) and (select is_gerente()))
  with check (empresa_consultora_id = (select auth_empresa_id()) and (select is_gerente()));

-- execuções: auditoria só para gerência; escrita pelo servidor
drop policy if exists agente_execucoes_ler on agente_execucoes;
create policy agente_execucoes_ler on agente_execucoes for select
  using (empresa_consultora_id = (select auth_empresa_id()) and (select is_gerente()));

-- premissas: todos da empresa leem (o chat as usa); só a gerência gere
drop policy if exists premissas_agente_ler on premissas_agente;
drop policy if exists premissas_agente_gerir on premissas_agente;
create policy premissas_agente_ler on premissas_agente for select
  using (empresa_consultora_id = (select auth_empresa_id()));
create policy premissas_agente_gerir on premissas_agente for all
  using      (empresa_consultora_id = (select auth_empresa_id()) and (select is_gerente()))
  with check (empresa_consultora_id = (select auth_empresa_id()) and (select is_gerente()));

-- Semente opcional (rode por empresa, trocando o valor):
--   insert into premissas_agente (empresa_consultora_id, chave, valor) values
--     (auth_empresa_id(), 'nome_assistente', 'Assistente'),
--     (auth_empresa_id(), 'limite_diario_tokens', '200000')
--   on conflict do nothing;
