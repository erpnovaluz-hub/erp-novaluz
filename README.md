# ERP Novaluz — Next.js + Supabase (com CRM embutido)

ERP modular e leve para a MSFORT (metalurgia / serviço industrial). O **CRM é o
módulo Comercial**; ao redor dele: Cadastros, Estoque, Compras, Financeiro e
Produção/OS. Profundidade transacional real — **saldos, custo médio e baixa
financeira são automáticos, via triggers no Postgres** — mantendo a interface leve.

Stack: **Next.js 14 (App Router) · TypeScript · Tailwind · Supabase** (auth + Postgres + RLS).

---

## Módulos e automação
| Módulo | Tabelas | O que o banco faz sozinho |
|---|---|---|
| **Comercial (CRM)** | clientes, contatos, interações, oportunidades, propostas, contratos, faturamento, tarefas, documentos | — |
| **Cadastros** | fornecedores, produtos, depósitos, categorias, contas/caixa, colaboradores | inicializa saldo da conta |
| **Estoque** | movimentações, saldos por depósito | entrada/saída → **saldo + custo médio ponderado** |
| **Compras** | pedidos + itens | receber pedido → **entrada no estoque + título a pagar** |
| **Financeiro** | títulos (pagar/receber), caixa | baixar título → **movimento de caixa + saldo da conta** |
| **Produção / OS** | obras, alocação, consumo | consumo → **saída de estoque**; view de **custo real × orçado** |

Telas de leitura consolidada: **Saldos** (estoque), **Fluxo de caixa** (financeiro),
**Custos por obra** (produção).

## 1. Criar o banco no Supabase
No **SQL Editor**, rode em ordem:
```
supabase/migrations/0001_core.sql      núcleo + tenant + perfis
supabase/migrations/0002_msfort.sql    obras, equipe, materiais, manutenção
supabase/migrations/0003_rls.sql       RLS do núcleo/MSFORT
supabase/migrations/0004_erp_cadastros.sql
supabase/migrations/0005_estoque.sql   + trigger de saldo/custo médio
supabase/migrations/0006_financeiro.sql + trigger de baixa
supabase/migrations/0007_compras.sql   + trigger de recebimento
supabase/migrations/0008_producao.sql  + trigger de consumo + view de custo
supabase/migrations/0009_rls_erp.sql   RLS do ERP + security_invoker nas views
```

## 2. Usuário + tenant
- **Authentication → Users → Add user** (e-mail + senha).
- No SQL Editor:
```sql
insert into empresas_consultoras (nome) values ('MSFORT') returning id;
insert into perfis (id, empresa_consultora_id, nome, papel)
values ('<AUTH_USER_ID>', '<EMPRESA_ID>', 'Fernando', 'admin');
```
- (Opcional) `supabase/seed.sql` popula CRM + ERP: cria uma **compra recebida**
  (que já gera estoque e título a pagar) e um **consumo** na obra, para você ver
  saldos, fluxo e custos preenchidos.

## 3. Conectar o app
`.env.local` com as chaves de **Project Settings → API**:
```
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua-anon-key
```

## 4. Rodar
```bash
npm install
npm run dev
```
http://localhost:3000 → login → painel.

---

## Fluxos de uso (a automação mora nos triggers)
- **Comprar:** crie o *Pedido de compra* (com depósito e vencimento) → adicione
  *Itens* → mude o status para **recebido**. Entra no estoque e nasce a conta a pagar.
- **Pagar/receber:** no *Contas a pagar/receber*, mude o título para **pago** e
  informe a conta. Gera o movimento de caixa e ajusta o saldo. Voltar para
  *aberto* estorna.
- **Produção:** lance *Consumo de material* na obra → sai do estoque pelo custo
  médio. *Custos por obra* mostra material + mão de obra × orçado.

## Arquitetura (fluxo leve)
CRUD dirigido por configuração: cada tabela é uma entrada em
[`src/lib/entities.ts`](src/lib/entities.ts); a rota `/e/[entity]` gera lista,
busca e formulário. Campos calculados por trigger (custo médio, saldo, total,
subtotal) são `hideInForm` — só leitura. Para um cliente/segmento novo, some uma
migration no mesmo padrão e entradas em `entities.ts`.

## Notas
- **Estoque é append-only**: para corrigir, lance um ajuste (não edite/exclua a
  movimentação — o saldo não é recalculado ao apagar).
- **Segurança:** `next@14.2.35` corrige o CVE do Next; restam 2 avisos `npm audit`
  de um `postcss` aninhado de build (só somem indo pro Next 16, breaking).
- **Fiscal (NF-e/NFS-e):** fora do escopo desta versão, conforme combinado.
