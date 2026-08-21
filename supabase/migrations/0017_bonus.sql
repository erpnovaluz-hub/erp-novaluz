-- =============================================================================
-- CRM/ERP NOVALUZ — 0017 BÔNUS de produção
-- Regras por tipo de peça (mínimo/dia, bônus fixo, bônus por 50 acima do mínimo)
-- + produção diária de bônus por funcionário (contagem LD/LP/LPP/NA).
-- Cálculo: por dia, se contagem do tipo >= mínimo ->
--          fixo + floor((contagem - mínimo)/50) * bonus_por_50. Somado no intervalo.
-- =============================================================================

create table if not exists bonus_regras (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  tipo                  text not null,          -- LD | LP | LPP
  minimo                numeric(12,2) not null default 0,   -- peças/dia
  bonus_fixo            numeric(12,2) not null default 0,
  bonus_por_50          numeric(12,2) not null default 0,
  ativo                 boolean not null default true
);
create unique index if not exists uq_bonus_regra_tipo on bonus_regras(empresa_consultora_id, tipo);

create table if not exists bonus_producao (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  data                  date not null,
  colaborador_id        uuid references colaboradores(id) on delete set null,
  ld                    numeric(12,2) not null default 0,
  lp                    numeric(12,2) not null default 0,
  lpp                   numeric(12,2) not null default 0,
  na                    numeric(12,2) not null default 0
);
create index if not exists idx_bonus_prod_data  on bonus_producao(empresa_consultora_id, data);
create index if not exists idx_bonus_prod_colab on bonus_producao(colaborador_id);

do $$
declare t text;
begin
  foreach t in array array['bonus_regras','bonus_producao'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists tenant_all on %I;', t);
    execute format($f$
      create policy tenant_all on %I
        using (empresa_consultora_id = auth_empresa_id())
        with check (empresa_consultora_id = auth_empresa_id());
    $f$, t);
  end loop;
end $$;
