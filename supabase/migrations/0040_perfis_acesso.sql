-- =============================================================================
-- CRM/ERP NOVALUZ — 0040 Perfis de acesso por módulo (V3 · Etapa 1)
--
-- Papéis (perfis.papel):
--   super        admin central (multiempresa) — tudo
--   admin        GERÊNCIA da empresa — tudo, cria usuários e edita a matriz
--   almoxarifado estoque, requisições, compras/recebimento; vê OS e produção
--   logistica    OS/obras; vê estoque e produção; abre requisição
--   (membro antigo vira admin — antes ele já via tudo)
--
-- Níveis por módulo: nenhum | ver | editar. O padrão fica em nivel_padrao();
-- a gerência pode sobrescrever por empresa em permissoes_papel.
--
-- A trava é no banco (RLS): esconder o menu não basta, o app consulta o
-- Supabase direto do navegador. Triggers e RPCs são security definer, então os
-- efeitos cruzados (recebimento → título a pagar, etc.) continuam funcionando.
--
-- Corrige também: qualquer usuário conseguia alterar o próprio papel e a
-- própria empresa em perfis (policy permitia update em id = auth.uid()).
--
-- Depende de 0027/0028 (is_super, auth_empresa_id com modo suporte).
-- =============================================================================

-- 1) Perfis: papéis novos + ativo ---------------------------------------------
alter table perfis add column if not exists ativo boolean not null default true;

update perfis set papel = 'admin' where papel = 'membro';
alter table perfis alter column papel set default 'logistica';   -- menor acesso

alter table perfis drop constraint if exists perfis_papel_check;
alter table perfis add constraint perfis_papel_check
  check (papel in ('super','admin','almoxarifado','logistica'));

-- usuário desativado perde o tenant → todo o RLS operacional fecha para ele
create or replace function auth_empresa_id()
returns uuid language sql stable security definer set search_path = public as $$
  select case
           when papel = 'super' and empresa_ativa is not null then empresa_ativa
           else empresa_consultora_id
         end
  from perfis where id = auth.uid() and ativo
$$;

create or replace function meu_papel()
returns text language sql stable security definer set search_path = public as $$
  select papel from perfis where id = auth.uid() and ativo
$$;

-- gerência (ou super) — acesso total dentro da empresa
create or replace function is_gerente()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(meu_papel() in ('super','admin'), false)
$$;

-- 2) Matriz de permissões -----------------------------------------------------
create table if not exists permissoes_papel (
  empresa_consultora_id uuid not null references empresas_consultoras(id) on delete cascade default auth_empresa_id(),
  papel                 text not null check (papel in ('almoxarifado','logistica')),
  modulo                text not null check (modulo in
                          ('comercial','financeiro','rh','estoque','requisicoes','compras','os','producao')),
  nivel                 text not null check (nivel in ('nenhum','ver','editar')),
  atualizado_em         timestamptz not null default now(),
  primary key (empresa_consultora_id, papel, modulo)
);

alter table permissoes_papel enable row level security;
drop policy if exists permissoes_ler on permissoes_papel;
drop policy if exists permissoes_gerir on permissoes_papel;
-- todos leem a matriz da própria empresa (o app monta o menu com ela)
create policy permissoes_ler on permissoes_papel for select
  using (empresa_consultora_id = auth_empresa_id());
create policy permissoes_gerir on permissoes_papel for all
  using      (empresa_consultora_id = auth_empresa_id() and is_gerente())
  with check (empresa_consultora_id = auth_empresa_id() and is_gerente());

-- padrão de fábrica (espelhado em src/lib/permissoes.ts)
create or replace function nivel_padrao(p_papel text, p_modulo text)
returns text language sql immutable as $$
  select case
    when p_papel in ('super','admin') then 'editar'
    when p_papel = 'almoxarifado' then case p_modulo
      when 'estoque'     then 'editar'
      when 'requisicoes' then 'editar'
      when 'compras'     then 'editar'
      when 'os'          then 'ver'
      when 'producao'    then 'ver'
      else 'nenhum' end
    when p_papel = 'logistica' then case p_modulo
      when 'os'          then 'editar'
      when 'requisicoes' then 'editar'
      when 'estoque'     then 'ver'
      when 'producao'    then 'ver'
      else 'nenhum' end
    else 'nenhum'
  end
$$;

create or replace function meu_nivel(p_modulo text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when meu_papel() is null then 'nenhum'
    when is_gerente() then 'editar'
    else coalesce(
      (select nivel from permissoes_papel
        where empresa_consultora_id = auth_empresa_id()
          and papel = meu_papel() and modulo = p_modulo),
      nivel_padrao(meu_papel(), p_modulo))
  end
$$;

-- true se QUALQUER um dos módulos atinge o nível pedido
create or replace function pode(p_modulos text[], p_nivel text default 'ver')
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from unnest(p_modulos) m
     where case p_nivel
             when 'editar' then meu_nivel(m) = 'editar'
             else meu_nivel(m) in ('ver','editar')
           end)
$$;

grant execute on function meu_papel(), is_gerente(), meu_nivel(text), pode(text[], text) to authenticated;

-- 3) RLS por módulo -----------------------------------------------------------
-- Troca a policy tenant_all por 4 policies (ler/inserir/alterar/excluir).
-- `(select pode(...))` vira initPlan: avaliado 1x por consulta, não por linha.
create or replace function _aplicar_acesso(p_tabela text, p_ler text[], p_escrever text[])
returns void language plpgsql as $$
declare
  v_ten text := 'empresa_consultora_id = (select auth_empresa_id())';
  v_ler text := format('(select pode(%L::text[], ''ver''))', p_ler);
  v_esc text := format('(select pode(%L::text[], ''editar''))', p_escrever);
begin
  -- tabela de migration ainda não rodada: pula (rodar esta 0040 de novo depois)
  if to_regclass('public.' || p_tabela) is null then
    raise notice 'Tabela % não existe — pulada', p_tabela;
    return;
  end if;
  execute format('alter table %I enable row level security', p_tabela);
  execute format('drop policy if exists tenant_all on %I', p_tabela);
  execute format('drop policy if exists acesso_ler on %I', p_tabela);
  execute format('drop policy if exists acesso_inserir on %I', p_tabela);
  execute format('drop policy if exists acesso_alterar on %I', p_tabela);
  execute format('drop policy if exists acesso_excluir on %I', p_tabela);
  execute format('create policy acesso_ler on %I for select using (%s and %s)', p_tabela, v_ten, v_ler);
  execute format('create policy acesso_inserir on %I for insert with check (%s and %s)', p_tabela, v_ten, v_esc);
  execute format('create policy acesso_alterar on %I for update using (%s and %s) with check (%s and %s)',
                 p_tabela, v_ten, v_esc, v_ten, v_esc);
  execute format('create policy acesso_excluir on %I for delete using (%s and %s)', p_tabela, v_ten, v_esc);
end $$;

-- tabela                    lê                                                         escreve
-- Comercial (CRM, propostas, contratos, precificador)
select _aplicar_acesso('clientes',             '{comercial,os,producao}',                    '{comercial}');
select _aplicar_acesso('contatos',             '{comercial}',                                '{comercial}');
select _aplicar_acesso('interacoes',           '{comercial}',                                '{comercial}');
select _aplicar_acesso('oportunidades',        '{comercial}',                                '{comercial}');
select _aplicar_acesso('propostas',            '{comercial}',                                '{comercial}');
select _aplicar_acesso('itens_proposta',       '{comercial}',                                '{comercial}');
select _aplicar_acesso('contratos',            '{comercial}',                                '{comercial}');
select _aplicar_acesso('faturamento',          '{comercial}',                                '{comercial}');
select _aplicar_acesso('tarefas_followup',     '{comercial}',                                '{comercial}');
select _aplicar_acesso('documentos',           '{comercial}',                                '{comercial}');
select _aplicar_acesso('manutencao_recorrente','{comercial}',                                '{comercial}');
select _aplicar_acesso('composicao_custo',     '{comercial}',                                '{comercial}');
select _aplicar_acesso('parametros_preco',     '{comercial}',                                '{comercial}');
-- Financeiro
select _aplicar_acesso('titulos_financeiros',       '{financeiro}',                          '{financeiro}');
select _aplicar_acesso('movimentacoes_caixa',       '{financeiro}',                          '{financeiro}');
select _aplicar_acesso('contas_bancarias',          '{financeiro}',                          '{financeiro}');
select _aplicar_acesso('categorias_financeiras',    '{financeiro,compras}',                  '{financeiro}');
select _aplicar_acesso('subcategorias_financeiras', '{financeiro}',                          '{financeiro}');
select _aplicar_acesso('simulacoes_caixa',          '{financeiro}',                          '{financeiro}');
-- RH / Folha (colaboradores tem salário: os demais módulos leem vw_equipe)
select _aplicar_acesso('colaboradores',               '{rh}',                                '{rh}');
select _aplicar_acesso('folha_tipos_beneficio',       '{rh}',                                '{rh}');
select _aplicar_acesso('folha_lancamentos',           '{rh}',                                '{rh}');
select _aplicar_acesso('folha_lancamento_beneficios', '{rh}',                                '{rh}');
select _aplicar_acesso('bonus_regras',                '{rh}',                                '{rh}');
select _aplicar_acesso('bonus_producao',              '{rh}',                                '{rh}');
-- Estoque e cadastros de material (saída de material: só quem edita estoque)
select _aplicar_acesso('produtos',              '{estoque,requisicoes,compras,os,producao,comercial}', '{estoque}');
select _aplicar_acesso('depositos',             '{estoque,requisicoes,compras,os}',          '{estoque}');
select _aplicar_acesso('fornecedores',          '{estoque,requisicoes,compras,financeiro}',  '{estoque,compras}');
select _aplicar_acesso('saldos_estoque',        '{estoque,requisicoes,compras,os}',          '{estoque}');
select _aplicar_acesso('movimentacoes_estoque', '{estoque}',                                 '{estoque}');
select _aplicar_acesso('consumo_producao',      '{estoque,os}',                              '{estoque}');
-- Requisições (qualquer setor operacional abre)
select _aplicar_acesso('requisicoes_compra',      '{requisicoes,compras}',                   '{requisicoes,compras}');
select _aplicar_acesso('itens_requisicao_compra', '{requisicoes,compras}',                   '{requisicoes,compras}');
-- Compras (cotação, pedido, recebimento)
select _aplicar_acesso('cotacoes_compra',      '{compras}',                                  '{compras}');
select _aplicar_acesso('itens_cotacao',        '{compras}',                                  '{compras}');
select _aplicar_acesso('cotacao_fornecedores', '{compras}',                                  '{compras}');
select _aplicar_acesso('cotacao_precos',       '{compras}',                                  '{compras}');
select _aplicar_acesso('pedidos_compra',       '{compras}',                                  '{compras}');
select _aplicar_acesso('itens_pedido_compra',  '{compras}',                                  '{compras}');
-- OS / Obras
select _aplicar_acesso('ordens_servico',     '{os}',                                         '{os}');
select _aplicar_acesso('atividades_os',      '{os}',                                         '{os}');
select _aplicar_acesso('insumos_os',         '{os}',                                         '{os}');
select _aplicar_acesso('obras_servicos',     '{os}',                                         '{os}');
select _aplicar_acesso('alocacao_equipe',    '{os}',                                         '{os}');
select _aplicar_acesso('materiais_por_obra', '{os}',                                         '{os}');
-- Produção / Impacto
select _aplicar_acesso('pecas',    '{producao}',                                             '{producao}');
select _aplicar_acesso('servicos', '{producao,comercial,os}',                                '{producao,comercial}');
select _aplicar_acesso('producao', '{producao}',                                             '{producao}');
select _aplicar_acesso('demandas', '{producao}',                                             '{producao}');

drop function _aplicar_acesso(text, text[], text[]);

-- 4) Equipe sem salário -------------------------------------------------------
-- View "definer" (sem security_invoker): expõe só nome/função da equipe da
-- empresa para OS, produção, bônus etc. Salário e custo/hora ficam no RH.
create or replace view vw_equipe as
  select id, empresa_consultora_id, nome, cargo, funcao_padrao, ativo
    from colaboradores
   where empresa_consultora_id = auth_empresa_id();

revoke all on vw_equipe from anon;
grant select on vw_equipe to authenticated;

-- 5) Perfis: gerência administra o time; ninguém se autopromove -----------------
drop policy if exists perfis_acesso on perfis;
drop policy if exists perfis_ler on perfis;
drop policy if exists perfis_inserir on perfis;
drop policy if exists perfis_alterar on perfis;
drop policy if exists perfis_excluir on perfis;

-- colegas da mesma empresa se enxergam (atribuir tarefas, responsável etc.)
create policy perfis_ler on perfis for select
  using (id = auth.uid() or is_super() or empresa_consultora_id = auth_empresa_id());
-- criação de login passa pela API (service role); aqui só o super
create policy perfis_inserir on perfis for insert
  with check (is_super());
create policy perfis_alterar on perfis for update
  using      (id = auth.uid() or is_super() or (is_gerente() and empresa_consultora_id = auth_empresa_id()))
  with check (id = auth.uid() or is_super() or (is_gerente() and empresa_consultora_id = auth_empresa_id()));
create policy perfis_excluir on perfis for delete
  using (is_super());

create or replace function proteger_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- service role (API) e super admin passam direto
  if auth.uid() is null or is_super() then return new; end if;

  if new.empresa_consultora_id is distinct from old.empresa_consultora_id
     or new.empresa_ativa is distinct from old.empresa_ativa then
    raise exception 'Sem permissão para trocar a empresa do usuário';
  end if;

  if new.papel is distinct from old.papel or new.ativo is distinct from old.ativo then
    if not is_gerente() then
      raise exception 'Somente a gerência altera papel ou status de usuários';
    end if;
    if new.id = auth.uid() then
      raise exception 'Você não pode alterar o próprio papel ou status';
    end if;
    if old.papel = 'super' or new.papel = 'super' then
      raise exception 'Papel super é exclusivo do administrador central';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_proteger_perfil on perfis;
create trigger trg_proteger_perfil before update on perfis
  for each row execute function proteger_perfil();

-- 6) RPCs de compras exigem o módulo -------------------------------------------
-- (são security definer: sem esta checagem ignorariam o RLS)
create or replace function gerar_pedido_de_requisicao(
  p_requisicao_id uuid,
  p_fornecedor_id uuid,
  p_deposito_id   uuid  default null,
  p_categoria_id  uuid  default null,
  p_vencimento    date  default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req      requisicoes_compra%rowtype;
  v_pedido   uuid;
  v_empresa  uuid := auth_empresa_id();
begin
  if not pode('{compras}', 'editar') then raise exception 'Sem permissão no módulo Compras'; end if;

  select * into v_req from requisicoes_compra where id = p_requisicao_id;
  if not found then
    raise exception 'Requisição não encontrada';
  end if;
  if v_req.empresa_consultora_id <> v_empresa then
    raise exception 'Requisição de outra empresa';
  end if;
  if v_req.status <> 'aberta' then
    raise exception 'Somente requisições abertas podem ser convertidas (status atual: %)', v_req.status;
  end if;
  if p_fornecedor_id is null then
    raise exception 'Escolha um fornecedor para gerar o pedido';
  end if;

  insert into pedidos_compra
    (empresa_consultora_id, numero, fornecedor_id, deposito_id, categoria_id, data, vencimento, status, observacao)
  values
    (v_empresa, null, p_fornecedor_id, p_deposito_id, p_categoria_id, current_date, p_vencimento, 'aberto',
     'Gerado da requisição ' || coalesce(v_req.numero, v_req.id::text)
       || case when v_req.observacao is not null then ' — ' || v_req.observacao else '' end)
  returning id into v_pedido;

  insert into itens_pedido_compra
    (empresa_consultora_id, pedido_id, produto_id, quantidade, custo_unitario)
  select v_empresa, v_pedido, produto_id, quantidade, coalesce(custo_estimado, 0)
    from itens_requisicao_compra
   where requisicao_id = p_requisicao_id;

  update requisicoes_compra
     set status = 'convertida', pedido_id = v_pedido
   where id = p_requisicao_id;

  return v_pedido;
end $$;

create or replace function gerar_cotacao_de_requisicao(p_requisicao_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_req      requisicoes_compra%rowtype;
  v_cotacao  uuid;
  v_empresa  uuid := auth_empresa_id();
begin
  if not pode('{compras}', 'editar') then raise exception 'Sem permissão no módulo Compras'; end if;

  select * into v_req from requisicoes_compra where id = p_requisicao_id;
  if not found then raise exception 'Requisição não encontrada'; end if;
  if v_req.empresa_consultora_id <> v_empresa then raise exception 'Requisição de outra empresa'; end if;

  insert into cotacoes_compra (empresa_consultora_id, numero, requisicao_id, data, status, observacao)
  values (v_empresa, null, p_requisicao_id, current_date, 'aberta',
          'Cotação da requisição ' || coalesce(v_req.numero, v_req.id::text))
  returning id into v_cotacao;

  insert into itens_cotacao (empresa_consultora_id, cotacao_id, produto_id, quantidade)
  select v_empresa, v_cotacao, produto_id, quantidade
    from itens_requisicao_compra where requisicao_id = p_requisicao_id;

  if v_req.fornecedor_sugerido_id is not null then
    insert into cotacao_fornecedores (empresa_consultora_id, cotacao_id, fornecedor_id)
    values (v_empresa, v_cotacao, v_req.fornecedor_sugerido_id)
    on conflict do nothing;
  end if;

  return v_cotacao;
end $$;

create or replace function gerar_pedido_de_cotacao(
  p_cotacao_id    uuid,
  p_fornecedor_id uuid,
  p_deposito_id   uuid  default null,
  p_categoria_id  uuid  default null,
  p_vencimento    date  default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_cot      cotacoes_compra%rowtype;
  v_pedido   uuid;
  v_empresa  uuid := auth_empresa_id();
begin
  if not pode('{compras}', 'editar') then raise exception 'Sem permissão no módulo Compras'; end if;

  select * into v_cot from cotacoes_compra where id = p_cotacao_id;
  if not found then raise exception 'Cotação não encontrada'; end if;
  if v_cot.empresa_consultora_id <> v_empresa then raise exception 'Cotação de outra empresa'; end if;
  if v_cot.status = 'cancelada' then raise exception 'Cotação cancelada'; end if;
  if p_fornecedor_id is null then raise exception 'Escolha o fornecedor vencedor'; end if;

  insert into pedidos_compra
    (empresa_consultora_id, numero, fornecedor_id, deposito_id, categoria_id, data, vencimento, status, observacao)
  values
    (v_empresa, null, p_fornecedor_id, p_deposito_id, p_categoria_id, current_date, p_vencimento, 'aberto',
     'Gerado da cotação ' || coalesce(v_cot.numero, v_cot.id::text))
  returning id into v_pedido;

  insert into itens_pedido_compra
    (empresa_consultora_id, pedido_id, produto_id, quantidade, custo_unitario)
  select v_empresa, v_pedido, ic.produto_id, ic.quantidade,
         coalesce(cp.preco_unitario, 0)
    from itens_cotacao ic
    left join cotacao_precos cp
      on cp.cotacao_id = ic.cotacao_id
     and cp.produto_id = ic.produto_id
     and cp.fornecedor_id = p_fornecedor_id
   where ic.cotacao_id = p_cotacao_id;

  update cotacoes_compra
     set status = 'decidida', fornecedor_vencedor_id = p_fornecedor_id, pedido_id = v_pedido
   where id = p_cotacao_id;

  if v_cot.requisicao_id is not null then
    update requisicoes_compra
       set status = 'convertida', pedido_id = v_pedido
     where id = v_cot.requisicao_id and status = 'aberta';
  end if;

  return v_pedido;
end $$;
