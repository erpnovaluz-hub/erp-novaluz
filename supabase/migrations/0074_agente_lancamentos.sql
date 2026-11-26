-- =============================================================================
-- CRM/ERP NOVALUZ — 0074 Agente de lançamentos (documento, comprovante, extrato)
--
-- 1) titulos_financeiros.anexo_caminho: boleto/NF/comprovante guardado no bucket
--    privado "anexos" (1ª pasta = empresa, policy da 0042).
-- 2) agente_financeiro ganha:
--      criar_titulo  → aceita forma/dados de pagamento e anexo (segue 'aberto')
--      baixar        → baixa um título ABERTO (comprovante). Mexe no saldo via
--                      trigger processar_baixa_titulo. Faixa VERMELHA no chat:
--                      só executa depois do clique de uma pessoa, um a um.
--      criar_pago    → lança um título já pago (comprovante sem título prévio).
--    Continua SECURITY INVOKER: o RLS/pode('financeiro','editar') vale.
-- 3) Conciliação de extrato: extratos_importados, extrato_linhas (chave única
--    por conta → reimportar o mesmo arquivo não duplica) e regras_conciliacao
--    (o que o financeiro confirmou vira regra para a próxima importação).
--
-- ATENÇÃO (SQL Editor do Supabase): escalares por atribuição, sem "select ... into".
-- Depende de 0006, 0010, 0040 (_aplicar_acesso), 0059, 0067.
-- =============================================================================

-- 1) anexo no título -----------------------------------------------------------
alter table titulos_financeiros add column if not exists anexo_caminho text;

-- 2) dispatcher financeiro do agente (invoker) ---------------------------------
create or replace function agente_financeiro(p_acao text, p jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_id   uuid;
  v_n    int;
  v_data date;
  v_forn uuid;
  v_doc  text;
  v_criou boolean := false;
begin
  -- Fornecedor pelo comprovante: id explícito; senão acha pelo CNPJ/CPF de
  -- "quem recebeu"; senão cadastra (só em título a pagar com nome informado).
  v_forn := nullif(p->>'fornecedor_id','')::uuid;
  if v_forn is null and p->>'tipo' = 'pagar' and nullif(trim(p->>'fornecedor_nome'),'') is not null
     and p_acao in ('criar_titulo','criar_pago') then
    v_doc := regexp_replace(coalesce(p->>'fornecedor_documento',''), '\D', '', 'g');
    if v_doc <> '' then
      v_forn := (select f.id from fornecedores f
                  where regexp_replace(coalesce(f.documento,''), '\D', '', 'g') = v_doc limit 1);
    end if;
    if v_forn is null then
      v_forn := (select f.id from fornecedores f where lower(f.nome) = lower(trim(p->>'fornecedor_nome')) limit 1);
    end if;
    if v_forn is null then
      insert into fornecedores (nome, documento)
      values (trim(p->>'fornecedor_nome'), nullif(p->>'fornecedor_documento',''))
      returning id into v_forn;
      v_criou := true;
    end if;
  end if;

  if p_acao = 'criar_titulo' then
    -- previsão (boleto/NF a vencer): nasce 'aberto', não mexe em saldo
    insert into titulos_financeiros
      (tipo, descricao, valor, vencimento, competencia, categoria_id, subcategoria_id, cliente_id, fornecedor_id,
       forma_pagamento, dados_pagamento, anexo_caminho, status, origem)
    values
      (p->>'tipo', p->>'descricao', (p->>'valor')::numeric, nullif(p->>'vencimento','')::date,
       nullif(p->>'competencia','')::date,
       nullif(p->>'categoria_id','')::uuid, nullif(p->>'subcategoria_id','')::uuid,
       nullif(p->>'cliente_id','')::uuid, v_forn,
       nullif(p->>'forma_pagamento',''), nullif(p->>'dados_pagamento',''), nullif(p->>'anexo_caminho',''),
       'aberto', 'manual')
    returning id into v_id;
    return jsonb_build_object('titulo_id', v_id, 'fornecedor_id', v_forn, 'fornecedor_criado', v_criou);

  elsif p_acao = 'vencimento' then
    update titulos_financeiros
       set vencimento = nullif(p->>'vencimento','')::date
     where id = (p->>'titulo_id')::uuid and status = 'aberto';
    return jsonb_build_object('titulo_id', p->>'titulo_id');

  elsif p_acao = 'baixar' then
    -- comprovante de um título que já existe em aberto
    if nullif(p->>'conta_bancaria_id','') is null then
      raise exception 'Baixa exige a conta de onde saiu/entrou o dinheiro';
    end if;
    update titulos_financeiros
       set status            = 'pago',
           data_pagamento    = coalesce(nullif(p->>'data_pagamento','')::date, current_date),
           conta_bancaria_id = (p->>'conta_bancaria_id')::uuid,
           valor             = coalesce(nullif(p->>'valor','')::numeric, valor),
           forma_pagamento   = coalesce(nullif(p->>'forma_pagamento',''), forma_pagamento),
           anexo_caminho     = coalesce(nullif(p->>'anexo_caminho',''), anexo_caminho)
     where id = (p->>'titulo_id')::uuid and status = 'aberto';
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'Título não está em aberto (ou você não tem acesso a ele)';
    end if;
    return jsonb_build_object('titulo_id', p->>'titulo_id');

  elsif p_acao = 'criar_pago' then
    -- comprovante sem título prévio: lança já pago (trigger movimenta o saldo)
    if nullif(p->>'conta_bancaria_id','') is null then
      raise exception 'Lançamento pago exige a conta de onde saiu/entrou o dinheiro';
    end if;
    v_data := coalesce(nullif(p->>'data_pagamento','')::date, current_date);
    insert into titulos_financeiros
      (tipo, descricao, valor, vencimento, competencia, categoria_id, subcategoria_id, cliente_id, fornecedor_id,
       forma_pagamento, dados_pagamento, anexo_caminho, conta_bancaria_id, data_pagamento, status, origem)
    values
      (p->>'tipo', p->>'descricao', (p->>'valor')::numeric, v_data,
       coalesce(nullif(p->>'competencia','')::date, date_trunc('month', v_data)::date),
       nullif(p->>'categoria_id','')::uuid, nullif(p->>'subcategoria_id','')::uuid,
       nullif(p->>'cliente_id','')::uuid, v_forn,
       nullif(p->>'forma_pagamento',''), nullif(p->>'dados_pagamento',''), nullif(p->>'anexo_caminho',''),
       (p->>'conta_bancaria_id')::uuid, v_data, 'pago', 'manual')
    returning id into v_id;
    return jsonb_build_object('titulo_id', v_id, 'fornecedor_id', v_forn, 'fornecedor_criado', v_criou);

  else
    raise exception 'Ação financeira desconhecida: %', p_acao;
  end if;
end $$;

grant execute on function agente_financeiro(text, jsonb) to authenticated;

-- 3) Conciliação de extrato ----------------------------------------------------
create table if not exists extratos_importados (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  conta_bancaria_id     uuid not null references contas_bancarias(id) on delete cascade,
  arquivo_nome          text,
  formato               text not null check (formato in ('ofx','csv','pdf','texto')),
  periodo_de            date,
  periodo_ate           date,
  saldo_final           numeric(14,2),
  linhas_novas          int not null default 0,
  linhas_repetidas      int not null default 0,
  criado_por            uuid references perfis(id) on delete set null default auth.uid(),
  criado_em             timestamptz not null default now()
);

create table if not exists extrato_linhas (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  extrato_id            uuid references extratos_importados(id) on delete set null,
  conta_bancaria_id     uuid not null references contas_bancarias(id) on delete cascade,
  data                  date not null,
  valor                 numeric(14,2) not null,          -- + entrada (crédito) / - saída (débito)
  descricao             text,
  documento             text,
  chave                 text not null,                   -- FITID do OFX ou hash data|valor|descrição|nº
  status                text not null default 'pendente' check (status in ('pendente','conciliado','ignorado')),
  efeito                text check (efeito in ('vinculo','baixa','lancamento')),
  titulo_id             uuid references titulos_financeiros(id) on delete set null,
  sugestao              jsonb,
  antes                 jsonb,                           -- before-image do título (desfazer a baixa)
  decidido_por          uuid references perfis(id) on delete set null,
  decidido_em           timestamptz,
  criado_em             timestamptz not null default now()
);
create unique index if not exists uq_extrato_linha_chave on extrato_linhas(conta_bancaria_id, chave);
create index if not exists idx_extrato_linhas_conta on extrato_linhas(empresa_consultora_id, conta_bancaria_id, status, data);

create table if not exists regras_conciliacao (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  tipo                  text not null check (tipo in ('pagar','receber')),
  padrao                text not null,                   -- descrição normalizada (sem números/datas)
  descricao             text,
  categoria_id          uuid references categorias_financeiras(id) on delete set null,
  subcategoria_id       uuid references subcategorias_financeiras(id) on delete set null,
  fornecedor_id         uuid references fornecedores(id) on delete set null,
  cliente_id            uuid references clientes(id) on delete set null,
  usos                  int not null default 1,
  atualizado_em         timestamptz not null default now()
);
create unique index if not exists uq_regra_conciliacao on regras_conciliacao(empresa_consultora_id, tipo, padrao);

-- quem lê/edita o financeiro lê/edita a conciliação
select _aplicar_acesso('extratos_importados', '{financeiro}', '{financeiro}');
select _aplicar_acesso('extrato_linhas',      '{financeiro}', '{financeiro}');
select _aplicar_acesso('regras_conciliacao',  '{financeiro}', '{financeiro}');
