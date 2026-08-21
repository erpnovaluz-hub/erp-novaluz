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
