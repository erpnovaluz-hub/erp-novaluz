-- =============================================================================
-- CRM/ERP NOVALUZ — 0036 dados da empresa emissora (por empresa/tenant)
-- Antes os dados do cabeçalho de documentos (nome, CNPJ, endereço, telefone,
-- logo) eram fixos no código (MSFORT). Agora ficam por empresa, e os documentos
-- passam a usar a EMPRESA ATIVA (inclusive no modo suporte do superadmin).
-- =============================================================================

-- 1) Campos da emissora na própria empresa ----------------------------------
alter table empresas_consultoras add column if not exists endereco text;
alter table empresas_consultoras add column if not exists telefone text;
alter table empresas_consultoras add column if not exists logo     text;
alter table empresas_consultoras add column if not exists sistema  text;

-- 2) Empresa ativa atual (respeita modo suporte) ----------------------------
-- security definer: usuário comum lê os dados da sua empresa para o documento
-- sem precisar de policy de leitura ampla; super lê a empresa que está operando.
create or replace function empresa_atual()
returns setof empresas_consultoras
language sql stable security definer set search_path = public as $$
  select * from empresas_consultoras where id = auth_empresa_id()
$$;

-- 3) Storage: bucket público para os logos das empresas ---------------------
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

-- leitura pública (bucket é público, mas deixamos explícito)
drop policy if exists logos_read on storage.objects;
create policy logos_read on storage.objects
  for select using (bucket_id = 'logos');

-- envio/atualização por usuários autenticados (a tela de edição é só do super)
drop policy if exists logos_insert on storage.objects;
create policy logos_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'logos');

drop policy if exists logos_update on storage.objects;
create policy logos_update on storage.objects
  for update to authenticated using (bucket_id = 'logos') with check (bucket_id = 'logos');
