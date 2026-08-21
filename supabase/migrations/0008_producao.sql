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
