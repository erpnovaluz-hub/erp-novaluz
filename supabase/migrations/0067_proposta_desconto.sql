-- =============================================================================
-- CRM/ERP NOVALUZ — 0067 DESCONTO NA PROPOSTA
-- subtotal = soma dos itens; desconto em R$ ou %; valor_total = valor final
-- (já com desconto) — contrato/OS/listas continuam lendo valor_total.
-- =============================================================================

alter table propostas
  add column if not exists subtotal        numeric(14,2) not null default 0,
  add column if not exists desconto_tipo   text not null default 'valor'
    check (desconto_tipo in ('valor', 'percentual')),
  add column if not exists desconto        numeric(14,2) not null default 0
    check (desconto >= 0),
  add column if not exists desconto_valor  numeric(14,2) not null default 0,
  add column if not exists desconto_motivo text;

-- calcula desconto_valor e valor_total a partir do subtotal
create or replace function calc_proposta_desconto()
returns trigger language plpgsql as $$
begin
  if new.desconto_tipo = 'percentual' then
    new.desconto_valor := round(new.subtotal * least(new.desconto, 100) / 100, 2);
  else
    new.desconto_valor := least(new.desconto, new.subtotal);
  end if;
  new.valor_total := new.subtotal - new.desconto_valor;
  return new;
end $$;

drop trigger if exists trg_proposta_desconto on propostas;
create trigger trg_proposta_desconto
  before insert or update on propostas
  for each row execute function calc_proposta_desconto();

-- itens passam a alimentar o subtotal (o trigger acima fecha o total)
create or replace function recalc_proposta_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_prop uuid;
begin
  v_prop := coalesce(new.proposta_id, old.proposta_id);
  update propostas p
    set subtotal = coalesce((select sum(valor_total) from itens_proposta where proposta_id = v_prop), 0)
    where p.id = v_prop;
  return coalesce(new, old);
end $$;

-- backfill: propostas existentes sem desconto (sem itens → mantém o valor atual)
update propostas p
  set subtotal = coalesce((select sum(valor_total) from itens_proposta i where i.proposta_id = p.id), p.valor_total);
