-- =============================================================================
-- CRM/ERP NOVALUZ — 0053 OS 2.0 · Bloco 3: campo (fotos e checklist)
--
-- os_fotos      fotos da OS por etapa (antes / durante / depois) com legenda.
--               Arquivo no bucket privado "anexos": <empresa>/os/<os_id>/<arquivo>
--               (a policy do bucket já isola por empresa — migration 0042)
-- os_checklist  itens de execução; marca quem conferiu e quando
--
-- ATENÇÃO (SQL Editor do Supabase): sem "select ... into" — ver migration 0050.
-- Depende de 0016, 0042 (bucket anexos), 0045 (_aplicar_acesso).
-- =============================================================================

create table if not exists os_fotos (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  os_id                 uuid not null references ordens_servico(id) on delete cascade,
  etapa                 text not null default 'durante' check (etapa in ('antes','durante','depois')),
  caminho               text not null unique,
  legenda               text,
  no_relatorio          boolean not null default true,     -- sai no relatório de execução
  enviado_por           uuid references perfis(id) on delete set null default auth.uid(),
  criado_em             timestamptz not null default now()
);
create index if not exists idx_os_fotos on os_fotos(os_id, etapa, criado_em);
select _aplicar_acesso('os_fotos', '{os}', '{os}');

create table if not exists os_checklist (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  os_id                 uuid not null references ordens_servico(id) on delete cascade,
  item                  text not null check (length(trim(item)) > 0),
  ordem                 int not null default 0,
  feito                 boolean not null default false,
  feito_por             uuid references perfis(id) on delete set null,
  feito_em              timestamptz,
  observacao            text
);
create index if not exists idx_os_checklist on os_checklist(os_id, ordem);
select _aplicar_acesso('os_checklist', '{os}', '{os}');

-- quem marcou e quando (não dá para forjar pelo app)
create or replace function _os_checklist_marca()
returns trigger language plpgsql as $$
begin
  if new.feito and (tg_op = 'INSERT' or not old.feito) then
    new.feito_por := auth.uid(); new.feito_em := now();
  elsif not new.feito then
    new.feito_por := null; new.feito_em := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_os_checklist_marca on os_checklist;
create trigger trg_os_checklist_marca before insert or update of feito on os_checklist
  for each row execute function _os_checklist_marca();
