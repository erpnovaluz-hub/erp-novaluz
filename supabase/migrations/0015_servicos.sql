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
