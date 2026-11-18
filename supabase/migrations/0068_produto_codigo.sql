-- Código do produto gerado pelo sistema: PRD-0001, PRD-0002… (sequencial por empresa, sem ano)
-- Se o código vier preenchido (ex.: importação de planilha com código do fornecedor), ele é mantido.

create or replace function proximo_codigo_produto(p_emp uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_emp uuid := coalesce(p_emp, auth_empresa_id()); v_n int;
begin
  insert into sequencias (empresa_consultora_id, tipo, ano, ultimo) values (v_emp, 'produto', 0, 1)
  on conflict (empresa_consultora_id, tipo, ano) do update set ultimo = sequencias.ultimo + 1
  returning ultimo into v_n;
  return 'PRD-' || lpad(v_n::text, greatest(4, length(v_n::text)), '0');
end $$;

create or replace function _produto_codigo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.codigo is null or trim(new.codigo) = '' then
    new.codigo := proximo_codigo_produto(new.empresa_consultora_id);
  end if;
  new.codigo := upper(trim(new.codigo));
  return new;
end $$;

drop trigger if exists trg_produto_codigo on produtos;
create trigger trg_produto_codigo before insert on produtos for each row execute function _produto_codigo();

-- Backfill: produtos sem código, ou com código que é só o começo do id (gerado por importação antiga),
-- recebem código sequencial, em ordem alfabética de nome.
do $$
declare r record;
begin
  for r in
    select id, empresa_consultora_id from produtos
    where codigo is null or trim(codigo) = '' or lower(trim(codigo)) = left(id::text, 8)
    order by empresa_consultora_id, lower(nome)
  loop
    update produtos set codigo = proximo_codigo_produto(r.empresa_consultora_id) where id = r.id;
  end loop;
end $$;
