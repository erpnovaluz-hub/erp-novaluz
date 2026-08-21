-- =============================================================================
-- CRM/ERP NOVALUZ — 0010 FINANCEIRO: DRE + parcelamento
-- 1) categorias ganham grupo_dre + ordem (base de DRE e relatórios)
-- 2) títulos ganham competência + dados de parcela
-- 3) função seed_categorias_dre(tenant) — plano de contas padrão
-- 4) função gerar_parcelas(...) — cria N títulos a pagar/receber parcelados
-- =============================================================================

-- 1) DRE nas categorias -------------------------------------------------------
alter table categorias_financeiras
  add column if not exists grupo_dre text,
  add column if not exists ordem     int not null default 100;

-- idempotência do seed
create unique index if not exists uq_categoria_nome
  on categorias_financeiras(empresa_consultora_id, nome);

-- 2) competência + parcelas nos títulos ---------------------------------------
alter table titulos_financeiros
  add column if not exists competencia         date,
  add column if not exists parcela_numero      int,
  add column if not exists parcela_total        int,
  add column if not exists grupo_parcelamento  uuid;

create index if not exists idx_titulos_grupo_parc on titulos_financeiros(grupo_parcelamento);
create index if not exists idx_titulos_competencia on titulos_financeiros(empresa_consultora_id, competencia);

-- 3) plano de contas padrão (DRE) ---------------------------------------------
create or replace function seed_categorias_dre(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into categorias_financeiras (empresa_consultora_id, nome, natureza, grupo_dre, ordem) values
    (p_tenant, 'Receita de serviços',                 'receita', 'receita', 10),
    (p_tenant, 'Receita de vendas',                   'receita', 'receita', 11),
    (p_tenant, 'Receita de locação',                  'receita', 'receita', 12),
    (p_tenant, 'Impostos sobre faturamento',          'despesa', 'deducao', 20),
    (p_tenant, 'Custo de material / insumos',          'despesa', 'custo', 30),
    (p_tenant, 'Custo de mão de obra direta',          'despesa', 'custo', 31),
    (p_tenant, 'Custo de terceiros / subcontratação',  'despesa', 'custo', 32),
    (p_tenant, 'Custo de equipamentos / locação',      'despesa', 'custo', 33),
    (p_tenant, 'Despesas com pessoal (folha/encargos)','despesa', 'despesa_operacional', 40),
    (p_tenant, 'Despesas administrativas',             'despesa', 'despesa_operacional', 41),
    (p_tenant, 'Despesas comerciais / marketing',      'despesa', 'despesa_operacional', 42),
    (p_tenant, 'Ocupação (aluguel/energia/água)',      'despesa', 'despesa_operacional', 43),
    (p_tenant, 'Manutenção e frota',                   'despesa', 'despesa_operacional', 44),
    (p_tenant, 'Impostos e taxas',                     'despesa', 'despesa_operacional', 45),
    (p_tenant, 'Juros e tarifas bancárias',            'despesa', 'despesa_financeira', 50),
    (p_tenant, 'Outras receitas',                      'receita', 'outras', 90),
    (p_tenant, 'Outras despesas',                      'despesa', 'outras', 91),
    (p_tenant, 'Investimentos / imobilizado',          'despesa', 'outras', 92)
  on conflict (empresa_consultora_id, nome) do nothing;
end $$;

-- 4) geração de parcelas ------------------------------------------------------
-- Cria N títulos, dividindo o total (a última parcela ajusta o arredondamento).
-- Chamar via RPC pelo app (usuário autenticado).
create or replace function gerar_parcelas(
  p_tipo            text,               -- 'pagar' | 'receber'
  p_descricao       text,
  p_valor_total     numeric,
  p_num_parcelas    int,
  p_primeiro_venc   date,
  p_intervalo_dias  int default 30,
  p_fornecedor      uuid default null,
  p_cliente         uuid default null,
  p_categoria       uuid default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := auth_empresa_id();
  v_grupo  uuid := gen_random_uuid();
  v_base   numeric := round(p_valor_total / p_num_parcelas, 2);
  v_acum   numeric := 0;
  v_valor  numeric;
  v_venc   date;
  i        int;
begin
  if v_tenant is null then
    raise exception 'Usuário sem tenant (não autenticado)';
  end if;
  if p_num_parcelas < 1 then
    raise exception 'Número de parcelas deve ser >= 1';
  end if;

  for i in 1..p_num_parcelas loop
    if i < p_num_parcelas then
      v_valor := v_base;
      v_acum  := v_acum + v_base;
    else
      v_valor := round(p_valor_total - v_acum, 2);   -- última fecha o total
    end if;
    v_venc := p_primeiro_venc + ((i - 1) * p_intervalo_dias);

    insert into titulos_financeiros
      (empresa_consultora_id, tipo, descricao, fornecedor_id, cliente_id, categoria_id,
       valor, vencimento, competencia, status, origem,
       parcela_numero, parcela_total, grupo_parcelamento)
    values
      (v_tenant, p_tipo,
       p_descricao || ' (' || i || '/' || p_num_parcelas || ')',
       p_fornecedor, p_cliente, p_categoria,
       v_valor, v_venc, v_venc, 'aberto', 'manual',
       i, p_num_parcelas, v_grupo);
  end loop;

  return p_num_parcelas;
end $$;

-- 5) VIEW de apoio ao DRE (por competência e grupo) ---------------------------
create or replace view vw_dre as
select
  t.empresa_consultora_id,
  date_trunc('month', coalesce(t.competencia, t.vencimento))::date as competencia,
  coalesce(c.grupo_dre, 'sem_categoria') as grupo_dre,
  c.natureza,
  t.tipo,
  sum(t.valor) as total
from titulos_financeiros t
left join categorias_financeiras c on c.id = t.categoria_id
where t.status <> 'cancelado'
group by 1, 2, 3, 4, 5;

alter view vw_dre set (security_invoker = on);
