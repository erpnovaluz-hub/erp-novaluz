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
