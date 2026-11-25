# Ritmo de Gestão — Bloco 2: Metas e KPIs

> Spec técnica · 25/11/2026 · status: **construído** (falta rodar a migration 0071 e testar)
>
> **Decisões do §9 (aprovadas):** metas definidas por toda a gerência; responsável fora da gerência vê só o próprio KPI; margem e desvio entram já, com aviso.
>
> **Ajustes feitos na construção:**
> - O farol é calculado no front (`lib/kpis.ts`), e não numa view: a tela lê `kpis` + `kpi_medicoes` da janela de meses. Não há `vw_kpis_painel` nem `kpi_farol` em SQL.
> - A gravação de medições só acontece por RPC (`kpi_atualizar` para os automáticos; `kpi_lancar` para valor manual e para a causa de qualquer KPI).
> - O catálogo ganhou as colunas `foto` e `financeiro`. Um gatilho recusa responsável fora da gerência em KPI financeiro.
> - Na reunião, o bloco "fora da faixa" olha o mês fechado anterior quando a reunião é mensal, e o mês corrente nas demais.
> - O painel exige a causa (no front) ao lançar um valor fora da faixa.
> Depende do Bloco 1 (PR #3, migration 0070). Próximos: Bloco 3 persona "Gestão" no Assistente · Bloco 4 ritmo automático.

## 1. Objetivo

Cada empresa acompanha **poucos indicadores**, no formato simples **indicador + meta + farol**, com dono e tendência. Indicador que sai da faixa vira **assunto da reunião**: o ciclo do Bloco 1 passa a começar no número.

Regras da skill de gestão aplicadas aqui:
- Indicador existe para **provocar decisão**: toda ficha diz qual decisão ele apoia.
- **3 a 5 por empresa no começo.** Volume pareado com qualidade.
- **Sem meta no chute:** enquanto não há meta, o KPI mostra "📏 medindo linha de base". A meta é definida na reunião mensal, olhando o número real.
- Painel numa tela só, **destacando apenas o que está fora da faixa**.

## 2. Decisões que esta spec respeita

| # | Decisão | Onde |
|---|---|---|
| 1 | Só gerência administra; todos participam | §5 |
| 2 | Metas por empresa, tudo separado | `empresa_consultora_id` em `kpis`/`kpi_medicoes` |
| 3 | Formato simples (sem OKR) | §3 |
| 4 | Poucos KPIs | catálogo sugere 4 a 6 por segmento |
| 5 | Por tipo de negócio, e o ERP pode receber outros | catálogo por **segmento** + `empresas.segmento` |

## 3. Catálogo inicial

Cada item é uma **ficha**: o que responde, fórmula, fonte, sentido, periodicidade e coleta (automática ou manual). **Período = mês** (semanal fica para depois).

### Comuns a todos os segmentos (automáticos)
| Chave | Indicador | Fórmula (no mês) | Sentido | Decisão que apoia |
|---|---|---|---|---|
| `tarefas_no_prazo` | Tarefas no prazo | concluídas até o prazo ÷ concluídas com prazo | ↑ | sobrecarga ou mau planejamento? |
| `encaminhamentos_cumpridos` | Encaminhamentos cumpridos | feitos no prazo ÷ encaminhamentos com prazo efetivo no mês (exclui confidenciais) | ↑ | a gestão está funcionando? |
| `recebiveis_vencidos` | Recebíveis vencidos | R$ a receber vencido ÷ R$ a receber em aberto (foto no fim do mês) | ↓ | apertar cobrança / rever crédito do cliente |
| `caixa_meses` | Caixa (meses de fôlego) | saldo das contas ÷ média mensal de saídas dos últimos 90 dias (mesma conta do CFO Digital) | ↑ | segurar ou liberar gasto |

### Montagem industrial (T4)
| Chave | Indicador | Fórmula | Sentido | Coleta |
|---|---|---|---|---|
| `os_no_prazo` | Obras/OS entregues no prazo | OS que passaram a "concluído" no mês até o prazo ÷ OS concluídas no mês (data = `os_historico`) | ↑ | auto |
| `desvio_custo_os` | Desvio de custo (previsto × real) | média de (custo real − custo estimado) ÷ custo estimado, nas OS concluídas no mês com estimado | ↓ | auto (`resultados_os()`) |
| `dias_sem_acidente` | Dias sem acidente | lançado | ↑ | manual |

### Metalurgia / fabricação (MSFORT)
| Chave | Indicador | Fórmula | Sentido | Coleta |
|---|---|---|---|---|
| `os_no_prazo` | Pedidos/OS entregues no prazo | igual ao acima | ↑ | auto |
| `margem_os` | Margem média das OS | média de `margem_pct` das OS concluídas/faturadas no mês com valor de venda | ↑ | auto (`resultados_os()`) |
| `retrabalho` | Retrabalho | peças ou horas refeitas no mês | ↓ | manual |
| `perda_material` | Perda de material | % de material perdido | ↓ | manual |

### Serviços (para negócios futuros)
`os_no_prazo`, `margem_os` e os comuns.

### KPI livre
A gerência pode criar um indicador próprio, sempre **manual** e com a mesma ficha (nome, unidade, sentido, decisão que apoia).

> **Qualidade do dado:** margem e desvio de custo só ficam confiáveis se apontamentos e insumos forem lançados nas OS. Na medição de 03/11 havia 0 apontamentos, então a margem sairia inflada. Por isso esses KPIs aparecem com o aviso "depende de apontamento", e o primeiro mês serve para ver se o número faz sentido.

## 4. Modelo de dados — migration `0071_ritmo_kpis.sql`

### `empresas_consultoras.segmento`
`text` com check (`montagem_industrial` · `metalurgia` · `servicos` · `outro`). Fica nulo até a gerência escolher e serve só para sugerir o catálogo.

### `kpi_catalogo` (global, semeado pela migration)
`chave` pk · `nome` · `descricao` (o que responde) · `decisao` · `formula` (texto da ficha) · `unidade` (`pct`·`brl`·`meses`·`numero`·`dias`) · `sentido` (`maior`·`menor`) · `coleta` (`automatico`·`manual`) · `segmentos text[]` · `aviso` (ex.: "depende de apontamento") · `ordem`.
Leitura liberada para autenticados; escrita só pelo super (ou pela migration).

### `kpis` (os indicadores que a empresa acompanha)
| coluna | nota |
|---|---|
| id, empresa_consultora_id | |
| catalogo_chave | → kpi_catalogo; **nulo = KPI livre (manual)** |
| nome, unidade, sentido, descricao | copiados do catálogo (editáveis); obrigatórios no livre |
| responsavel_id | → perfis. Quem apresenta o número na reunião |
| meta | numeric, **nulo = medindo linha de base** |
| tolerancia | numeric default 10: faixa amarela, em % da meta |
| ativo, ordem, criado_por, criado_em | |

Unique `(empresa, catalogo_chave)` quando a chave não é nula, para não ter o mesmo KPI duas vezes.

### `kpi_medicoes`
`kpi_id, periodo` (pk; `periodo` = 1º dia do mês) · `valor numeric` · `origem` (`automatico`·`manual`) · `observacao` (a **causa**, quando fora da faixa) · `registrado_por` · `atualizado_em`.

### Farol (função `kpi_farol(valor, meta, tolerancia, sentido)` → `verde`·`amarelo`·`vermelho`·`sem_meta`·`sem_dado`)
- sentido **maior**: verde se valor ≥ meta; amarelo se valor ≥ meta − |meta|·tol%; senão vermelho.
- sentido **menor**: espelhado.

### View `vw_kpis_painel` (security_invoker)
KPI + valor do mês atual + valor do mês anterior + farol + série dos últimos 6 meses (`jsonb`).

### Cálculo automático
- `_kpi_valor_auto(chave, empresa, inicio, fim) returns numeric`: um `case` por chave, com SQL direto nas tabelas. Para margem e desvio, usa a mesma conta de `resultados_os()` sem o filtro de sessão (definer, filtrando empresa).
- RPC **`kpi_atualizar(p_periodo date)`** (gerência): recalcula todos os KPIs automáticos ativos da empresa naquele mês e faz upsert em `kpi_medicoes`. O painel chama para o **mês atual** ao abrir e, se faltar, para o **mês anterior**. Assim o mês corrente é "parcial" e o anterior fica fechado.
- KPIs de foto (`recebiveis_vencidos`, `caixa_meses`) só se calculam no mês atual, porque não há histórico de saldo. A medição do mês fica **congelada** quando o mês vira (o recálculo não sobrescreve mês passado já gravado).
- Mês anterior sem medição de foto: fica "sem dado" (honesto, sem inventar).
- O cron mensal que grava a foto no dia 1º fica no **Bloco 4**. No Bloco 2 basta alguém da gerência abrir o painel no mês.

## 5. Acesso (RLS)

| Ação | Quem |
|---|---|
| Ver catálogo | todos |
| Ver painel completo (todos os KPIs da empresa) | gerência |
| Ver um KPI | gerência · **o responsável por ele** |
| Criar/editar KPI, meta e tolerância; escolher o segmento | gerência |
| Lançar medição manual / escrever a causa | gerência · o responsável pelo KPI |
| `kpi_atualizar` | gerência |

KPIs financeiros (`recebiveis_vencidos`, `caixa_meses`, `margem_os`, `desvio_custo_os`) **não podem ter responsável fora da gerência**: almoxarifado e logística não veem valores (decisão da V3). O banco recusa, com mensagem.

## 6. Telas

| Rota | Conteúdo |
|---|---|
| `/gestao/indicadores` | **Painel**: uma linha por KPI com nome, responsável, valor do mês (parcial), meta, farol, mês anterior e mini-tendência de 6 meses. Ordem: vermelhos, amarelos, sem meta, verdes. Seletor de mês. Clique abre o detalhe. |
| (drawer) detalhe do KPI | Ficha (fórmula, fonte, decisão que apoia, aviso), histórico mês a mês com causa, lançar valor manual, editar meta/tolerância/responsável. |
| `/gestao/indicadores/configurar` | Gerência: segmento da empresa, catálogo filtrado pelo segmento com "adicionar", KPI livre, ativar/desativar e ordenar. Aviso de dose: "mais de 5 indicadores ninguém acompanha". |

**Integração com o Bloco 1** (pequena e de alto valor):
- Na tela da reunião **mensal** (e semanal), aba Ata: um bloco "📊 Indicadores fora da faixa" com os vermelhos e amarelos e o botão **"Levar à pauta"**. Ele cria o item de pauta "KPI X: valor vs meta", e na Ata a causa é discutida.
- No hub `/gestao`: um card "📊 Meus indicadores" para quem é responsável, e um resumo de faróis para a gerência.
- Item "📊 Indicadores" no menu, dentro de Ritmo de Gestão.

## 7. Fora do Bloco 2

Período semanal · cron da foto mensal e pauta automática (Bloco 4) · OKR · consolidação entre empresas · indicadores do Assistente (Bloco 3).

## 8. Critérios de aceite

1. A gerência escolhe o segmento da MSFORT ("metalurgia") e vê o catálogo sugerido com comuns + metalurgia.
2. Adiciona 5 KPIs; o 6º mostra o aviso de dose (sem bloquear).
3. Ao abrir o painel, os KPIs automáticos mostram o valor do mês atual. Sem meta, aparece "📏 medindo linha de base".
4. Com meta definida, o farol muda conforme o sentido: ↑ e ↓ testados com um KPI de cada.
5. KPI manual: o responsável (não gerência) lança o valor e escreve a causa, e não vê os outros KPIs.
6. Tentar pôr o almoxarifado como responsável de "Caixa (meses)" é recusado.
7. Na reunião mensal, "Levar à pauta" cria o item, e ele aparece na ata impressa.
8. T4 não vê nada da MSFORT, e vice-versa.
9. `tsc --noEmit` OK; migration roda limpa.

## 9. Perguntas em aberto

1. **Quem define as metas?** (a) toda a gerência; (b) só quem tem "Conduz reuniões". Recomendação: **(a) gerência**. Meta é decisão de gestão, não de condução de reunião, e quase todos os gerentes vão estar nas mensais mesmo.
2. **Colaborador responsável por um KPI** (ex.: o encarregado responde por "Retrabalho") vê **só o próprio**, ou também o painel inteiro sem os financeiros? Recomendação: **só o próprio**, que é simples e não expõe números de outros setores.
3. **Margem e desvio de custo já no Bloco 2**, com o aviso de qualidade do dado, ou deixar para quando os apontamentos estiverem em dia? Recomendação: **já no Bloco 2 com o aviso**. O próprio número estranho vira o empurrão para lançar os apontamentos.
