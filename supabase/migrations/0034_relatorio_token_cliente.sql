-- =============================================================================
-- CRM/ERP NOVALUZ — 0034 token público do relatório por cliente
-- Cada cliente ganha um token opaco e único, usado no link público do
-- relatório de produção (/publico/relatorio/{token}). Assim o link não expõe
-- o cliente_id e não pode ser editado para acessar outro cliente.
-- Depende de 0001 (clientes).
-- =============================================================================

alter table clientes add column if not exists relatorio_token text;

-- gera token para clientes já existentes (32 chars hex, sem hífens)
update clientes
   set relatorio_token = replace(gen_random_uuid()::text, '-', '')
 where relatorio_token is null;

-- novos clientes já nascem com token
alter table clientes
  alter column relatorio_token set default replace(gen_random_uuid()::text, '-', '');

create unique index if not exists uq_clientes_relatorio_token on clientes(relatorio_token);
