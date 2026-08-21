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
