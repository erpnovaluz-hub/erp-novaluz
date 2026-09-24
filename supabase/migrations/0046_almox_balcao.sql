-- =============================================================================
-- CRM/ERP NOVALUZ — 0046 Almoxarifado · Bloco 2: balcão de entradas e saídas
--
-- vales_almox + vale_itens — todo movimento do balcão vira um vale numerado:
--   saida      VS-ANO-0001  retirada por um colaborador, destino OBRIGATÓRIO
--   devolucao  VD-ANO-0001  sobra que volta ao almoxarifado (mesmo destino)
--   entrada    VE-ANO-0001  entrada avulsa, sem pedido de compra (NF opcional)
-- Destino: OS, obra ou setor (centros_custo).
--   OS   → a saída entra nos insumos da OS (custo real da OS); devolução desconta
--   obra → movimento com origem 'producao' + referência da obra (vw_custo_obra)
--   setor→ movimento com origem 'vale'
-- Gravação só pela rpc registrar_vale (tudo ou nada). cancelar_vale estorna.
-- vw_diario_almox: diário item a item para relatório.
--
-- Depende de 0045 (_aplicar_acesso, ajuste com sinal).
-- =============================================================================

-- 0) origem 'vale' nas movimentações --------------------------------------------------
alter table movimentacoes_estoque drop constraint if exists movimentacoes_estoque_origem_check;
alter table movimentacoes_estoque add constraint movimentacoes_estoque_origem_check
  check (origem in ('manual','compra','producao','ajuste','inventario','vale'));

-- 1) Setores / centros de custo -----------------------------------------------------
create table if not exists centros_custo (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  nome                  text not null,
  ativo                 boolean not null default true,
  criado_em             timestamptz not null default now()
);
select _aplicar_acesso('centros_custo', '{estoque,os,requisicoes,compras}', '{estoque}');

-- 2) Vales ---------------------------------------------------------------------------
create table if not exists vales_almox (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  numero                text,
  tipo                  text not null check (tipo in ('saida','devolucao','entrada')),
  data                  timestamptz not null default now(),
  deposito_id           uuid not null references depositos(id),
  colaborador_id        uuid references colaboradores(id) on delete set null,
  destino_tipo          text check (destino_tipo in ('os','obra','setor')),
  os_id                 uuid references ordens_servico(id) on delete set null,
  obra_id               uuid references obras_servicos(id) on delete set null,
  centro_custo_id       uuid references centros_custo(id) on delete set null,
  fornecedor_id         uuid references fornecedores(id) on delete set null,
  nota_fiscal           text,
  observacao            text,
  status                text not null default 'ativo' check (status in ('ativo','cancelado')),
  criado_por            uuid references perfis(id) on delete set null default auth.uid(),
  cancelado_por         uuid references perfis(id) on delete set null,
  cancelado_em          timestamptz,
  motivo_cancelamento   text,
  criado_em             timestamptz not null default now()
);

create table if not exists vale_itens (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  vale_id               uuid not null references vales_almox(id) on delete cascade,
  produto_id            uuid not null references produtos(id),
  quantidade            numeric(14,3) not null check (quantidade > 0),
  custo_unitario        numeric(14,4),
  movimentacao_id       uuid references movimentacoes_estoque(id) on delete set null,
  insumo_os_id          uuid references insumos_os(id) on delete set null
);

create index if not exists idx_vales_empresa_data on vales_almox(empresa_consultora_id, data desc);
create index if not exists idx_vales_os    on vales_almox(os_id) where os_id is not null;
create index if not exists idx_vales_obra  on vales_almox(obra_id) where obra_id is not null;
create index if not exists idx_vale_itens  on vale_itens(vale_id);
create index if not exists idx_vale_itens_produto on vale_itens(produto_id);

-- leitura pelo módulo Estoque (e OS, para ver o que foi para cada OS);
-- gravação SÓ pelas rpcs abaixo (sem policy de insert/update/delete)
alter table vales_almox enable row level security;
alter table vale_itens  enable row level security;
drop policy if exists vales_ler on vales_almox;
drop policy if exists vale_itens_ler on vale_itens;
create policy vales_ler on vales_almox for select
  using (empresa_consultora_id = (select auth_empresa_id()) and (select pode('{estoque,os}'::text[], 'ver')));
create policy vale_itens_ler on vale_itens for select
  using (empresa_consultora_id = (select auth_empresa_id()) and (select pode('{estoque,os}'::text[], 'ver')));

-- 3) Registrar vale ------------------------------------------------------------------
-- p = { tipo, deposito_id, colaborador_id, destino_tipo, os_id, obra_id, centro_custo_id,
--       fornecedor_id, nota_fiscal, observacao, itens: [{produto_id, quantidade, custo_unitario}] }
create or replace function registrar_vale(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp     uuid := auth_empresa_id();
  v_tipo    text := p->>'tipo';
  v_dep     uuid := nullif(p->>'deposito_id','')::uuid;
  v_col     uuid := nullif(p->>'colaborador_id','')::uuid;
  v_dest    text := nullif(p->>'destino_tipo','');
  v_os      uuid := nullif(p->>'os_id','')::uuid;
  v_obra    uuid := nullif(p->>'obra_id','')::uuid;
  v_cc      uuid := nullif(p->>'centro_custo_id','')::uuid;
  v_vale    uuid;
  v_num     text;
  v_rot     text;
  it        jsonb;
  v_prod    produtos%rowtype;
  v_qtd     numeric(14,3);
  v_custo   numeric(14,4);
  v_saldo   numeric(14,3);
  v_mov     uuid;
  v_ins     uuid;
  v_origem  text;
  v_ref     uuid;
begin
  if not pode('{estoque}', 'editar') then raise exception 'Sem permissão no módulo Estoque'; end if;
  if v_tipo not in ('saida','devolucao','entrada') then raise exception 'Tipo de vale inválido'; end if;
  if not exists (select 1 from depositos where id = v_dep and empresa_consultora_id = v_emp) then
    raise exception 'Escolha o depósito';
  end if;
  if jsonb_array_length(coalesce(p->'itens','[]'::jsonb)) = 0 then raise exception 'Inclua pelo menos um item'; end if;

  if v_tipo in ('saida','devolucao') then
    if v_col is null or not exists (select 1 from colaboradores where id = v_col and empresa_consultora_id = v_emp) then
      raise exception 'Informe quem retirou/devolveu o material';
    end if;
    if v_dest = 'os' then
      if not exists (select 1 from ordens_servico where id = v_os and empresa_consultora_id = v_emp) then raise exception 'Escolha a OS de destino'; end if;
      v_obra := null; v_cc := null;
    elsif v_dest = 'obra' then
      if not exists (select 1 from obras_servicos where id = v_obra and empresa_consultora_id = v_emp) then raise exception 'Escolha a obra de destino'; end if;
      v_os := null; v_cc := null;
    elsif v_dest = 'setor' then
      if not exists (select 1 from centros_custo where id = v_cc and empresa_consultora_id = v_emp) then raise exception 'Escolha o setor de destino'; end if;
      v_os := null; v_obra := null;
    else
      raise exception 'O destino é obrigatório (OS, obra ou setor)';
    end if;
  else
    v_dest := null; v_os := null; v_obra := null; v_cc := null;
  end if;

  v_num := proximo_numero(case v_tipo when 'saida' then 'VS' when 'devolucao' then 'VD' else 'VE' end, 'vale_' || v_tipo);

  insert into vales_almox (empresa_consultora_id, numero, tipo, deposito_id, colaborador_id, destino_tipo, os_id, obra_id,
                           centro_custo_id, fornecedor_id, nota_fiscal, observacao)
  values (v_emp, v_num, v_tipo, v_dep, v_col, v_dest, v_os, v_obra, v_cc,
          case when v_tipo = 'entrada' then nullif(p->>'fornecedor_id','')::uuid end,
          nullif(trim(p->>'nota_fiscal'),''), nullif(trim(p->>'observacao'),''))
  returning id into v_vale;

  -- obra: origem 'producao' com referência da obra (entra no vw_custo_obra); demais: 'vale'
  v_origem := case when v_obra is not null then 'producao' else 'vale' end;
  v_ref    := coalesce(v_obra, v_vale);
  v_rot    := v_num || case v_tipo when 'saida' then ' (saída)' when 'devolucao' then ' (devolução)' else ' (entrada avulsa)' end;

  for it in select * from jsonb_array_elements(p->'itens') loop
    select * into v_prod from produtos where id = (it->>'produto_id')::uuid and empresa_consultora_id = v_emp;
    if not found then raise exception 'Produto não encontrado'; end if;
    v_qtd := (it->>'quantidade')::numeric;
    if v_qtd is null or v_qtd <= 0 then raise exception 'Quantidade inválida para %', v_prod.nome; end if;
    v_ins := null;

    if v_tipo = 'saida' then
      select coalesce(quantidade, 0) into v_saldo from saldos_estoque where produto_id = v_prod.id and deposito_id = v_dep;
      if coalesce(v_saldo, 0) < v_qtd then
        raise exception 'Estoque insuficiente de "%": saldo % %, pedido % %',
          v_prod.nome, coalesce(v_saldo, 0), coalesce(v_prod.unidade, ''), v_qtd, coalesce(v_prod.unidade, '');
      end if;
      insert into movimentacoes_estoque (empresa_consultora_id, produto_id, deposito_id, tipo, quantidade, origem, referencia_id, observacao)
      values (v_emp, v_prod.id, v_dep, 'saida', v_qtd, v_origem, v_ref, v_rot)
      returning id, custo_unitario into v_mov, v_custo;
      if v_os is not null then
        insert into insumos_os (empresa_consultora_id, os_id, produto_id, descricao, quantidade, custo_unitario)
        values (v_emp, v_os, v_prod.id, v_prod.nome || ' · ' || v_num, v_qtd, round(coalesce(v_custo, 0), 2))
        returning id into v_ins;
      end if;

    else
      -- devolução volta pelo custo médio atual; entrada avulsa usa o custo informado (ou o médio)
      v_custo := case when v_tipo = 'entrada' then coalesce(nullif(it->>'custo_unitario','')::numeric, v_prod.custo_medio, 0)
                      else coalesce(v_prod.custo_medio, 0) end;
      insert into movimentacoes_estoque (empresa_consultora_id, produto_id, deposito_id, tipo, quantidade, custo_unitario, origem, referencia_id, observacao)
      values (v_emp, v_prod.id, v_dep, 'entrada', v_qtd, v_custo, v_origem, v_ref, v_rot)
      returning id into v_mov;
      if v_tipo = 'devolucao' and v_os is not null then
        insert into insumos_os (empresa_consultora_id, os_id, produto_id, descricao, quantidade, custo_unitario)
        values (v_emp, v_os, v_prod.id, v_prod.nome || ' · devolução ' || v_num, -v_qtd, round(v_custo, 2))
        returning id into v_ins;
      end if;
    end if;

    insert into vale_itens (empresa_consultora_id, vale_id, produto_id, quantidade, custo_unitario, movimentacao_id, insumo_os_id)
    values (v_emp, v_vale, v_prod.id, v_qtd, v_custo, v_mov, v_ins);
  end loop;

  return jsonb_build_object('id', v_vale, 'numero', v_num);
end $$;

-- 4) Cancelar vale (estorna o estoque e o custo da OS) ----------------------------------
-- almoxarifado: só no mesmo dia; gerência: a qualquer tempo
create or replace function cancelar_vale(p_vale uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v   vales_almox%rowtype;
  it  record;
  v_saldo numeric(14,3);
begin
  if not pode('{estoque}', 'editar') then raise exception 'Sem permissão no módulo Estoque'; end if;
  select * into v from vales_almox where id = p_vale for update;
  if not found or v.empresa_consultora_id <> auth_empresa_id() then raise exception 'Vale não encontrado'; end if;
  if v.status = 'cancelado' then raise exception 'Vale já cancelado'; end if;
  if nullif(trim(p_motivo), '') is null then raise exception 'Informe o motivo do cancelamento'; end if;
  if not is_gerente() and (v.data at time zone 'America/Sao_Paulo')::date <> (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Só a gerência cancela vales de dias anteriores';
  end if;

  for it in select vi.*, m.origem, m.referencia_id, p.nome
              from vale_itens vi
              left join movimentacoes_estoque m on m.id = vi.movimentacao_id
              join produtos p on p.id = vi.produto_id
             where vi.vale_id = p_vale
  loop
    if v.tipo = 'saida' then
      insert into movimentacoes_estoque (empresa_consultora_id, produto_id, deposito_id, tipo, quantidade, custo_unitario, origem, referencia_id, observacao)
      values (v.empresa_consultora_id, it.produto_id, v.deposito_id, 'entrada', it.quantidade, coalesce(it.custo_unitario, 0),
              coalesce(it.origem, 'vale'), coalesce(it.referencia_id, v.id), 'Estorno ' || v.numero || ' (cancelado)');
    else
      select coalesce(quantidade, 0) into v_saldo from saldos_estoque where produto_id = it.produto_id and deposito_id = v.deposito_id;
      if coalesce(v_saldo, 0) < it.quantidade then
        raise exception 'Não dá para cancelar: "%" já saiu do estoque (saldo %)', it.nome, coalesce(v_saldo, 0);
      end if;
      insert into movimentacoes_estoque (empresa_consultora_id, produto_id, deposito_id, tipo, quantidade, origem, referencia_id, observacao)
      values (v.empresa_consultora_id, it.produto_id, v.deposito_id, 'saida', it.quantidade,
              coalesce(it.origem, 'vale'), coalesce(it.referencia_id, v.id), 'Estorno ' || v.numero || ' (cancelado)');
    end if;
    if it.insumo_os_id is not null then delete from insumos_os where id = it.insumo_os_id; end if;
  end loop;

  update vales_almox set status = 'cancelado', cancelado_por = auth.uid(), cancelado_em = now(),
                         motivo_cancelamento = trim(p_motivo)
   where id = p_vale;
end $$;

grant execute on function registrar_vale(jsonb) to authenticated;
grant execute on function cancelar_vale(uuid, text) to authenticated;

-- 5) Custo da obra passa a descontar devoluções/estornos ---------------------------------
create or replace view vw_custo_obra as
select
  o.id                     as obra_id,
  o.empresa_consultora_id,
  o.local,
  o.cliente_id,
  o.custo_orcado,
  coalesce(mat.total, 0)   as custo_material,
  coalesce(mao.total, 0)   as custo_mao_obra,
  coalesce(mat.total, 0) + coalesce(mao.total, 0) as custo_real,
  o.custo_orcado - (coalesce(mat.total, 0) + coalesce(mao.total, 0)) as saldo_orcamento
from obras_servicos o
left join (
  select referencia_id as obra_id,
         sum(case when tipo = 'saida' then 1 else -1 end * quantidade * coalesce(custo_unitario, 0)) as total
  from movimentacoes_estoque
  where origem = 'producao' and tipo in ('saida','entrada')
  group by referencia_id
) mat on mat.obra_id = o.id
left join (
  select a.obra_id, sum(a.horas_trabalhadas * c.custo_hora) as total
  from alocacao_equipe a
  join colaboradores c on c.id = a.colaborador_id
  group by a.obra_id
) mao on mao.obra_id = o.id;
alter view vw_custo_obra set (security_invoker = on);

-- 6) Diário do almoxarifado (1 linha por item de vale) ---------------------------------
create or replace view vw_diario_almox as
select
  vi.id                         as item_id,
  v.id                          as vale_id,
  v.empresa_consultora_id,
  v.numero,
  v.tipo,
  v.status,
  v.data,
  (v.data at time zone 'America/Sao_Paulo')::date as dia,
  v.deposito_id,
  d.nome                        as deposito_nome,
  v.colaborador_id,
  e.nome                        as colaborador_nome,
  v.destino_tipo,
  v.os_id, v.obra_id, v.centro_custo_id,
  case v.destino_tipo
    when 'os'    then concat_ws(' · ', os.numero, os.titulo)
    when 'obra'  then ob.local
    when 'setor' then cc.nome
  end                           as destino_nome,
  f.nome                        as fornecedor_nome,
  v.nota_fiscal,
  v.observacao,
  vi.produto_id,
  p.codigo                      as produto_codigo,
  p.nome                        as produto_nome,
  p.unidade,
  p.secao,
  vi.quantidade,
  vi.custo_unitario,
  round(vi.quantidade * coalesce(vi.custo_unitario, 0), 2) as valor
from vale_itens vi
join vales_almox v      on v.id = vi.vale_id
join produtos p         on p.id = vi.produto_id
left join depositos d   on d.id = v.deposito_id
left join vw_equipe e   on e.id = v.colaborador_id
left join ordens_servico os on os.id = v.os_id
left join obras_servicos ob on ob.id = v.obra_id
left join centros_custo cc  on cc.id = v.centro_custo_id
left join fornecedores f    on f.id = v.fornecedor_id;
alter view vw_diario_almox set (security_invoker = on);
revoke all on vw_diario_almox from anon;
grant select on vw_diario_almox to authenticated;
