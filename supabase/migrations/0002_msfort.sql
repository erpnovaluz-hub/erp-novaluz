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
