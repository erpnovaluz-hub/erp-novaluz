-- =============================================================================
-- CRM/ERP NOVALUZ — 0050 Notificações no celular (Web Push)
--
-- push_inscricoes  cada aparelho/navegador onde a pessoa ativou as notificações
-- config_sistema   URL e segredo do envio (sem policies: ninguém lê pelo app)
-- Toda linha nova em notificacoes dispara (pg_net) um POST para o app em
-- /api/push/enviar, que manda o push para os aparelhos do destinatário.
-- Se o envio falhar, a notificação continua normal na caixa de entrada.
--
-- DEPOIS DE RODAR, configure (troque pelos seus valores):
--   insert into config_sistema (chave, valor) values
--     ('push_url',     'https://SEU-SITE.vercel.app/api/push/enviar'),
--     ('push_segredo', 'o mesmo valor de PUSH_WEBHOOK_SECRET da Vercel')
--   on conflict (chave) do update set valor = excluded.valor;
--
-- Depende de 0042 (notificacoes).
-- =============================================================================

create extension if not exists pg_net;

create table if not exists push_inscricoes (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  perfil_id             uuid not null references perfis(id) on delete cascade default auth.uid(),
  endpoint              text not null unique,
  p256dh                text not null,
  auth                  text not null,
  aparelho              text,
  criado_em             timestamptz not null default now(),
  ultimo_envio          timestamptz
);
create index if not exists idx_push_perfil on push_inscricoes(perfil_id);

-- cada um vê e gerencia só os próprios aparelhos
alter table push_inscricoes enable row level security;
drop policy if exists push_proprias on push_inscricoes;
create policy push_proprias on push_inscricoes for all
  using      (perfil_id = (select auth.uid()))
  with check (perfil_id = (select auth.uid()) and empresa_consultora_id = (select auth_empresa_id()));

create table if not exists config_sistema (
  chave text primary key,
  valor text not null
);
alter table config_sistema enable row level security;   -- sem policies: só funções security definer leem
revoke all on config_sistema from anon, authenticated;

create or replace function _push_notificacao()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare v_url text; v_seg text;
begin
  select valor into v_url from config_sistema where chave = 'push_url';
  select valor into v_seg from config_sistema where chave = 'push_segredo';
  if v_url is null or v_seg is null then return new; end if;
  if not exists (select 1 from push_inscricoes where perfil_id = new.destinatario_id) then return new; end if;
  begin
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object('notificacao_id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_seg));
  exception when others then
    null;   -- push é bônus: nunca impede a notificação de ser gravada
  end;
  return new;
end $$;

drop trigger if exists trg_push_notificacao on notificacoes;
create trigger trg_push_notificacao after insert on notificacoes
  for each row execute function _push_notificacao();
