-- =============================================================================
-- CRM/ERP NOVALUZ — 0027 administrador central (multiempresa)
-- Papel 'super' = admin central: enxerga/gerencia todas as empresas e perfis.
-- Usuários normais continuam isolados na sua empresa (RLS já existente).
-- =============================================================================

alter table perfis add column if not exists email text;

-- é super admin?
create or replace function is_super()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfis where id = auth.uid() and papel = 'super')
$$;

-- empresas_consultoras: super vê todas e pode criar/editar; usuário vê a sua
drop policy if exists empresa_self on empresas_consultoras;
drop policy if exists empresa_acesso on empresas_consultoras;
create policy empresa_acesso on empresas_consultoras
  using (id = auth_empresa_id() or is_super())
  with check (is_super());

-- perfis: super gerencia todos; usuário vê/edita o próprio
drop policy if exists perfis_self on perfis;
drop policy if exists perfis_acesso on perfis;
create policy perfis_acesso on perfis
  using (id = auth.uid() or is_super())
  with check (is_super() or id = auth.uid());
