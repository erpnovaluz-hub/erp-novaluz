-- =============================================================================
-- CRM/ERP NOVALUZ — 0009 RLS dos módulos de ERP
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'fornecedores','depositos','produtos','categorias_financeiras','contas_bancarias',
    'saldos_estoque','movimentacoes_estoque','movimentacoes_caixa','titulos_financeiros',
    'pedidos_compra','itens_pedido_compra','consumo_producao'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists tenant_all on %I;', t);
    execute format($f$
      create policy tenant_all on %I
        using      (empresa_consultora_id = auth_empresa_id())
        with check (empresa_consultora_id = auth_empresa_id());
    $f$, t);
  end loop;
end $$;

-- Views: executam com o RLS do usuário que consulta (senão vazam entre tenants).
-- Requer PostgreSQL 15+ (Supabase já é 15+).
alter view vw_fluxo_caixa set (security_invoker = on);
alter view vw_custo_obra  set (security_invoker = on);
