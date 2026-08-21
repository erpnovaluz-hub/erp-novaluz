-- =============================================================================
-- CRM NOVALUZ — 0003 RLS (Row Level Security) multi-tenant
-- Isola cada linha por empresa_consultora_id = tenant do usuário logado.
-- =============================================================================

-- perfis: cada um enxerga só o próprio perfil ---------------------------------
alter table perfis enable row level security;
drop policy if exists perfis_self on perfis;
create policy perfis_self on perfis
  using (id = auth.uid());

-- empresas_consultoras: usuário vê só o próprio tenant ------------------------
alter table empresas_consultoras enable row level security;
drop policy if exists empresa_self on empresas_consultoras;
create policy empresa_self on empresas_consultoras
  using (id = auth_empresa_id());

-- Macro aplicada a todas as tabelas de dados (núcleo + módulo) -----------------
do $$
declare t text;
begin
  foreach t in array array[
    'clientes','contatos','interacoes','oportunidades','propostas',
    'contratos','faturamento','tarefas_followup','documentos',
    'colaboradores','obras_servicos','alocacao_equipe',
    'materiais_por_obra','manutencao_recorrente'
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
