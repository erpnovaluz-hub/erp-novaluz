-- =============================================================================
-- CRM/ERP NOVALUZ — 0060 Ajuste de saldo da conta (conferência com o banco)
--
-- O financeiro informa o saldo REAL da conta (o que o banco mostra). A rpc
-- ajustar_saldo_conta calcula a diferença, lança um crédito/débito no extrato
-- (movimentacoes_caixa, origem 'ajuste', sem título) e atualiza saldo_atual.
-- Não mexe em títulos nem no fluxo mensal (ajuste não é receita nem despesa).
--
-- movimentacoes_caixa ganha: origem ('titulo' | 'ajuste'), criado_por, criado_em.
--
-- ATENÇÃO (SQL Editor do Supabase): escalares por atribuição, sem "select ... into" — ver 0050.
-- =============================================================================

alter table movimentacoes_caixa add column if not exists origem     text not null default 'titulo';
alter table movimentacoes_caixa add column if not exists criado_por uuid references perfis(id) on delete set null default auth.uid();
alter table movimentacoes_caixa add column if not exists criado_em  timestamptz not null default now();

alter table movimentacoes_caixa drop constraint if exists movimentacoes_caixa_origem_check;
alter table movimentacoes_caixa add constraint movimentacoes_caixa_origem_check
  check (origem in ('titulo','ajuste'));

create or replace function ajustar_saldo_conta(p_conta uuid, p_saldo_real numeric, p_motivo text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_empresa uuid;
  v_atual   numeric(14,2);
  v_dif     numeric(14,2);
begin
  if not pode('{financeiro}', 'editar') then raise exception 'Sem permissão no módulo Financeiro'; end if;
  if p_saldo_real is null then raise exception 'Informe o saldo real da conta'; end if;

  perform 1 from contas_bancarias where id = p_conta for update;   -- trava contra baixa simultânea
  v_empresa := (select empresa_consultora_id from contas_bancarias where id = p_conta);
  if v_empresa is null or v_empresa <> auth_empresa_id() then raise exception 'Conta não encontrada'; end if;
  v_atual := (select saldo_atual from contas_bancarias where id = p_conta);

  v_dif := round(p_saldo_real, 2) - v_atual;
  if v_dif = 0 then return 0; end if;

  insert into movimentacoes_caixa (empresa_consultora_id, conta_bancaria_id, tipo, valor, data, descricao, origem)
  values (v_empresa, p_conta,
          case when v_dif > 0 then 'credito' else 'debito' end,
          abs(v_dif), (now() at time zone 'America/Sao_Paulo')::date,
          'Ajuste de saldo' || coalesce(' — ' || nullif(trim(p_motivo), ''), ''),
          'ajuste');

  update contas_bancarias set saldo_atual = round(p_saldo_real, 2) where id = p_conta;
  return v_dif;
end $$;

grant execute on function ajustar_saldo_conta(uuid, numeric, text) to authenticated;
