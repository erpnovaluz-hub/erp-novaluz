# Ritmo de Gestão — Bloco 4: ritmo automático

> Spec técnica · 25/11/2026 · status: **construído** (falta rodar a migration 0073 e testar)
>
> **Decisões do §11 (aprovadas):** antecedência padrão de 6 dias (semanal/quinzenal) e 10 dias (mensal/trimestral), editável por molde; lembrete às 16:00; indicadores entram na pauta já aceitos.
>
> **Ajustes feitos na construção:**
> - Se a ata da anterior é fechada **depois** de a próxima reunião já existir, os itens adiados são copiados para ela no dia seguinte, uma vez só. Se alguém tirar o item, ele não volta sozinho.
> - O lembrete de véspera também acrescenta à pauta os indicadores que saíram da faixa desde a criação da reunião (a mensal nasce 10 dias antes).
> - O mensal/trimestral usa só o modo "n-ésimo dia da semana" (1ª a 4ª ou última).
> Depende dos Blocos 1 a 3 (0070–0072). Fecha o Ritmo de Gestão.

## 1. Objetivo

Fazer o ritmo **acontecer sozinho**, sem depender de alguém lembrar:

1. **Reuniões recorrentes:** a semanal e a mensal se criam sozinhas, ligadas à anterior da série (as pendências vêm junto) e com os convites enviados.
2. **Pauta que já nasce pronta:** itens adiados da anterior + **indicadores fora da faixa**.
3. **Lembretes:** véspera da reunião (participantes) e **ata não fechada** (quem conduz).
4. **Indicadores sempre atualizados:** recálculo diário dos automáticos de todas as empresas. A **foto do mês** (recebíveis, caixa) fica gravada no último dia, sem ninguém abrir o painel. Isso fecha a lacuna do Bloco 2.
5. **"O meu dia"** passa a citar os **encaminhamentos** da pessoa (atrasados e vencendo) e as **atas esperando a ciência** dela.

Princípio da skill de gestão: *a ausência da trimestral é a causa mais comum de empresa que trabalha muito e não sai do lugar*. A recorrência garante que a reunião exista, e o resto (pauta, lembrete, cobrança) garante que ela sirva para alguma coisa.

## 2. Arquitetura

- **Tudo em SQL, no `pg_cron`** (já ligado desde a 0061). Não passa pelo servidor do app, não usa IA, custo zero. Funciona mesmo sem a `ronda_url` configurada.
- Os avisos são linhas em `notificacoes` (tipo `reuniao`). O gatilho de push (0050) já manda o push para o celular.
- **Exceção:** o "O meu dia" já é TypeScript (`meudia.ts`, disparado pela ronda). A mudança entra lá, e o texto continua sem IA para quem não é o dono.
- Toda rotina é **idempotente**: se rodar duas vezes no mesmo dia, não duplica reunião nem aviso.

## 3. Reuniões recorrentes — migration `0073_ritmo_automatico.sql`

### `reuniao_recorrencias` (o "molde" da série)
| coluna | nota |
|---|---|
| id, empresa_consultora_id | |
| titulo, tipo | ex.: "Semanal de operação", `semanal` |
| frequencia | `semanal` · `quinzenal` · `mensal` · `trimestral` |
| dia_semana | 0–6 (semanal/quinzenal; e mensal/trimestral no modo "1ª segunda") |
| semana_do_mes | 1–4 ou `ultima` (mensal/trimestral) |
| hora, duracao_min, local | |
| conduzida_por | → perfis |
| participantes | `uuid[]` |
| antecedencia_dias | quantos dias antes a próxima é criada (pergunta 1) |
| ativo, criado_por, criado_em | |

- `reunioes.recorrencia_id` liga cada reunião ao molde. A **anterior da série** passa a ser a última reunião daquele molde (mais preciso que "a última do mesmo tipo").
- RLS: ler = gerência; escrever = quem conduz (`pode_conduzir`).
- **Molde confidencial não existe.** Reunião confidencial é sempre criada à mão.

### Rotina `ritmo_cron_reunioes()` — diária, 07:00 de Fortaleza
Para cada molde ativo:
1. Calcula a **próxima data** da série (depois da última reunião existente do molde).
2. Se faltam `antecedencia_dias` ou menos **e** ela ainda não existe, cria (`_ritmo_criar_reuniao_interno`, a mesma lógica da RPC, sem exigir usuário logado):
   - participantes do molde, convites enviados, `anterior_id` = última do molde;
   - **itens adiados** da anterior voltam para a pauta (como hoje);
   - **indicadores fora da faixa** entram na pauta (`origem = 'indicador'`). A mensal olha o mês fechado; a semanal, o mês corrente.
3. Nunca cria duas para a mesma data.

## 4. Lembretes — rotina `ritmo_cron_lembretes()` — diária, 16:00 de Fortaleza

| Aviso | Para quem | Quando |
|---|---|---|
| "Amanhã: *Semanal de operação* às 08:00 · pauta com 5 itens. Tem assunto? Sugira na pauta." | participantes | reunião agendada para amanhã (uma vez: `reunioes.lembrete_em`) |
| "N sugestões de pauta aguardando você para *X* amanhã" | quem conduz | junto com o anterior, se houver sugestões |
| "A ata de *X* (dd/mm) ainda não foi fechada — os encaminhamentos só viram tarefa depois disso." | quem conduz | reunião com data passada há mais de 1 dia e status agendada/em andamento; repete a cada 3 dias, até 3 vezes |

Reunião confidencial: o aviso vai só para os participantes dela (que já são os únicos que a veem), com o título dela.

## 5. Indicadores — rotina `ritmo_cron_kpis()` — diária, 23:30 de Fortaleza

- Recalcula os KPIs automáticos ativos de **todas as empresas** no mês corrente (`_kpi_atualizar_empresa(emp, mês)`; a RPC `kpi_atualizar` passa a chamar essa mesma função).
- Como roda todo dia às 23:30, a execução do **último dia do mês** grava a foto final de recebíveis e caixa. Na virada do mês ela congela (regra do Bloco 2).
- Nova função SQL `kpi_farol(valor, meta, tolerancia, sentido)` (espelho de `lib/kpis.ts`), usada pela pauta automática.

## 6. "O meu dia" — `meudia.ts`

Duas contagens novas por pessoa, ambas só dela:
- **Encaminhamentos:** atrasados e vencendo em até 2 dias (`vw_encaminhamentos`, dono = pessoa, status aberto/atrasado).
- **Atas aguardando a ciência dela** (presente, sem ciência, ata fechada).

O texto ganha, por exemplo: "· 2 encaminhamentos de reunião (1 atrasado) · 1 ata para dar ciência". **Só contagens, sem títulos**, então nada de reunião confidencial vaza num aviso. Quem não tinha nada antes e agora tem um encaminhamento passa a receber o bom-dia.

## 7. Telas

| Onde | O quê |
|---|---|
| `/gestao/reunioes` (topo) | Card **"🔁 Reuniões recorrentes"**: lista dos moldes (próxima data, frequência, ativo) + "Nova recorrência" (formulário: título, tipo, frequência, dia/semana, hora, duração, local, quem conduz, participantes, antecedência). Só quem conduz edita. |
| Tela da reunião | Selo "🔁 recorrente" e link para o molde. Itens de pauta vindos de indicador mostram "📊 indicador". |
| Hub `/gestao` | "Próximas reuniões" passa a mostrar também as próximas datas previstas pelos moldes (ainda não criadas), em cinza. |

## 8. Agenda dos jobs (UTC)

| Job | Cron (UTC) | Fortaleza |
|---|---|---|
| `ritmo_reunioes` | `0 10 * * *` | 07:00 |
| `ritmo_lembretes` | `0 19 * * *` | 16:00 |
| `ritmo_kpis` | `30 2 * * *` | 23:30 (dia anterior em UTC) |

## 9. Fora do Bloco 4

Integração com Google/Outlook Agenda · reunião recorrente confidencial · resumo semanal de gestão por IA (o Maestro já faz o briefing do dono).

## 10. Critérios de aceite

1. Molde "Semanal de operação" toda quinta 08:00: rodando `ritmo_cron_reunioes()` à mão, a próxima quinta é criada com participantes, convites, anterior ligada e pauta com adiados e indicadores fora da faixa. Rodando de novo, não duplica.
2. Molde mensal "1ª segunda": a data calculada está certa, inclusive na virada do ano.
3. `ritmo_cron_lembretes()` com uma reunião amanhã avisa os participantes uma vez só. Ata atrasada avisa quem conduz, no máximo 3 vezes.
4. `ritmo_cron_kpis()` atualiza os KPIs das duas empresas sem ninguém logado. O mês passado de foto não muda.
5. "O meu dia" de quem tem encaminhamento atrasado cita a contagem, sem o título.
6. Os 3 jobs aparecem em `cron.job`.
7. `tsc --noEmit` OK; migration roda limpa.

## 11. Perguntas em aberto

1. **Com quanta antecedência a próxima reunião recorrente é criada (e os convites saem)?** Recomendação: **padrão 6 dias para semanal/quinzenal e 10 dias para mensal/trimestral**, editável por molde. Assim a semanal seguinte já existe logo depois da atual, e dá tempo de o pessoal sugerir pauta.
2. **Horário do lembrete de véspera:** recomendação **16:00**. Dá tempo de preparar o número antes do fim do expediente, e não se confunde com o "O meu dia" das 06:50.
3. **Itens de indicador na pauta automática:** entram **aceitos** (no topo, e quem conduz exclui se não quiser) ou como **sugestão** (quem conduz precisa aceitar)? Recomendação: **aceitos**. Indicador fora da faixa é exatamente o que a reunião precisa discutir, e é o mesmo comportamento do botão "Levar à pauta".
