-- =============================================================================
-- CRM/ERP NOVALUZ — 0059 Forma de pagamento (fornecedor → pedido → título)
--
-- forma_pagamento: pix | boleto | transferencia | cartao | dinheiro | cheque
-- dados_pagamento: texto livre (chave PIX, banco/agência/conta, condição…)
--
-- fornecedores        guardam o padrão
-- pedidos_compra      herdam do fornecedor ao criar (ou ao trocar de fornecedor),
--                     se estiverem vazios; podem ser alterados no pedido
-- titulos_financeiros título gerado pelo recebimento (origem 'compra') herda do
--                     pedido; título avulso de fornecedor herda do fornecedor.
--                     O financeiro vê/edita em Contas a Pagar.
--
-- ATENÇÃO (SQL Editor do Supabase): escalares por atribuição, sem "select ... into" — ver 0050.
-- =============================================================================

alter table fornecedores        add column if not exists forma_pagamento text;
alter table fornecedores        add column if not exists dados_pagamento text;
alter table pedidos_compra      add column if not exists forma_pagamento text;
alter table pedidos_compra      add column if not exists dados_pagamento text;
alter table titulos_financeiros add column if not exists forma_pagamento text;
alter table titulos_financeiros add column if not exists dados_pagamento text;

alter table fornecedores drop constraint if exists fornecedores_forma_pagamento_check;
alter table fornecedores add constraint fornecedores_forma_pagamento_check
  check (forma_pagamento in ('pix','boleto','transferencia','cartao','dinheiro','cheque'));
alter table pedidos_compra drop constraint if exists pedidos_compra_forma_pagamento_check;
alter table pedidos_compra add constraint pedidos_compra_forma_pagamento_check
  check (forma_pagamento in ('pix','boleto','transferencia','cartao','dinheiro','cheque'));
alter table titulos_financeiros drop constraint if exists titulos_financeiros_forma_pagamento_check;
alter table titulos_financeiros add constraint titulos_financeiros_forma_pagamento_check
  check (forma_pagamento in ('pix','boleto','transferencia','cartao','dinheiro','cheque'));

-- pedido: completa com o padrão do fornecedor ---------------------------------------------
create or replace function _pedido_pagamento_padrao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.fornecedor_id is not null
     and (tg_op = 'INSERT' or new.fornecedor_id is distinct from old.fornecedor_id) then
    if new.forma_pagamento is null then
      new.forma_pagamento := (select forma_pagamento from fornecedores where id = new.fornecedor_id);
    end if;
    if nullif(trim(new.dados_pagamento), '') is null then
      new.dados_pagamento := (select dados_pagamento from fornecedores where id = new.fornecedor_id);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_pedido_pagamento_padrao on pedidos_compra;
create trigger trg_pedido_pagamento_padrao before insert or update of fornecedor_id on pedidos_compra
  for each row execute function _pedido_pagamento_padrao();

-- título: herda do pedido (compra) ou do fornecedor ---------------------------------------
create or replace function _titulo_pagamento_padrao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tipo <> 'pagar' then return new; end if;
  if new.origem = 'compra' and new.referencia_id is not null then
    if new.forma_pagamento is null then
      new.forma_pagamento := (select forma_pagamento from pedidos_compra where id = new.referencia_id);
    end if;
    if nullif(trim(new.dados_pagamento), '') is null then
      new.dados_pagamento := (select dados_pagamento from pedidos_compra where id = new.referencia_id);
    end if;
  end if;
  if new.fornecedor_id is not null then
    if new.forma_pagamento is null then
      new.forma_pagamento := (select forma_pagamento from fornecedores where id = new.fornecedor_id);
    end if;
    if nullif(trim(new.dados_pagamento), '') is null then
      new.dados_pagamento := (select dados_pagamento from fornecedores where id = new.fornecedor_id);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_titulo_pagamento_padrao on titulos_financeiros;
create trigger trg_titulo_pagamento_padrao before insert on titulos_financeiros
  for each row execute function _titulo_pagamento_padrao();
