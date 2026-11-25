# Ritmo de Gestão — Bloco 1: Reuniões, atas e encaminhamentos

> Spec técnica · 25/11/2026 · status: **construído** (falta rodar a migration 0070 e testar)
>
> **Decisões do §13 (aprovadas):** (1) flag por pessoa `perfis.conduz_reunioes`, marcada em Usuários e acessos; o super já conduz. (2) Confidencial vale também para o super. (3) Projeto automático "Ritmo de Gestão".
>
> **Ajustes feitos na construção:**
> - As RPCs são `security definer` com checagem explícita (`pode_conduzir`/`pode_gerir_reuniao`), porque a ata fechada é imutável pelo RLS.
> - A tarefa nasce **ao fechar a ata**, não ao salvar o encaminhamento. Assim a ata ainda pode ser editada sem deixar tarefas órfãs.
> - O **dono de um encaminhamento** também vê a reunião de onde ele saiu, mesmo sem ter participado (responde por ele).
> - Os agentes não precisaram de filtro: o "O meu dia" só conta as tarefas da própria pessoa, e o chat e o Maestro leem pelo RLS ou não listam tarefas.
> - `tarefas.reuniao_restrita_id` usa `on delete restrict`, para que apagar a reunião não destranque as tarefas confidenciais.
> Blocos seguintes: 2 KPIs/metas + painel · 3 persona "Gestão" no Assistente · 4 ritmo automático

## 1. Objetivo

Fechar o ciclo **reunião → decisão → encaminhamento → tarefa → cobrança na próxima reunião**, por empresa, dentro do ERP.

Uma reunião só "fecha" quando todo encaminhamento tem **dono, prazo e evidência** e virou tarefa. A reunião seguinte do mesmo tipo abre com as **pendências da anterior** no topo da pauta.

## 2. Decisões que esta spec respeita

| # | Decisão | Onde aparece |
|---|---|---|
| 1 | Só gerência administra; todos participam | RLS §4, telas §6 |
| 2 | Tudo separado por empresa | `empresa_consultora_id` em todas as tabelas |
| 3 | Reuniões confidenciais existem | §5 |
| 4 | Equipes de 5–10 → começa com semanal + mensal | `tipo` §3 |
| 5 | Encaminhamento vira tarefa com subtarefas, **um único dono** | §7 |

## 3. Modelo de dados — migration `0070_ritmo_reunioes.sql`

> Numeração: última é 0069 (0067/0068 já colidem — não repetir).

### `reunioes`
| coluna | tipo | nota |
|---|---|---|
| id | uuid pk | |
| empresa_consultora_id | uuid | default `auth_empresa_id()` |
| titulo | text not null | ex.: "Semanal de operação" |
| tipo | text | `semanal` · `mensal` · `trimestral` · `diaria` · `extraordinaria` |
| data_hora | timestamptz not null | |
| duracao_min | int | default por tipo (60/120/240/15) |
| local | text | sala, obra, online |
| confidencial | bool default false | §5 |
| status | text | `agendada` → `em_andamento` → `realizada` · `cancelada` |
| conduzida_por | uuid → perfis | quem conduz (gerência) |
| anterior_id | uuid → reunioes | reunião anterior da mesma série (pendências) |
| ata_fechada_em / ata_fechada_por | timestamptz / uuid | preenchidos por `ritmo_fechar_ata` |
| observacoes | text | |
| criado_por / criado_em | | padrão |

### `reuniao_participantes`
`reuniao_id, perfil_id` (pk) · `presenca` (`convidado`·`presente`·`ausente`) · `ciencia_em` timestamptz · `empresa_consultora_id`.

### `reuniao_pauta`
`id, reuniao_id, titulo, descricao, ordem`
- `origem`: `manual` · `sugestao` (veio de um participante) · `pendencia` (veio da anterior)
- `status`: `proposto` · `aceito` · `recusado` · `discutido` · `adiado` (adiado = "ponto em aberto", volta na próxima)
- `sugerido_por` uuid · `motivo_recusa` text

### `reuniao_decisoes`
`id, reuniao_id, pauta_id (opcional), texto, ordem`.

### `reuniao_encaminhamentos`
| coluna | nota |
|---|---|
| id, reuniao_id, empresa_consultora_id | |
| decisao_id / pauta_id | opcionais (de onde nasceu) |
| o_que | text not null |
| dono_id | uuid **not null** → perfis |
| prazo | date **not null** |
| evidencia | text **not null** — "como saberemos que está feito" |
| tarefa_id | uuid → tarefas (preenchido ao gerar a tarefa) |
| cancelado | bool + `motivo_cancelamento` |

Status **não é coluna** — vem da tarefa, na view abaixo (fonte única de verdade).

### `reuniao_revisoes` (a cobrança)
`encaminhamento_id, reuniao_id` (pk) · `situacao` (`feito`·`nao_feito`·`replanejado`·`cancelado`) · `motivo` · `novo_prazo`.
Registra o que a reunião N disse sobre um encaminhamento da reunião N-1.

### View `vw_encaminhamentos`
Junta encaminhamento + tarefa e calcula `status`:
`feito_no_prazo` · `feito_atrasado` · `aberto` · `atrasado` · `cancelado`, mais `n_sub`/`n_sub_ok` da tarefa.
Alimenta a tela e o futuro KPI "Encaminhamentos cumpridos" (Bloco 2). `security_invoker = true` para herdar o RLS.

### Ajustes em tabelas existentes
- `tarefas.vinculo_tipo`: incluir `'reuniao'` no check.
- `tarefas.reuniao_restrita_id uuid` → reunioes (só para encaminhamentos confidenciais, §5). Subtarefa herda da mãe por gatilho (mesmo padrão do `projeto_id` na 0041).
- `notificacoes.tipo`: incluir `'reuniao'` no check (recriar a constraint a partir da versão da 0064).

## 4. Acesso (RLS)

"Gerência" = `is_gerente()` (papéis `super` e `admin`).

| Ação | Quem |
|---|---|
| Ver reunião **normal** | gerência · participantes |
| Ver reunião **confidencial** | **só participantes** e quem criou (nem a gerência vê se não estiver na lista) |
| Criar / editar reunião, pauta, decisões, encaminhamentos, fechar ata | gerência que **pode ver** a reunião |
| Sugerir item de pauta | qualquer participante, em reunião `agendada` (entra como `origem=sugestao, status=proposto`) |
| Dar ciência | o próprio participante, após a ata fechada (só via RPC) |
| Excluir reunião | gerência, só se `agendada` ou `cancelada` (ata fechada não se apaga) |

Função auxiliar `pode_ver_reuniao(id)` security definer (padrão `pode_ver_projeto`), usada nas policies das tabelas-filhas.

Ata fechada fica **imutável**. A RPC `ritmo_reabrir_ata(id, motivo)` (gerência) reabre e registra quem, quando e por quê.

App: rota `/gestao` livre no menu (todos veem as próprias reuniões); botões de administração aparecem só para `acesso.gerencia`. Não entra no `_aplicar_acesso` por módulo, porque o acesso é por participação e não por setor. Se quiser travar por módulo depois, cria-se o módulo `gestao`.

## 5. Reuniões confidenciais

- Visíveis só para participantes e quem criou (§4). Marca "CONFIDENCIAL" na lista, na tela e na impressão.
- Encaminhamentos geram tarefa com `reuniao_restrita_id` preenchido. A policy `tarefas_ler` (versão atual = 0049, com acompanhantes) passa a ter:
  `se reuniao_restrita_id não é nulo → só responsável, criador, acompanhantes ou participante daquela reunião` — **inclusive para a gerência**.
- Tarefa restrita nasce **sem projeto** (não entra em quadro público).
- **Agentes (service role) ignoram RLS**: Maestro, Sentinela, "O meu dia" e o resumo do CFO precisam filtrar `reuniao_restrita_id is null`, exceto no "O meu dia" do próprio responsável. Item obrigatório da implementação.
- Encaminhamentos confidenciais ficam **fora** do KPI público de encaminhamentos (Bloco 2).

## 6. Telas

| Rota | Conteúdo |
|---|---|
| `/gestao` | Hub: próximas reuniões (minhas), **meus encaminhamentos** abertos/atrasados, atas aguardando minha ciência. Gerência vê ainda "nova reunião" e as sugestões de pauta pendentes. |
| `/gestao/reunioes` | Lista com filtro por tipo, status e confidencial; histórico por série. |
| `/gestao/reunioes/[id]` | Uma tela em 3 abas que seguem a vida da reunião: **Pauta** (antes) → **Condução/Ata** (durante) → **Acompanhamento** (depois: ciências, status dos encaminhamentos). |
| `/gestao/reunioes/[id]/imprimir` | Ata impressa: cabeçalho da empresa, presentes/ausentes, pendências revisadas, decisões, encaminhamentos (o quê/dono/prazo/evidência), pontos em aberto, linhas de assinatura dos presentes. |

Condução (aba Ata) segue a pauta fixa da skill de gestão:
1. **Pendências da anterior** (automático): para cada encaminhamento da `anterior_id` ainda sem revisão, marcar feito / não feito + motivo / replanejar.
2. Itens de pauta aceitos → marcar discutido / adiado.
3. **Decisões**.
4. **Encaminhamentos**: formulário com os 3 campos obrigatórios; "dono" com busca de pessoas (nome + e-mail para homônimos).

Sidebar: item **"Ritmo de Gestão"**. Celular: listas com `.linha-lista`, como o resto do app.

## 7. Encaminhamento → tarefa com subtarefas

- Ao salvar um encaminhamento, a RPC `ritmo_gerar_tarefa(encaminhamento_id)` cria a **tarefa-mãe**: título = `o_que`, responsável = dono, prazo, descrição com a evidência e o link da ata, `vinculo_tipo='reuniao'`, `vinculo_rotulo="Semanal 02/12 · T4"`. Quem conduz entra como **acompanhante** (0049).
- Projeto: tarefas normais vão para um projeto público automático **"Ritmo de Gestão"** por empresa (criado na primeira vez), com seções por tipo de reunião. As confidenciais ficam sem projeto (§5).
- **Subtarefas** são criadas na própria tarefa (já existe `parent_id`), cada uma com o seu responsável. Elas também podem ser lançadas direto na ata: o formulário de encaminhamento aceita uma lista "partes" (o quê + responsável + prazo) que vira subtarefa.
- Regra: o encaminhamento é cobrado do **dono**, nunca dos donos das subtarefas. A ata mostra `2/3` ao lado.
- "Feito" = tarefa-mãe concluída. Prazo alterado na tarefa reflete na view; replanejamento formal fica em `reuniao_revisoes`.

## 8. RPCs (todas `security invoker`, revalidam permissão)

| RPC | Faz |
|---|---|
| `ritmo_abrir_reuniao(dados, anterior_id)` | cria reunião + participantes; copia para a pauta os itens `adiado` da anterior (`origem=pendencia`) |
| `ritmo_gerar_tarefa(enc_id)` | §7, idempotente (se `tarefa_id` existe, não duplica) |
| `ritmo_fechar_ata(id)` | valida: todo encaminhamento com dono/prazo/evidência, toda pendência da anterior revisada, presença marcada → gera tarefas que faltam → `status=realizada` → notifica presentes pedindo ciência |
| `ritmo_reabrir_ata(id, motivo)` | gerência; registra motivo |
| `ritmo_dar_ciencia(id)` | participante marca `ciencia_em` |
| `ritmo_sugerir_pauta(id, titulo, descricao)` | participante; notifica quem conduz |

## 9. Notificações (tipo `'reuniao'`, com push via 0050)

- Convite ao ser incluído numa reunião (data/hora/local).
- Lembrete 1 dia antes: **Bloco 4** (depende do cron).
- Ata fechada → "confirme a ciência", para os presentes.
- Sugestão de pauta → para quem conduz.
- Atribuição de encaminhamento já chega pela notificação de tarefa atribuída (0042), sem duplicar.
- Conferir `/api/push/enviar`: tipo `'reuniao'` deve levar o próprio texto (como foi feito para `'agente'`).

## 10. Fora do Bloco 1

KPIs/metas/painel (Bloco 2) · chat/persona Gestão (Bloco 3) · reuniões recorrentes, lembretes e pauta que se monta com KPIs fora da faixa (Bloco 4) · gravação/transcrição de áudio.

## 11. Critérios de aceite

1. Gerência cria a semanal da T4 com 6 participantes; um não-participante (não gerência) **não a vê**.
2. Participante sugere item de pauta; quem conduz aceita/recusa; quem sugeriu é notificado.
3. Ata não fecha com encaminhamento sem evidência (mensagem clara).
4. Ao fechar: tarefas criadas no projeto "Ritmo de Gestão", com dono, prazo e subtarefas; presentes notificados; ata imprimível.
5. Na semanal seguinte (`anterior_id`), as pendências aparecem no topo, e marcar "não feito" exige motivo.
6. Reunião confidencial: um admin que não participa não vê a reunião **nem as tarefas dela**; o "O meu dia" de terceiros não cita essas tarefas.
7. MSFORT não vê nada da T4 (e vice-versa).
8. `tsc --noEmit` OK; migration roda limpa no SQL Editor; RLS testado com 3 logins (gerência participante, gerência não participante, colaborador).

## 12. Antes de construir (medição só-leitura)

- Quantos perfis ativos por papel em cada empresa. Em 03/11, 10 de 12 eram `admin`; se ainda for assim, "só gerência administra" quase não restringe (ver pergunta 1).
- Confirmar a versão vigente das policies de `tarefas` e da constraint de `notificacoes.tipo` para recriar sem perder nada.

## 13. Perguntas em aberto

1. **Quem é "gerência" aqui?** Com quase todos como `admin`, todos administrariam reuniões. Opções: (a) aceitar; (b) revisar papéis na /equipe; (c) criar permissão específica "conduz reuniões". Recomendação: **(c)**, um flag por pessoa, simples e sem mexer nos papéis.
2. **Confidencial e o super**: o super (Fernando) também fica de fora quando não é participante? Recomendação: **sim**, porque confidencial significa confidencial; quem cria decide a lista.
3. **Projeto automático "Ritmo de Gestão"** para os encaminhamentos, ou cada tarefa vai como pessoal (sem projeto)? Recomendação: **projeto automático**, que dá quadro e lista de graça.
