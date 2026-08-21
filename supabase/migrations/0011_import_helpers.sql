-- =============================================================================
-- CRM/ERP NOVALUZ — 0011 apoio à importação de histórico financeiro
-- Dá ao gatilho de baixa um "modo importação": quando a sessão define
-- app.pular_baixa = 'on', títulos já 'pago' são gravados como histórico SEM
-- gerar movimento de caixa (o dinheiro entrou/saiu antes do sistema existir).
-- No uso normal do app o gatilho continua igual (baixa move o caixa).
-- =============================================================================

create or replace function processar_baixa_titulo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- modo importação: preserva o status, não mexe no caixa
  if coalesce(current_setting('app.pular_baixa', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'pago' then
      if new.data_pagamento is null then new.data_pagamento := current_date; end if;
      perform _mov_caixa_do_titulo(new, 1);
    end if;
    return new;
  end if;

  -- UPDATE
  if old.status <> 'pago' and new.status = 'pago' then
    if new.data_pagamento is null then new.data_pagamento := current_date; end if;
    perform _mov_caixa_do_titulo(new, 1);
  elsif old.status = 'pago' and new.status <> 'pago' then
    perform _mov_caixa_do_titulo(old, -1);
    new.data_pagamento := null;
  end if;
  return new;
end $$;
