-- =============================================================================
-- CRM/ERP NOVALUZ — 0054 OS 2.0 · Bloco 4: faturamento e manutenção recorrente
--
-- Faturamento SUGERIDO (a gerência confirma):
--   OS concluída → (automação "os_concluida") tarefa "Faturar OS-…" para a gerência
--   faturar_os(): gerência confirma valor/parcelas/vencimento → títulos a receber
--   (origem 'faturamento') e a OS vira 'faturada'; a tarefa de faturar fecha sozinha
-- Manutenção recorrente → OS (automação "manutencao_os", rotina diária):
--   cria a OS preventiva quando a próxima data chega; concluir a OS agenda a próxima
--
-- ATENÇÃO (SQL Editor do Supabase): sem "select ... into" — ver migration 0050.
-- Depende de 0010 (parcelas), 0043/0048 (automações), 0051/0052.
-- =============================================================================

alter table ordens_servico add column if not exists titulo_receber_id uuid references titulos_financeiros(id) on delete set null;
alter table ordens_servico add column if not exists faturada_em       timestamptz;
alter table ordens_servico add column if not exists manutencao_id     uuid references manutencao_recorrente(id) on delete set null;
create index if not exists idx_os_manutencao on ordens_servico(manutencao_id) where manutencao_id is not null;

alter table automacoes_tarefa drop constraint if exists automacoes_tarefa_gatilho_check;
alter table automacoes_tarefa add constraint automacoes_tarefa_gatilho_check check (gatilho in
  ('requisicao_aberta','pedido_emitido','os_aberta','titulo_vencendo','proposta_sem_retorno','estoque_minimo',
   'ferramenta_atrasada','manutencao_ferramenta','os_concluida','manutencao_os'));

-- 1) OS concluída: sugere faturamento + agenda a próxima manutenção ----------------------------
create or replace function _os_concluida()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c   automacoes_tarefa := (select a from automacoes_tarefa a
                             where a.empresa_consultora_id = new.empresa_consultora_id and a.gatilho = 'os_concluida' and a.ativo);
  per int;
begin
  if new.status = 'concluido' and old.status is distinct from 'concluido' then
    if c.gatilho is not null and new.titulo_receber_id is null then
      perform _tarefa_automatica(new.empresa_consultora_id, c,
        'Faturar ' || coalesce(new.numero, 'OS') || coalesce(' — ' || new.titulo, ''),
        'OS concluída em ' || to_char(coalesce(new.data_realizado, current_date), 'DD/MM/YYYY')
          || '. Confira o valor na OS (painel Faturar) e confirme.',
        current_date + c.prazo_dias, 'os', new.id, concat_ws(' · ', new.numero, new.titulo), 'faturar:' || new.id, 'alta');
    end if;
    if new.manutencao_id is not null then
      per := (select periodicidade_dias from manutencao_recorrente where id = new.manutencao_id);
      update manutencao_recorrente
         set ultima_execucao = coalesce(new.data_realizado, current_date),
             proxima_prevista = coalesce(new.data_realizado, current_date) + coalesce(per, 0)
       where id = new.manutencao_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_os_concluida on ordens_servico;
create trigger trg_os_concluida after update of status on ordens_servico
  for each row execute function _os_concluida();

-- 2) Faturar (só gerência) --------------------------------------------------------------
-- p = {os_id, valor, parcelas, primeiro_vencimento, categoria_id, descricao}
create or replace function faturar_os(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o       ordens_servico := (select x from ordens_servico x where x.id = (p->>'os_id')::uuid);
  v_valor numeric := round(coalesce(nullif(p->>'valor','')::numeric, 0), 2);
  v_n     int := greatest(1, least(60, coalesce(nullif(p->>'parcelas','')::int, 1)));
  v_venc  date := coalesce(nullif(p->>'primeiro_vencimento','')::date, current_date + 30);
  v_desc  text := coalesce(nullif(trim(p->>'descricao'), ''), 'Faturamento ' || coalesce(o.numero, 'OS'));
  v_grupo uuid := gen_random_uuid();
  v_parc  numeric;
  v_soma  numeric := 0;
  v_id    uuid;
  v_prim  uuid;
  k       int;
begin
  if not is_gerente() then raise exception 'Somente a gerência fatura OS'; end if;
  if o.id is null or o.empresa_consultora_id <> auth_empresa_id() then raise exception 'OS não encontrada'; end if;
  if o.status = 'faturada' or o.titulo_receber_id is not null then raise exception 'Esta OS já foi faturada'; end if;
  if o.status <> 'concluido' then raise exception 'Conclua a OS antes de faturar'; end if;
  if v_valor <= 0 then raise exception 'Informe o valor a faturar'; end if;

  v_parc := round(v_valor / v_n, 2);
  for k in 1 .. v_n loop
    v_id := gen_random_uuid();   -- id gerado antes (evita "returning ... into" no SQL Editor)
    insert into titulos_financeiros (id, empresa_consultora_id, tipo, descricao, cliente_id, categoria_id, valor,
                                     vencimento, competencia, status, origem, referencia_id,
                                     parcela_numero, parcela_total, grupo_parcelamento)
    values (v_id, o.empresa_consultora_id, 'receber',
            v_desc || case when v_n > 1 then ' (' || k || '/' || v_n || ')' else '' end,
            o.cliente_id, nullif(p->>'categoria_id','')::uuid,
            case when k = v_n then v_valor - v_soma else v_parc end,     -- última parcela leva o arredondamento
            (v_venc + ((k - 1) || ' month')::interval)::date, current_date, 'aberto', 'faturamento', o.id,
            case when v_n > 1 then k end, case when v_n > 1 then v_n end, case when v_n > 1 then v_grupo end);
    v_soma := v_soma + v_parc;
    if k = 1 then v_prim := v_id; end if;
  end loop;

  update ordens_servico
     set status = 'faturada', titulo_receber_id = v_prim, faturada_em = now(),
         valor_venda = coalesce(valor_venda, v_valor)
   where id = o.id;
  update tarefas set concluida = true
   where empresa_consultora_id = o.empresa_consultora_id and automacao_chave = 'faturar:' || o.id and not concluida;
  return jsonb_build_object('titulo_id', v_prim, 'parcelas', v_n);
end $$;
grant execute on function faturar_os(jsonb) to authenticated;

-- 3) Manutenção recorrente → OS (rotina diária) -------------------------------------------
create or replace function _rodar_automacoes_os(p_emp uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  c automacoes_tarefa := (select a from automacoes_tarefa a
                          where a.empresa_consultora_id = p_emp and a.gatilho = 'manutencao_os' and a.ativo);
  r record;
  n int := 0;
begin
  if c.gatilho is null then return 0; end if;
  for r in select m.* from manutencao_recorrente m
            where m.empresa_consultora_id = p_emp
              and m.proxima_prevista is not null
              and m.proxima_prevista <= current_date + c.parametro_dias
              and not exists (select 1 from ordens_servico o
                               where o.manutencao_id = m.id
                                 and o.status in ('orcamento','a_fazer','em_andamento','pausada'))
  loop
    insert into ordens_servico (empresa_consultora_id, cliente_id, titulo, motivo, prazo, status, urgencia,
                                responsavel_id, manutencao_id)
    values (p_emp, r.cliente_id, 'Manutenção preventiva — ' || r.equipamento_estrutura,
            'Manutenção recorrente a cada ' || r.periodicidade_dias || ' dias'
              || coalesce(' (última: ' || to_char(r.ultima_execucao, 'DD/MM/YYYY') || ')', ''),
            r.proxima_prevista, 'a_fazer', 'media', c.responsavel_id, r.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function _rodar_automacoes_os(uuid) from public, anon, authenticated;

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
  return _rodar_automacoes_empresa(v_emp) + _rodar_automacoes_ferramentas(v_emp) + _rodar_automacoes_os(v_emp);
end $$;

create or replace function rodar_automacoes_todas()
returns int language plpgsql security definer set search_path = public as $$
declare e record; n int := 0;
begin
  for e in select distinct empresa_consultora_id from automacoes_tarefa where ativo loop
    n := n + _rodar_automacoes_empresa(e.empresa_consultora_id) + _rodar_automacoes_ferramentas(e.empresa_consultora_id)
           + _rodar_automacoes_os(e.empresa_consultora_id);
  end loop;
  return n;
end $$;
revoke execute on function rodar_automacoes_todas() from public, anon, authenticated;
