-- =============================================================================
-- CRM/ERP NOVALUZ — 0020 dados do cliente para documentos (proposta/contrato)
-- =============================================================================
alter table clientes
  add column if not exists cnpj      text,
  add column if not exists telefone  text,
  add column if not exists email     text,
  add column if not exists endereco  text;
