-- =============================================================================
-- CRM/ERP NOVALUZ — 0055 token público de acompanhamento da OS
-- Cada OS ganha um token opaco e único, usado no QR code da OS impressa
-- (/publico/os/{token}). A página mostra status, progresso, atividades, fotos e
-- histórico — sem valores — e não expõe o id da OS na URL.
-- Depende de 0016 (ordens_servico).
-- =============================================================================

alter table ordens_servico add column if not exists acompanhamento_token text;

-- gera token para OS já existentes (32 chars hex, sem hífens)
update ordens_servico
   set acompanhamento_token = replace(gen_random_uuid()::text, '-', '')
 where acompanhamento_token is null;

-- novas OS já nascem com token
alter table ordens_servico
  alter column acompanhamento_token set default replace(gen_random_uuid()::text, '-', '');

create unique index if not exists uq_os_acompanhamento_token on ordens_servico(acompanhamento_token);
