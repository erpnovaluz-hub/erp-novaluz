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
