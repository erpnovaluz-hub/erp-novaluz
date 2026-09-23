-- =============================================================================
-- CRM/ERP NOVALUZ — 0043 Tarefas: automação, modelos e follow-ups (V3 · Etapa 4)
--
-- 1) automacoes_tarefa — o ERP cria tarefas sozinho (a gerência liga/desliga):
--      eventos (na hora, por gatilho)      rotinas (1x por dia, rodar_automacoes)
--      requisicao_aberta → "Cotar RC…"      titulo_vencendo      → "Pagar/Receber …"
--      pedido_emitido    → "Receber PED…"   proposta_sem_retorno → "Follow-up PROP…"
--      os_aberta         → checklist/modelo estoque_minimo       → "Repor estoque: …"
--    Rotinas não duplicam: usam tarefas.automacao_chave.
-- 2) modelos_projeto / modelos_tarefa — projeto a partir de modelo, e
--    "salvar projeto como modelo". O modelo também serve de checklist da OS.
-- 3) tarefas_followup (CRM) → migra para tarefas, num projeto privado
--    "Follow-ups comerciais" (a tabela antiga fica, só deixa de ser usada).
--
-- Depende de 0041/0042.
-- =============================================================================

-- 0) Colunas de origem nas tarefas ----------------------------------------------------
alter table tarefas add column if not exists origem text
  check (origem in ('automacao','followup_crm','modelo'));
alter table tarefas add column if not exists automacao_chave text;
create index if not exists idx_tarefas_automacao_chave on tarefas(empresa_consultora_id, automacao_chave)
  where automacao_chave is not null;

-- notificação de tarefa automática não tem "autor": aparece como Automação
create or replace function _notificar_ator(p_dest uuid, p_tipo text, p_tarefa uuid, p_texto text, p_ator uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid;
begin
  if p_dest is null or (p_ator is not null and p_dest = p_ator) then return; end if;
  select empresa_consultora_id into v_emp from tarefas where id = p_tarefa;
  if not exists (select 1 from perfis where id = p_dest and empresa_consultora_id = v_emp and ativo) then return; end if;
  insert into notificacoes (empresa_consultora_id, destinatario_id, ator_id, tipo, tarefa_id, texto)
  values (v_emp, p_dest, p_ator, p_tipo, p_tarefa, p_texto);
end $$;

create or replace function _notificar_tarefa()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ator uuid := case when new.origem = 'automacao' and tg_op = 'INSERT' then null else auth.uid() end;
begin
  if new.responsavel_id is not null
     and (tg_op = 'INSERT' or new.responsavel_id is distinct from old.responsavel_id) then
    perform _notificar_ator(new.responsavel_id, 'atribuida', new.id, new.titulo, v_ator);
  end if;
  if tg_op = 'UPDATE' and new.concluida and not old.concluida
     and new.criado_por is distinct from new.responsavel_id then
    perform _notificar_ator(new.criado_por, 'concluida', new.id, new.titulo, auth.uid());
  end if;
  return new;
end $$;

-- 1) Configuração das automações ---------------------------------------------------
create table if not exists automacoes_tarefa (
  empresa_consultora_id uuid not null references empresas_consultoras(id) on delete cascade default auth_empresa_id(),
  gatilho               text not null check (gatilho in
                          ('requisicao_aberta','pedido_emitido','os_aberta',
                           'titulo_vencendo','proposta_sem_retorno','estoque_minimo')),
  ativo                 boolean not null default false,
  responsavel_id        uuid references perfis(id) on delete set null,
  projeto_id            uuid references projetos(id) on delete set null,
  modelo_id             uuid,                       -- FK logo abaixo (modelos_projeto)
  prazo_dias            int  not null default 2 check (prazo_dias between 0 and 365),
  parametro_dias        int  not null default 3 check (parametro_dias between 0 and 365),
  atualizado_em         timestamptz not null default now(),
  primary key (empresa_consultora_id, gatilho)
);

alter table automacoes_tarefa enable row level security;
drop policy if exists automacoes_ler on automacoes_tarefa;
drop policy if exists automacoes_gerir on automacoes_tarefa;
create policy automacoes_ler on automacoes_tarefa for select
  using (empresa_consultora_id = (select auth_empresa_id()));
create policy automacoes_gerir on automacoes_tarefa for all
  using      (empresa_consultora_id = (select auth_empresa_id()) and (select is_gerente()))
  with check (empresa_consultora_id = (select auth_empresa_id()) and (select is_gerente()));

-- controle "já rodou hoje" das rotinas
create table if not exists automacao_execucoes (
  empresa_consultora_id uuid primary key references empresas_consultoras(id) on delete cascade,
  ultima_execucao       timestamptz not null default now(),
  criadas               int not null default 0
);
alter table automacao_execucoes enable row level security;
drop policy if exists execucoes_ler on automacao_execucoes;
create policy execucoes_ler on automacao_execucoes for select
  using (empresa_consultora_id = (select auth_empresa_id()));

-- 2) Modelos de projeto --------------------------------------------------------------
create table if not exists modelos_projeto (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  nome                  text not null,
  descricao             text,
  criado_por            uuid references perfis(id) on delete set null default auth.uid(),
  criado_em             timestamptz not null default now()
);

create table if not exists modelos_tarefa (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  modelo_id             uuid not null references modelos_projeto(id) on delete cascade,
  secao                 text not null default 'A fazer',
  titulo                text not null,
  descricao             text,
  prioridade            text not null default 'media' check (prioridade in ('baixa','media','alta','urgente')),
  dias_prazo            int,        -- prazo = data base + dias (null = sem prazo)
  ordem                 int not null default 0
);
create index if not exists idx_modelos_tarefa on modelos_tarefa(modelo_id, ordem);

alter table automacoes_tarefa drop constraint if exists automacoes_tarefa_modelo_fk;
alter table automacoes_tarefa add constraint automacoes_tarefa_modelo_fk
  foreign key (modelo_id) references modelos_projeto(id) on delete set null;

alter table modelos_projeto enable row level security;
alter table modelos_tarefa  enable row level security;
drop policy if exists modelos_ler on modelos_projeto;
drop policy if exists modelos_inserir on modelos_projeto;
drop policy if exists modelos_gerir on modelos_projeto;
drop policy if exists modelos_excluir on modelos_projeto;
create policy modelos_ler on modelos_projeto for select
  using (empresa_consultora_id = (select auth_empresa_id()));
create policy modelos_inserir on modelos_projeto for insert
  with check (empresa_consultora_id = (select auth_empresa_id()));
create policy modelos_gerir on modelos_projeto for update
  using (empresa_consultora_id = (select auth_empresa_id()) and (criado_por = (select auth.uid()) or (select is_gerente())));
create policy modelos_excluir on modelos_projeto for delete
  using (empresa_consultora_id = (select auth_empresa_id()) and (criado_por = (select auth.uid()) or (select is_gerente())));

drop policy if exists modelos_tarefa_ler on modelos_tarefa;
drop policy if exists modelos_tarefa_gerir on modelos_tarefa;
create policy modelos_tarefa_ler on modelos_tarefa for select
  using (empresa_consultora_id = (select auth_empresa_id()));
create policy modelos_tarefa_gerir on modelos_tarefa for all
  using (empresa_consultora_id = (select auth_empresa_id())
         and exists (select 1 from modelos_projeto m where m.id = modelo_id
                      and (m.criado_por = (select auth.uid()) or (select is_gerente()))))
  with check (empresa_consultora_id = (select auth_empresa_id())
         and exists (select 1 from modelos_projeto m where m.id = modelo_id
                      and (m.criado_por = (select auth.uid()) or (select is_gerente()))));

-- cria projeto a partir de modelo (roda com as permissões de quem chama)
create or replace function criar_projeto_de_modelo(p_modelo uuid, p_nome text, p_privado boolean default false,
                                                   p_data_base date default current_date, p_cor text default 'teal')
returns uuid language plpgsql set search_path = public as $$
declare
  v_proj uuid;
  v_sec  record;
  v_secao uuid;
  v_ord  int := 0;
begin
  if not exists (select 1 from modelos_projeto where id = p_modelo) then raise exception 'Modelo não encontrado'; end if;

  insert into projetos (nome, privado, cor, dono_id, descricao)
  select p_nome, p_privado, p_cor, auth.uid(), m.descricao from modelos_projeto m where m.id = p_modelo
  returning id into v_proj;

  -- troca as seções padrão pelas do modelo
  delete from secoes_projeto where projeto_id = v_proj;
  for v_sec in
    select secao, min(ordem) o from modelos_tarefa where modelo_id = p_modelo group by secao order by 2
  loop
    v_ord := v_ord + 1;
    insert into secoes_projeto (projeto_id, nome, ordem) values (v_proj, v_sec.secao, v_ord) returning id into v_secao;
    insert into tarefas (projeto_id, secao_id, titulo, descricao, prioridade, prazo, ordem, origem)
    select v_proj, v_secao, t.titulo, t.descricao, t.prioridade,
           case when t.dias_prazo is null then null else p_data_base + t.dias_prazo end,
           t.ordem, 'modelo'
      from modelos_tarefa t where t.modelo_id = p_modelo and t.secao = v_sec.secao order by t.ordem;
  end loop;
  if v_ord = 0 then
    insert into secoes_projeto (projeto_id, nome, ordem) values (v_proj, 'A fazer', 1);
  end if;
  return v_proj;
end $$;

-- salva as tarefas (sem subtarefas) de um projeto como modelo
-- prazo vira "dias a partir do 1º prazo do projeto"
create or replace function salvar_projeto_como_modelo(p_projeto uuid, p_nome text)
returns uuid language plpgsql set search_path = public as $$
declare
  v_mod  uuid;
  v_base date;
begin
  if not pode_ver_projeto(p_projeto) then raise exception 'Projeto não encontrado'; end if;
  select min(prazo) into v_base from tarefas where projeto_id = p_projeto and parent_id is null;

  insert into modelos_projeto (nome, descricao)
  select p_nome, descricao from projetos where id = p_projeto
  returning id into v_mod;

  insert into modelos_tarefa (modelo_id, secao, titulo, descricao, prioridade, dias_prazo, ordem)
  select v_mod, coalesce(s.nome, 'A fazer'), t.titulo, t.descricao, t.prioridade,
         case when t.prazo is null or v_base is null then null else t.prazo - v_base end,
         (row_number() over (order by s.ordem nulls last, t.ordem, t.criado_em))::int
    from tarefas t left join secoes_projeto s on s.id = t.secao_id
   where t.projeto_id = p_projeto and t.parent_id is null;
  return v_mod;
end $$;

grant execute on function criar_projeto_de_modelo(uuid, text, boolean, date, text) to authenticated;
grant execute on function salvar_projeto_como_modelo(uuid, text) to authenticated;

-- 3) Criação de tarefa automática -----------------------------------------------------
create or replace function _tarefa_automatica(
  p_emp uuid, p_cfg automacoes_tarefa, p_titulo text, p_descricao text, p_prazo date,
  p_vinc_tipo text, p_vinc_id uuid, p_vinc_rotulo text, p_chave text default null,
  p_prioridade text default 'media')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_secao uuid;
begin
  if p_chave is not null and exists (
       select 1 from tarefas where empresa_consultora_id = p_emp and automacao_chave = p_chave and not concluida) then
    return null;   -- já existe uma aberta
  end if;
  if p_cfg.projeto_id is not null then
    select id into v_secao from secoes_projeto where projeto_id = p_cfg.projeto_id order by ordem limit 1;
  end if;
  insert into tarefas (empresa_consultora_id, projeto_id, secao_id, titulo, descricao, responsavel_id, criado_por,
                       prazo, prioridade, ordem, vinculo_tipo, vinculo_id, vinculo_rotulo, origem, automacao_chave)
  values (p_emp, p_cfg.projeto_id, v_secao, p_titulo, p_descricao, p_cfg.responsavel_id, null,
          p_prazo, p_prioridade, extract(epoch from now()) * 1000, p_vinc_tipo, p_vinc_id, p_vinc_rotulo, 'automacao', p_chave)
  returning id into v_id;
  return v_id;
end $$;

-- 3a) eventos -------------------------------------------------------------------------
create or replace function _auto_requisicao()
returns trigger language plpgsql security definer set search_path = public as $$
declare c automacoes_tarefa; v_rot text := coalesce(new.numero, 'requisição');
begin
  select * into c from automacoes_tarefa where empresa_consultora_id = new.empresa_consultora_id and gatilho = 'requisicao_aberta' and ativo;
  if not found then return new; end if;
  perform _tarefa_automatica(new.empresa_consultora_id, c, 'Cotar ' || v_rot,
    'Requisição aberta' || coalesce(' por ' || new.solicitante, '') || coalesce('. ' || new.observacao, '') || '. Cotar e gerar o pedido.',
    current_date + c.prazo_dias, 'requisicao', new.id, v_rot || coalesce(' · ' || new.observacao, ''), 'requisicao:' || new.id);
  return new;
end $$;
drop trigger if exists trg_auto_requisicao on requisicoes_compra;
create trigger trg_auto_requisicao after insert on requisicoes_compra
  for each row execute function _auto_requisicao();

create or replace function _auto_pedido()
returns trigger language plpgsql security definer set search_path = public as $$
declare c automacoes_tarefa; v_rot text := coalesce(new.numero, 'pedido'); v_forn text;
begin
  select * into c from automacoes_tarefa where empresa_consultora_id = new.empresa_consultora_id and gatilho = 'pedido_emitido' and ativo;
  if not found then return new; end if;
  select nome into v_forn from fornecedores where id = new.fornecedor_id;
  perform _tarefa_automatica(new.empresa_consultora_id, c, 'Receber e conferir ' || v_rot,
    'Pedido emitido' || coalesce(' para ' || v_forn, '') || '. Conferir material na chegada e dar entrada.',
    current_date + c.prazo_dias, 'pedido', new.id, v_rot || coalesce(' · ' || v_forn, ''), 'pedido:' || new.id);
  return new;
end $$;
drop trigger if exists trg_auto_pedido on pedidos_compra;
create trigger trg_auto_pedido after insert on pedidos_compra
  for each row execute function _auto_pedido();

-- recebido o pedido → conclui a tarefa de recebimento
create or replace function _auto_pedido_recebido()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'recebido' and old.status is distinct from 'recebido' then
    update tarefas set concluida = true
     where empresa_consultora_id = new.empresa_consultora_id and automacao_chave = 'pedido:' || new.id and not concluida;
  end if;
  return new;
end $$;
drop trigger if exists trg_auto_pedido_recebido on pedidos_compra;
create trigger trg_auto_pedido_recebido after update of status on pedidos_compra
  for each row execute function _auto_pedido_recebido();

-- requisição virou pedido (ou foi cancelada) → conclui "Cotar …"
create or replace function _auto_requisicao_fechada()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('convertida','cancelada') and old.status = 'aberta' then
    update tarefas set concluida = true
     where empresa_consultora_id = new.empresa_consultora_id and automacao_chave = 'requisicao:' || new.id and not concluida;
  end if;
  return new;
end $$;
drop trigger if exists trg_auto_requisicao_fechada on requisicoes_compra;
create trigger trg_auto_requisicao_fechada after update of status on requisicoes_compra
  for each row execute function _auto_requisicao_fechada();

create or replace function _auto_os()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c automacoes_tarefa;
  v_rot text := concat_ws(' · ', new.numero, new.titulo);
  v_mae uuid;
begin
  select * into c from automacoes_tarefa where empresa_consultora_id = new.empresa_consultora_id and gatilho = 'os_aberta' and ativo;
  if not found then return new; end if;
  v_mae := _tarefa_automatica(new.empresa_consultora_id, c, 'Executar ' || coalesce(new.numero, 'OS') || coalesce(' — ' || new.titulo, ''),
    coalesce(new.como_sera_feito, new.motivo), coalesce(new.prazo, current_date + c.prazo_dias),
    'os', new.id, v_rot, 'os:' || new.id,
    case new.urgencia when 'alta' then 'alta' when 'urgente' then 'urgente' else 'media' end);
  -- checklist: tarefas do modelo viram subtarefas
  if c.modelo_id is not null and v_mae is not null then
    insert into tarefas (empresa_consultora_id, projeto_id, parent_id, titulo, descricao, responsavel_id, prazo,
                         prioridade, ordem, origem)
    select new.empresa_consultora_id, c.projeto_id, v_mae, t.titulo, t.descricao, null,
           case when t.dias_prazo is null then null else current_date + t.dias_prazo end,
           t.prioridade, t.ordem, 'automacao'
      from modelos_tarefa t where t.modelo_id = c.modelo_id order by t.ordem;
  end if;
  return new;
end $$;
drop trigger if exists trg_auto_os on ordens_servico;
create trigger trg_auto_os after insert on ordens_servico
  for each row execute function _auto_os();

-- 3b) rotinas diárias ---------------------------------------------------------------
create or replace function _rodar_automacoes_empresa(p_emp uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  c   automacoes_tarefa;
  r   record;
  n   int := 0;
begin
  -- títulos vencendo (a pagar e a receber) --------------------------------------
  select * into c from automacoes_tarefa where empresa_consultora_id = p_emp and gatilho = 'titulo_vencendo' and ativo;
  if found then
    for r in select * from titulos_financeiros
              where empresa_consultora_id = p_emp and status = 'aberto'
                and vencimento is not null and vencimento <= current_date + c.parametro_dias
    loop
      if _tarefa_automatica(p_emp, c,
           (case r.tipo when 'receber' then 'Receber: ' else 'Pagar: ' end) || coalesce(r.descricao, 'título'),
           'Vence em ' || to_char(r.vencimento, 'DD/MM/YYYY')
             || ' · R$ ' || to_char(coalesce(r.valor, 0), 'FM999G999G990D00') || '. Dar baixa no financeiro ao concluir.',
           r.vencimento, 'titulo', r.id, coalesce(r.descricao, 'título'), 'titulo:' || r.id,
           case when r.vencimento < current_date then 'alta' else 'media' end) is not null then
        n := n + 1;
      end if;
    end loop;
  end if;

  -- propostas enviadas sem retorno ----------------------------------------------
  select * into c from automacoes_tarefa where empresa_consultora_id = p_emp and gatilho = 'proposta_sem_retorno' and ativo;
  if found then
    for r in select p.*, cl.nome as cliente_nome from propostas p left join clientes cl on cl.id = p.cliente_id
              where p.empresa_consultora_id = p_emp and p.status = 'enviada'
                and p.data <= current_date - c.parametro_dias
                -- 1 follow-up por proposta (mesmo depois de concluído)
                and not exists (select 1 from tarefas t where t.empresa_consultora_id = p_emp
                                   and t.automacao_chave = 'proposta:' || p.id)
    loop
      if _tarefa_automatica(p_emp, c,
           'Follow-up da proposta ' || coalesce(r.numero, '') || coalesce(' — ' || r.cliente_nome, ''),
           'Proposta enviada em ' || to_char(r.data, 'DD/MM/YYYY') || ' ainda sem retorno. Ligar para o cliente.',
           current_date + c.prazo_dias, 'proposta', r.id,
           concat_ws(' · ', r.numero, r.cliente_nome), 'proposta:' || r.id) is not null then
        n := n + 1;
      end if;
    end loop;
  end if;

  -- estoque abaixo do mínimo -----------------------------------------------------
  select * into c from automacoes_tarefa where empresa_consultora_id = p_emp and gatilho = 'estoque_minimo' and ativo;
  if found then
    for r in select pr.id, pr.nome, pr.unidade, pr.estoque_minimo, coalesce(sum(s.quantidade), 0) as saldo
               from produtos pr left join saldos_estoque s on s.produto_id = pr.id
              where pr.empresa_consultora_id = p_emp and pr.ativo and coalesce(pr.estoque_minimo, 0) > 0
              group by pr.id
             having coalesce(sum(s.quantidade), 0) < pr.estoque_minimo
    loop
      if _tarefa_automatica(p_emp, c, 'Repor estoque: ' || r.nome,
           'Saldo ' || r.saldo || ' ' || coalesce(r.unidade, '') || ' · mínimo ' || r.estoque_minimo
             || '. Abrir requisição de compra.',
           current_date + c.prazo_dias, null, null, null, 'estoque:' || r.id) is not null then
        n := n + 1;
      end if;
    end loop;
  end if;

  insert into automacao_execucoes (empresa_consultora_id, ultima_execucao, criadas)
  values (p_emp, now(), n)
  on conflict (empresa_consultora_id) do update set ultima_execucao = now(), criadas = excluded.criadas;
  return n;
end $$;

-- chamada pelo app: roda 1x por dia (ou na hora, se p_forcar e for gerência)
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
  return _rodar_automacoes_empresa(v_emp);
end $$;

-- para agendar no pg_cron (opcional): todas as empresas com automação ligada
create or replace function rodar_automacoes_todas()
returns int language plpgsql security definer set search_path = public as $$
declare e record; n int := 0;
begin
  for e in select distinct empresa_consultora_id from automacoes_tarefa where ativo loop
    n := n + _rodar_automacoes_empresa(e.empresa_consultora_id);
  end loop;
  return n;
end $$;

revoke execute on function _tarefa_automatica(uuid, automacoes_tarefa, text, text, date, text, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function _rodar_automacoes_empresa(uuid) from public, anon, authenticated;
revoke execute on function rodar_automacoes_todas() from public, anon, authenticated;
revoke execute on function _notificar_ator(uuid, text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function rodar_automacoes(boolean) to authenticated;

-- 4) Follow-ups do CRM → tarefas -------------------------------------------------------
-- Um projeto privado "Follow-ups comerciais" por empresa (dono: 1ª gerência).
-- Idempotente: cada follow-up vira 1 tarefa (automacao_chave = followup:<id>).
do $$
declare
  e       record;
  v_dono  uuid;
  v_proj  uuid;
begin
  for e in select distinct empresa_consultora_id as id from tarefas_followup loop
    v_proj := null;
    select id into v_proj from projetos where empresa_consultora_id = e.id and nome = 'Follow-ups comerciais' limit 1;
    if v_proj is null then
      select id into v_dono from perfis where empresa_consultora_id = e.id and papel = 'admin' and ativo order by criado_em limit 1;
      insert into projetos (empresa_consultora_id, nome, descricao, cor, privado, dono_id)
      values (e.id, 'Follow-ups comerciais', 'Migrados do CRM (tarefas_followup) e novos follow-ups de clientes.', 'blue', true, v_dono)
      returning id into v_proj;
    end if;

    insert into tarefas (empresa_consultora_id, projeto_id, secao_id, titulo, descricao, prazo, concluida,
                         criado_por, ordem, vinculo_tipo, vinculo_id, vinculo_rotulo, origem, automacao_chave, criado_em)
    select e.id, v_proj,
           (select s.id from secoes_projeto s where s.projeto_id = v_proj
             order by case when f.status = 'em_andamento' and s.nome = 'Em andamento' then 0
                           when f.status in ('concluida','cancelada') and s.nome = 'Concluído' then 0
                           when f.status not in ('em_andamento','concluida','cancelada') and s.nome = 'A fazer' then 0
                           else 1 end, s.ordem limit 1),
           left(f.descricao, 140),
           concat_ws(E'\n', case when length(f.descricao) > 140 then f.descricao end,
                     'Responsável (CRM antigo): ' || f.responsavel,
                     'Origem: ' || f.origem,
                     case when f.status = 'cancelada' then 'Status antigo: cancelada' end),
           f.prazo, f.status in ('concluida','cancelada'),
           (select dono_id from projetos where id = v_proj),
           extract(epoch from f.data_criacao) * 1000,
           'cliente', f.cliente_id, cl.nome, 'followup_crm', 'followup:' || f.id, f.data_criacao
      from tarefas_followup f left join clientes cl on cl.id = f.cliente_id
     where f.empresa_consultora_id = e.id
       and not exists (select 1 from tarefas t where t.empresa_consultora_id = e.id and t.automacao_chave = 'followup:' || f.id);
  end loop;
end $$;
