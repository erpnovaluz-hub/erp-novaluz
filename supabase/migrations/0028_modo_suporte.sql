-- =============================================================================
-- CRM/ERP NOVALUZ — 0028 modo suporte (super admin "entra" numa empresa)
-- O super admin escolhe uma empresa_ativa; auth_empresa_id() passa a apontar
-- para ela, e todo o RLS operacional escopa àquela empresa (ver/editar tudo).
-- =============================================================================

alter table perfis add column if not exists empresa_ativa uuid references empresas_consultoras(id) on delete set null;

-- super com empresa_ativa definida "vira" aquela empresa; demais usam a sua
create or replace function auth_empresa_id()
returns uuid language sql stable security definer set search_path = public as $$
  select case
           when papel = 'super' and empresa_ativa is not null then empresa_ativa
           else empresa_consultora_id
         end
  from perfis where id = auth.uid()
$$;
