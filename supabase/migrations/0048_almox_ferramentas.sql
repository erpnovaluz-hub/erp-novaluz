-- =============================================================================
-- CRM/ERP NOVALUZ — 0048 Almoxarifado · Bloco 4: ferramentas e equipamentos
--
-- ferramentas        patrimônio por UNIDADE (FER-0001), com status:
--                    disponivel · em_uso · manutencao · extraviada · baixada
-- cautelas (+itens)  retirada de 1+ ferramentas por um colaborador, com destino
--                    obrigatório e previsão de devolução (CT-ANO-0001);
--                    devolução por item, com estado (danificada → manutenção)
-- ferramenta_eventos linha do tempo de cada ferramenta
-- Automações novas:  ferramenta_atrasada (cautela vencida) e
--                    manutencao_ferramenta (próxima manutenção chegando)
-- Compras:           produto com controla_patrimonio → no recebimento cada
--                    unidade vira uma ferramenta (não entra no saldo de estoque)
--
-- Depende de 0043 (automações), 0045 (_aplicar_acesso), 0046, 0047.
-- =============================================================================

-- 1) Cadastro ------------------------------------------------------------------------------
alter table produtos add column if not exists controla_patrimonio boolean not null default false;

create table if not exists ferramentas (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  codigo                text,
  descricao             text not null,
  categoria             text not null default 'ferramenta_manual' check (categoria in
                          ('ferramenta_manual','ferramenta_eletrica','equipamento','instrumento_medicao','epi_duravel','veiculo','outro')),
  marca                 text,
  modelo                text,
  numero_serie          text,
  valor_aquisicao       numeric(14,2),
  data_aquisicao        date,
  fornecedor_id         uuid references fornecedores(id) on delete set null,
  pedido_id             uuid references pedidos_compra(id) on delete set null,
  produto_id            uuid references produtos(id) on delete set null,
  deposito_id           uuid references depositos(id) on delete set null,     -- onde fica guardada
  status                text not null default 'disponivel' check (status in ('disponivel','em_uso','manutencao','extraviada','baixada')),
  estado                text not null default 'bom' check (estado in ('novo','bom','regular','ruim')),
  foto_caminho          text,
  proxima_manutencao    date,
  periodicidade_dias    int check (periodicidade_dias is null or periodicidade_dias > 0),
  observacao            text,
  criado_em             timestamptz not null default now(),
  unique (empresa_consultora_id, codigo)
);
create index if not exists idx_ferramentas_status on ferramentas(empresa_consultora_id, status);

-- código sequencial sem ano (etiqueta permanente): FER-0001
create or replace function proximo_codigo_patrimonio(p_emp uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_emp uuid := coalesce(p_emp, auth_empresa_id()); v_n int;
begin
  insert into sequencias (empresa_consultora_id, tipo, ano, ultimo) values (v_emp, 'patrimonio', 0, 1)
  on conflict (empresa_consultora_id, tipo, ano) do update set ultimo = sequencias.ultimo + 1
  returning ultimo into v_n;
  return 'FER-' || lpad(v_n::text, 4, '0');
end $$;

create or replace function _ferramenta_codigo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.codigo is null or trim(new.codigo) = '' then new.codigo := proximo_codigo_patrimonio(new.empresa_consultora_id); end if;
  new.codigo := upper(trim(new.codigo));
  return new;
end $$;
drop trigger if exists trg_ferramenta_codigo on ferramentas;
create trigger trg_ferramenta_codigo before insert on ferramentas for each row execute function _ferramenta_codigo();

create table if not exists ferramenta_eventos (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  ferramenta_id         uuid not null references ferramentas(id) on delete cascade,
  tipo                  text not null check (tipo in ('cadastro','cautela','devolucao','manutencao_envio','manutencao_retorno',
                                                    'extravio','baixa','reativacao','edicao')),
  data                  timestamptz not null default now(),
  colaborador_id        uuid references colaboradores(id) on delete set null,
  cautela_id            uuid,
  descricao             text,
  custo                 numeric(14,2),
  usuario_id            uuid references perfis(id) on delete set null default auth.uid()
);
create index if not exists idx_ferramenta_eventos on ferramenta_eventos(ferramenta_id, data desc);

-- 2) Cautelas -----------------------------------------------------------------------------
create table if not exists cautelas (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  numero                text,
  colaborador_id        uuid not null references colaboradores(id),
  destino_tipo          text not null check (destino_tipo in ('os','obra','setor')),
  os_id                 uuid references ordens_servico(id) on delete set null,
  obra_id               uuid references obras_servicos(id) on delete set null,
  centro_custo_id       uuid references centros_custo(id) on delete set null,
  data_saida            timestamptz not null default now(),
  previsao_devolucao    date,
  status                text not null default 'aberta' check (status in ('aberta','parcial','devolvida')),
  observacao            text,
  entregue_por          uuid references perfis(id) on delete set null default auth.uid(),
  criado_em             timestamptz not null default now()
);

create table if not exists cautela_itens (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  cautela_id            uuid not null references cautelas(id) on delete cascade,
  ferramenta_id         uuid not null references ferramentas(id),
  estado_saida          text,
  devolvido_em          timestamptz,
  estado_devolucao      text check (estado_devolucao in ('bom','regular','ruim','danificada','extraviada')),
  obs_devolucao         text,
  recebido_por          uuid references perfis(id) on delete set null
);
create index if not exists idx_cautela_itens on cautela_itens(cautela_id);
create index if not exists idx_cautela_itens_ferr on cautela_itens(ferramenta_id) where devolvido_em is null;
alter table ferramenta_eventos drop constraint if exists ferramenta_eventos_cautela_fk;
alter table ferramenta_eventos add constraint ferramenta_eventos_cautela_fk foreign key (cautela_id) references cautelas(id) on delete set null;

-- 3) Acesso -------------------------------------------------------------------------------
-- cadastro editável pelo Estoque; logística/OS enxergam onde está cada ferramenta
select _aplicar_acesso('ferramentas', '{estoque,os}', '{estoque}');
-- cautelas, itens e eventos: só leitura (gravação pelas rpcs)
alter table cautelas enable row level security;
alter table cautela_itens enable row level security;
alter table ferramenta_eventos enable row level security;
drop policy if exists cautelas_ler on cautelas;
drop policy if exists cautela_itens_ler on cautela_itens;
drop policy if exists ferr_eventos_ler on ferramenta_eventos;
create policy cautelas_ler on cautelas for select
  using (empresa_consultora_id = (select auth_empresa_id()) and (select pode('{estoque,os}'::text[], 'ver')));
create policy cautela_itens_ler on cautela_itens for select
  using (empresa_consultora_id = (select auth_empresa_id()) and (select pode('{estoque,os}'::text[], 'ver')));
create policy ferr_eventos_ler on ferramenta_eventos for select
  using (empresa_consultora_id = (select auth_empresa_id()) and (select pode('{estoque,os}'::text[], 'ver')));

-- evento de cadastro automático
create or replace function _ferramenta_cadastro_evento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into ferramenta_eventos (empresa_consultora_id, ferramenta_id, tipo, descricao)
  values (new.empresa_consultora_id, new.id, 'cadastro',
          case when new.pedido_id is not null then 'Entrou pelo recebimento de compra' else 'Cadastrada' end);
  return new;
end $$;
drop trigger if exists trg_ferramenta_cadastro on ferramentas;
create trigger trg_ferramenta_cadastro after insert on ferramentas for each row execute function _ferramenta_cadastro_evento();

-- 4) Rpcs ---------------------------------------------------------------------------------
-- p = {colaborador_id, destino_tipo, os_id, obra_id, centro_custo_id, previsao_devolucao, observacao,
--      ferramentas: [uuid, ...]}
create or replace function cautelar_ferramentas(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp  uuid := auth_empresa_id();
  v_col  uuid := nullif(p->>'colaborador_id','')::uuid;
  v_dest text := nullif(p->>'destino_tipo','');
  v_os   uuid := nullif(p->>'os_id','')::uuid;
  v_obra uuid := nullif(p->>'obra_id','')::uuid;
  v_cc   uuid := nullif(p->>'centro_custo_id','')::uuid;
  v_id   uuid;
  v_num  text;
  v_f    ferramentas%rowtype;
  v_fid  text;
  v_dnome text;
begin
  if not pode('{estoque}', 'editar') then raise exception 'Sem permissão no módulo Estoque'; end if;
  if v_col is null or not exists (select 1 from colaboradores where id = v_col and empresa_consultora_id = v_emp) then
    raise exception 'Informe quem está retirando';
  end if;
  if v_dest = 'os' then
    select concat_ws(' · ', numero, titulo) into v_dnome from ordens_servico where id = v_os and empresa_consultora_id = v_emp;
    v_obra := null; v_cc := null;
  elsif v_dest = 'obra' then
    select local into v_dnome from obras_servicos where id = v_obra and empresa_consultora_id = v_emp;
    v_os := null; v_cc := null;
  elsif v_dest = 'setor' then
    select nome into v_dnome from centros_custo where id = v_cc and empresa_consultora_id = v_emp;
    v_os := null; v_obra := null;
  end if;
  if v_dnome is null then raise exception 'O destino é obrigatório (OS, obra ou setor)'; end if;
  if jsonb_array_length(coalesce(p->'ferramentas','[]'::jsonb)) = 0 then raise exception 'Inclua pelo menos uma ferramenta'; end if;

  v_num := proximo_numero('CT', 'cautela');
  insert into cautelas (empresa_consultora_id, numero, colaborador_id, destino_tipo, os_id, obra_id, centro_custo_id,
                        previsao_devolucao, observacao)
  values (v_emp, v_num, v_col, v_dest, v_os, v_obra, v_cc, nullif(p->>'previsao_devolucao','')::date, nullif(trim(p->>'observacao'),''))
  returning id into v_id;

  for v_fid in select jsonb_array_elements_text(p->'ferramentas') loop
    select * into v_f from ferramentas where id = v_fid::uuid and empresa_consultora_id = v_emp for update;
    if not found then raise exception 'Ferramenta não encontrada'; end if;
    if v_f.status <> 'disponivel' then raise exception '% (%) não está disponível: %', v_f.descricao, v_f.codigo, v_f.status; end if;
    insert into cautela_itens (empresa_consultora_id, cautela_id, ferramenta_id, estado_saida) values (v_emp, v_id, v_f.id, v_f.estado);
    update ferramentas set status = 'em_uso' where id = v_f.id;
    insert into ferramenta_eventos (empresa_consultora_id, ferramenta_id, tipo, colaborador_id, cautela_id, descricao)
    values (v_emp, v_f.id, 'cautela', v_col, v_id, v_num || ' → ' || v_dnome
            || coalesce(' · devolver até ' || to_char(nullif(p->>'previsao_devolucao','')::date, 'DD/MM/YYYY'), ''));
  end loop;
  return jsonb_build_object('id', v_id, 'numero', v_num);
end $$;

-- p = {itens: [{cautela_item_id, estado ('bom'|'regular'|'ruim'|'danificada'|'extraviada'), observacao}]}
create or replace function devolver_ferramentas(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := auth_empresa_id();
  it    jsonb;
  ci    cautela_itens%rowtype;
  c     cautelas%rowtype;
  v_est text;
  v_ids uuid[] := '{}';
begin
  if not pode('{estoque}', 'editar') then raise exception 'Sem permissão no módulo Estoque'; end if;
  for it in select * from jsonb_array_elements(coalesce(p->'itens','[]'::jsonb)) loop
    select * into ci from cautela_itens where id = (it->>'cautela_item_id')::uuid and empresa_consultora_id = v_emp for update;
    if not found then raise exception 'Item de cautela não encontrado'; end if;
    if ci.devolvido_em is not null then continue; end if;
    v_est := coalesce(nullif(it->>'estado',''), 'bom');
    if v_est not in ('bom','regular','ruim','danificada','extraviada') then raise exception 'Estado inválido: %', v_est; end if;
    select * into c from cautelas where id = ci.cautela_id;

    update cautela_itens set devolvido_em = now(), estado_devolucao = v_est, obs_devolucao = nullif(trim(it->>'observacao'),''),
           recebido_por = auth.uid()
     where id = ci.id;
    update ferramentas
       set status = case v_est when 'danificada' then 'manutencao' when 'extraviada' then 'extraviada' else 'disponivel' end,
           estado = case when v_est in ('bom','regular','ruim') then v_est else estado end
     where id = ci.ferramenta_id;
    insert into ferramenta_eventos (empresa_consultora_id, ferramenta_id, tipo, colaborador_id, cautela_id, descricao)
    values (v_emp, ci.ferramenta_id, case when v_est = 'extraviada' then 'extravio' else 'devolucao' end, c.colaborador_id, c.id,
            'Devolução ' || c.numero || ' · estado: ' || v_est || coalesce(' · ' || nullif(trim(it->>'observacao'),''), ''));
    if v_est = 'danificada' then
      insert into ferramenta_eventos (empresa_consultora_id, ferramenta_id, tipo, descricao)
      values (v_emp, ci.ferramenta_id, 'manutencao_envio', 'Voltou danificada — aguardando manutenção');
    end if;
    v_ids := v_ids || c.id;
  end loop;

  update cautelas k set status = case
      when not exists (select 1 from cautela_itens x where x.cautela_id = k.id and x.devolvido_em is null) then 'devolvida'
      else 'parcial' end
   where k.id = any (v_ids);
end $$;

-- manutenção / baixa / extravio / reativação fora da cautela
-- p_acao: 'enviar_manutencao' | 'retornar_manutencao' | 'baixar' | 'extraviar' | 'reativar'
create or replace function movimentar_ferramenta(p_ferramenta uuid, p_acao text, p_descricao text default null,
                                                 p_custo numeric default null, p_proxima date default null)
returns void language plpgsql security definer set search_path = public as $$
declare f ferramentas%rowtype;
begin
  if not pode('{estoque}', 'editar') then raise exception 'Sem permissão no módulo Estoque'; end if;
  select * into f from ferramentas where id = p_ferramenta and empresa_consultora_id = auth_empresa_id() for update;
  if not found then raise exception 'Ferramenta não encontrada'; end if;
  if f.status = 'em_uso' and p_acao <> 'extraviar' then raise exception 'Ferramenta está em uso: registre a devolução primeiro'; end if;

  if p_acao = 'enviar_manutencao' then
    update ferramentas set status = 'manutencao' where id = f.id;
    insert into ferramenta_eventos (empresa_consultora_id, ferramenta_id, tipo, descricao)
    values (f.empresa_consultora_id, f.id, 'manutencao_envio', coalesce(nullif(trim(p_descricao),''), 'Enviada para manutenção'));
  elsif p_acao = 'retornar_manutencao' then
    update ferramentas set status = 'disponivel', estado = case when estado = 'ruim' then 'regular' else estado end,
           proxima_manutencao = coalesce(p_proxima, case when periodicidade_dias is not null then current_date + periodicidade_dias end, proxima_manutencao)
     where id = f.id;
    insert into ferramenta_eventos (empresa_consultora_id, ferramenta_id, tipo, descricao, custo)
    values (f.empresa_consultora_id, f.id, 'manutencao_retorno', coalesce(nullif(trim(p_descricao),''), 'Voltou da manutenção'),
            case when is_gerente() then p_custo end);
  elsif p_acao = 'baixar' then
    if nullif(trim(p_descricao),'') is null then raise exception 'Informe o motivo da baixa'; end if;
    update ferramentas set status = 'baixada' where id = f.id;
    insert into ferramenta_eventos (empresa_consultora_id, ferramenta_id, tipo, descricao)
    values (f.empresa_consultora_id, f.id, 'baixa', trim(p_descricao));
  elsif p_acao = 'extraviar' then
    if nullif(trim(p_descricao),'') is null then raise exception 'Descreva o extravio'; end if;
    update ferramentas set status = 'extraviada' where id = f.id;
    update cautela_itens set devolvido_em = now(), estado_devolucao = 'extraviada', obs_devolucao = trim(p_descricao), recebido_por = auth.uid()
     where ferramenta_id = f.id and devolvido_em is null;
    update cautelas k set status = case
        when not exists (select 1 from cautela_itens x where x.cautela_id = k.id and x.devolvido_em is null) then 'devolvida' else 'parcial' end
     where k.id in (select cautela_id from cautela_itens where ferramenta_id = f.id);
    insert into ferramenta_eventos (empresa_consultora_id, ferramenta_id, tipo, descricao)
    values (f.empresa_consultora_id, f.id, 'extravio', trim(p_descricao));
  elsif p_acao = 'reativar' then
    update ferramentas set status = 'disponivel' where id = f.id;
    insert into ferramenta_eventos (empresa_consultora_id, ferramenta_id, tipo, descricao)
    values (f.empresa_consultora_id, f.id, 'reativacao', coalesce(nullif(trim(p_descricao),''), 'Reativada / encontrada'));
  else
    raise exception 'Ação inválida';
  end if;
end $$;

grant execute on function cautelar_ferramentas(jsonb) to authenticated;
grant execute on function devolver_ferramentas(jsonb) to authenticated;
grant execute on function movimentar_ferramenta(uuid, text, text, numeric, date) to authenticated;

-- 5) Automações: cautela atrasada e manutenção chegando ---------------------------------
alter table automacoes_tarefa drop constraint if exists automacoes_tarefa_gatilho_check;
alter table automacoes_tarefa add constraint automacoes_tarefa_gatilho_check check (gatilho in
  ('requisicao_aberta','pedido_emitido','os_aberta','titulo_vencendo','proposta_sem_retorno','estoque_minimo',
   'ferramenta_atrasada','manutencao_ferramenta'));

create or replace function _rodar_automacoes_ferramentas(p_emp uuid)
returns int language plpgsql security definer set search_path = public as $$
declare c automacoes_tarefa; r record; n int := 0;
begin
  select * into c from automacoes_tarefa where empresa_consultora_id = p_emp and gatilho = 'ferramenta_atrasada' and ativo;
  if found then
    for r in select k.id, k.numero, k.previsao_devolucao, e.nome as colab, count(ci.id) as qtd
               from cautelas k join cautela_itens ci on ci.cautela_id = k.id and ci.devolvido_em is null
               left join vw_equipe e on e.id = k.colaborador_id
              where k.empresa_consultora_id = p_emp and k.status <> 'devolvida'
                and k.previsao_devolucao is not null and k.previsao_devolucao < current_date + c.parametro_dias
              group by k.id, e.nome
    loop
      if _tarefa_automatica(p_emp, c, 'Cobrar devolução: ' || r.numero || coalesce(' — ' || r.colab, ''),
           r.qtd || ' ferramenta(s) com devolução prevista para ' || to_char(r.previsao_devolucao, 'DD/MM/YYYY') || '.',
           greatest(r.previsao_devolucao, current_date), null, null, null, 'cautela:' || r.id,
           case when r.previsao_devolucao < current_date then 'alta' else 'media' end) is not null then n := n + 1; end if;
    end loop;
  end if;

  select * into c from automacoes_tarefa where empresa_consultora_id = p_emp and gatilho = 'manutencao_ferramenta' and ativo;
  if found then
    for r in select * from ferramentas
              where empresa_consultora_id = p_emp and status in ('disponivel','em_uso')
                and proxima_manutencao is not null and proxima_manutencao <= current_date + c.parametro_dias
    loop
      if _tarefa_automatica(p_emp, c, 'Manutenção: ' || r.codigo || ' — ' || r.descricao,
           'Manutenção/calibração prevista para ' || to_char(r.proxima_manutencao, 'DD/MM/YYYY') || '.',
           r.proxima_manutencao, null, null, null, 'manutencao:' || r.id || ':' || r.proxima_manutencao) is not null then n := n + 1; end if;
    end loop;
  end if;
  return n;
end $$;
revoke execute on function _rodar_automacoes_ferramentas(uuid) from public, anon, authenticated;

create or replace function rodar_automacoes(p_forcar boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare v_emp uuid := auth_empresa_id();
begin
  if v_emp is null then return 0; end if;
  if p_forcar and not is_gerente() then raise exception 'Somente a gerência roda as automações manualmente'; end if;
  if not p_forcar and exists (select 1 from automacao_execucoes
                               where empresa_consultora_id = v_emp
                                 and (ultima_execucao at time zone 'America/Sao_Paulo')::date
                                     = (now() at time zone 'America/Sao_Paulo')::date) then
    return 0;
  end if;
  return _rodar_automacoes_empresa(v_emp) + _rodar_automacoes_ferramentas(v_emp);
end $$;

create or replace function rodar_automacoes_todas()
returns int language plpgsql security definer set search_path = public as $$
declare e record; n int := 0;
begin
  for e in select distinct empresa_consultora_id from automacoes_tarefa where ativo loop
    n := n + _rodar_automacoes_empresa(e.empresa_consultora_id) + _rodar_automacoes_ferramentas(e.empresa_consultora_id);
  end loop;
  return n;
end $$;
revoke execute on function rodar_automacoes_todas() from public, anon, authenticated;

-- 6) Compra de patrimônio: recebimento cria as ferramentas ------------------------------------
create or replace function _receber_itens(p_pedido pedidos_compra, p_deposito uuid, p_data date, p_nf text, p_obs text,
                                          p_anexo text, p_anexo_nome text, p_vencimento date, p_itens jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_rec    uuid;
  v_num    text;
  it       jsonb;
  v_item   itens_pedido_compra%rowtype;
  v_prod   produtos%rowtype;
  v_qtd    numeric(14,3);
  v_mov    uuid;
  v_valor  numeric(14,2) := 0;
  v_tit    uuid;
  v_req    requisicoes_compra%rowtype;
  v_rot    text;
  k        int;
begin
  if p_deposito is null then raise exception 'Informe o depósito que recebe o material'; end if;
  v_num := proximo_numero('RE', 'recebimento');
  if v_num is null then
    v_num := 'RE-' || extract(year from now())::int || '-' || substr(gen_random_uuid()::text, 1, 4);
  end if;
  v_rot := coalesce(p_pedido.numero, 'pedido') || coalesce(' · NF ' || nullif(trim(p_nf), ''), '') || ' (' || v_num || ')';

  insert into recebimentos_compra (empresa_consultora_id, numero, pedido_id, deposito_id, data, nota_fiscal, observacao, anexo_caminho, anexo_nome)
  values (p_pedido.empresa_consultora_id, v_num, p_pedido.id, p_deposito, coalesce(p_data, current_date),
          nullif(trim(p_nf), ''), nullif(trim(p_obs), ''), p_anexo, p_anexo_nome)
  returning id into v_rec;

  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    v_qtd := nullif(it->>'quantidade','')::numeric;
    continue when v_qtd is null or v_qtd <= 0;
    select * into v_item from itens_pedido_compra where id = (it->>'item_id')::uuid and pedido_id = p_pedido.id for update;
    if not found then raise exception 'Item do pedido não encontrado'; end if;
    if v_qtd > v_item.quantidade - v_item.quantidade_recebida then
      raise exception 'Recebendo mais que o pendente do item (pendente: %). Registre a sobra como entrada avulsa.',
        v_item.quantidade - v_item.quantidade_recebida;
    end if;
    select * into v_prod from produtos where id = v_item.produto_id;
    v_mov := null;

    if coalesce(v_prod.controla_patrimonio, false) then
      -- patrimônio: cada unidade vira uma ferramenta (não entra no saldo de estoque)
      if v_qtd <> trunc(v_qtd) then raise exception '"%" é patrimônio: a quantidade precisa ser inteira', v_prod.nome; end if;
      for k in 1 .. v_qtd::int loop
        insert into ferramentas (empresa_consultora_id, descricao, categoria, valor_aquisicao, data_aquisicao, fornecedor_id,
                                 pedido_id, produto_id, deposito_id, estado, observacao)
        values (p_pedido.empresa_consultora_id, v_prod.nome,
                case when v_prod.secao = 'ferramentas' then 'ferramenta_eletrica' else 'equipamento' end,
                v_item.custo_unitario, coalesce(p_data, current_date), p_pedido.fornecedor_id,
                p_pedido.id, v_prod.id, p_deposito, 'novo', 'Recebimento ' || v_rot);
      end loop;
    else
      insert into movimentacoes_estoque (empresa_consultora_id, produto_id, deposito_id, tipo, quantidade, custo_unitario, origem, referencia_id, observacao)
      values (p_pedido.empresa_consultora_id, v_item.produto_id, p_deposito, 'entrada', v_qtd, coalesce(v_item.custo_unitario, 0),
              'compra', p_pedido.id, 'Recebimento ' || v_rot)
      returning id into v_mov;
    end if;

    update itens_pedido_compra set quantidade_recebida = quantidade_recebida + v_qtd where id = v_item.id;
    insert into recebimento_itens (empresa_consultora_id, recebimento_id, item_pedido_id, produto_id, quantidade, custo_unitario, divergencia, movimentacao_id)
    values (p_pedido.empresa_consultora_id, v_rec, v_item.id, v_item.produto_id, v_qtd, v_item.custo_unitario,
            nullif(trim(it->>'divergencia'), ''), v_mov);
    v_valor := v_valor + round(v_qtd * coalesce(v_item.custo_unitario, 0), 2);
  end loop;

  if not exists (select 1 from recebimento_itens where recebimento_id = v_rec) then
    raise exception 'Informe a quantidade recebida de pelo menos um item';
  end if;

  if v_valor > 0 then
    insert into titulos_financeiros (empresa_consultora_id, tipo, descricao, fornecedor_id, categoria_id, valor,
                                     vencimento, competencia, status, origem, referencia_id)
    values (p_pedido.empresa_consultora_id, 'pagar', 'Pedido de compra ' || v_rot, p_pedido.fornecedor_id, p_pedido.categoria_id,
            v_valor, coalesce(p_vencimento, p_pedido.vencimento, current_date), coalesce(p_data, current_date),
            'aberto', 'compra', p_pedido.id)
    returning id into v_tit;
  end if;
  update recebimentos_compra set valor = v_valor, titulo_id = v_tit where id = v_rec;

  select * into v_req from requisicoes_compra where pedido_id = p_pedido.id and criado_por is not null limit 1;
  if found then
    insert into tarefas (empresa_consultora_id, titulo, descricao, responsavel_id, prazo, prioridade, ordem,
                         vinculo_tipo, vinculo_id, vinculo_rotulo, origem, automacao_chave)
    values (p_pedido.empresa_consultora_id,
            'Material chegou: ' || coalesce(v_req.numero, 'requisição') || ' (' || coalesce(p_pedido.numero, 'pedido') || ')',
            'Recebimento ' || v_num || ' no almoxarifado. Retirar no balcão.',
            v_req.criado_por, current_date, 'media', extract(epoch from now()) * 1000,
            'requisicao', v_req.id, concat_ws(' · ', v_req.numero, v_req.observacao), 'automacao', 'material:' || v_rec);
  end if;
  return v_rec;
end $$;
revoke execute on function _receber_itens(pedidos_compra, uuid, date, text, text, text, text, date, jsonb) from public, anon, authenticated;

-- 7) "Onde está?" — cada ferramenta com a cautela aberta (se houver) --------------------------
create or replace view vw_ferramentas_local as
select
  f.*,
  d.nome                    as deposito_nome,
  k.id                      as cautela_id,
  k.numero                  as cautela_numero,
  k.colaborador_id          as com_colaborador_id,
  e.nome                    as com_colaborador_nome,
  k.destino_tipo,
  case k.destino_tipo
    when 'os'    then concat_ws(' · ', os.numero, os.titulo)
    when 'obra'  then ob.local
    when 'setor' then cc.nome
  end                       as destino_nome,
  k.data_saida,
  k.previsao_devolucao,
  (k.previsao_devolucao is not null and k.previsao_devolucao < current_date) as atrasada
from ferramentas f
left join depositos d       on d.id = f.deposito_id
left join cautela_itens ci  on ci.ferramenta_id = f.id and ci.devolvido_em is null
left join cautelas k        on k.id = ci.cautela_id
left join vw_equipe e       on e.id = k.colaborador_id
left join ordens_servico os on os.id = k.os_id
left join obras_servicos ob on ob.id = k.obra_id
left join centros_custo cc  on cc.id = k.centro_custo_id;
alter view vw_ferramentas_local set (security_invoker = on);
revoke all on vw_ferramentas_local from anon;
grant select on vw_ferramentas_local to authenticated;
