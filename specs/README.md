# Especificações de produto

Esta pasta guarda a fonte de verdade dos requisitos e do comportamento esperado do produto. A arquitetura é progressiva: os requisitos são descobertos em conversa, registrados conforme forem confirmados e revisados sem exigir que todo o produto esteja definido antes do início. A forma do produto, a tecnologia e o uso de agentes/RAG podem permanecer em aberto até que o usuário decida ou o Planejamento compare alternativas.

## Ponto de entrada

- Comece por [INIT.md](INIT.md) para carregar o contexto e conduzir a etapa 1.
- Consulte [workflow.yaml](workflow.yaml) para descobrir a etapa atual, responsáveis, entregáveis, dependências e gates.
- Use o processo geral de [FLUXO-PROJETO-SOFTWARE.md](../plans/FLUXO-PROJETO-SOFTWARE.md) junto com as regras de [AGENTS.md](../AGENTS.md).
- Crie especificações com o formato de [SPEC-TEMPLATE.md](templates/SPEC-TEMPLATE.md).

## Identificadores

- Cada especificação de produto recebe um identificador global e estável no formato `SPEC-NNN`, atribuído em ordem crescente.
- Antes de atribuir um ID, procure em toda a pasta `specs/`, inclusive em `generated/`, e nunca reutilize um ID encontrado em nome de arquivo ou conteúdo.
- O arquivo existente `SPEC-001.md` é vazio e deve ser preservado. Seu ID fica reservado; o próximo ID livre é `SPEC-002`.
- O nome de arquivo gerado segue `SPEC-NNN-slug.md`. Renomear o título não muda o ID.
- Requisitos funcionais, requisitos não funcionais e critérios de aceitação usam, respectivamente, `RF-NNN`, `RNF-NNN` e `CA-NNN`, únicos dentro da especificação.
- Decisões relacionadas apontam para o identificador sequencial `DEC-NNN` em `docs/decision-log.md`.

Uma especificação nova só é criada quando as confirmações do usuário já permitem registrar um objetivo, um escopo identificável e ao menos um requisito verificável. Se ainda não houver base suficiente, continue a conversa e mantenha as incertezas como perguntas; não preencha um documento com suposições.

## Granularidade incremental

- Uma fatia vertical por vez: o usuário define um incremento, aprova sua spec, conclui o planejamento, desenho aplicável, implementação, QA, revisão e entrega; só depois inicia a próxima fatia.
- Crie uma `SPEC-NNN` para cada incremento de produto. As sete etapas operacionais do ciclo não geram specs próprias.
- Registre objetivo, escopo, comportamentos, critérios e dependências confirmadas. Incrementos podem depender de anteriores; não exija independência funcional nem antecipe incrementos futuros.
- Não reúna incrementos definidos em uma única spec nem divida um escopo ambíguo por conta própria. Pergunte onde fica a fronteira da fatia atual e quais dependências já são conhecidas.
- Cada spec tem revisão e aprovação próprias, vinculadas ao ID, versão e hash. O Planning começa depois da aprovação da spec corrente e da autorização explícita do usuário; não se exige confirmação de que a lista futura está completa.
- O orquestrador mantém um incremento ativo. Para iniciar o primeiro, use `python -m orchestrator discover --name "Nome do incremento"`. Para iniciar outro, depois que o ciclo atual for concluído e o workflow retornar a Requirements Discovery, use `python -m orchestrator discover --new-increment --name "Nome do próximo incremento"`.
- Planos, tarefas, avaliações de contratos e entregáveis de cada ciclo ficam segregados por `SPEC-NNN`; os IDs `TASK-NNN` permanecem globalmente únicos. Respostas e estados das etapas são registrados separadamente por incremento.

## Versionamento e ciclo de vida

Cada documento mantém uma versão `MAJOR.MINOR.PATCH` e um dos estados a seguir:

| Estado | Uso |
| --- | --- |
| `DRAFT` | Conteúdo em elaboração; ainda não foi apresentado como versão final para aprovação. |
| `IN_REVIEW` | Versão identificada apresentada ao usuário para decisão. |
| `APPROVED` | Versão exata aprovada explicitamente pelo usuário, com evidência registrada. |

Aumente PATCH para correções editoriais sem alterar significado, MINOR para requisitos compatíveis adicionados e MAJOR para mudanças incompatíveis de escopo ou comportamento. Uma alteração em especificação aprovada cria uma nova versão em `DRAFT`; mantenha o histórico e solicite nova aprovação antes de usá-la como base de avanço.

A aprovação não é inferida de silêncio, de uma resposta ambígua, de uma decisão do agente PO ou de uma mudança isolada de estado. Para passar de `IN_REVIEW` a `APPROVED`, registre no próprio documento o ID e a versão aprovados, a decisão explícita do usuário, data/hora com fuso, referência ou evidência fiel da resposta e o `DEC-NNN` correspondente. O registro de decisão deve apontar para a mesma especificação e versão. O gate no workflow também precisa apontar para essa evidência. Um status sem esses registros não libera etapa alguma.

Os estados das etapas também têm transições controladas dentro do incremento ativo: a etapa atual começa quando o usuário pede seu início; uma etapa `PENDING` só começa após dependências concluídas e autorização explícita; um entregável apresentado aguarda orientação; e a etapa só é concluída depois que a evidência exigida pelo gate foi registrada. Mudanças solicitadas pelo usuário reabrem o trabalho na etapa atual. A conclusão de uma etapa nunca inicia a próxima automaticamente.

## Organização

| Local | Conteúdo |
| --- | --- |
| `INIT.md` | Procedimento de bootstrap para iniciar ou retomar o levantamento. |
| `workflow.yaml` | Estado, sequência, agentes, Skills, entregáveis, dependências e gates. |
| `templates/` | Modelos de especificações de produto. |
| `generated/` | Uma especificação para cada incremento de produto definido pelo usuário. |
| `SPEC-001.md` | Arquivo legado vazio, preservado sem uso ou sobrescrita. |

`workflow.yaml` é uma configuração declarativa independente de executor. O orquestrador local mantém estado operacional e aprovações no SQLite, com execução real do Codex desabilitada e dry-run como padrão. As aprovações e transições continuam exigindo evidência humana explícita.

## Especificações e artefatos de etapa

Uma especificação descreve o que o produto deve fazer: objetivos, escopo, requisitos, restrições e critérios de aceitação. Ela não substitui os artefatos necessários para executar cada etapa.

- Planejamento cria planos e tarefas em `plans/` e `tasks/`.
- O desenho da solução registra arquitetura e artefatos pertinentes ao produto; UX/UI e Figma entram somente quando houver interface que os justifique.
- Desenvolvimento cria ou altera arquivos de produto em `src/`.
- QA guarda evidências e relatórios em `tests/`.
- Contratos de interface e integração ficam em `contracts/`.
- Revisões, aprovações e registros de andamento ficam nos documentos pertinentes de `docs/`.

Todo artefato derivado deve apontar para o ID e a versão da especificação de origem, usando metadados, cabeçalho, tarefa relacionada ou referência rastreável equivalente. Alterações de código apontam essa origem na tarefa ou no registro da alteração; não é necessário inserir comentários artificiais no código. A especificação que inaugura um requisito é sua própria origem.

`contracts/` separa contratos operacionais reutilizáveis de contratos de produto ligados à especificação aprovada. O Tech Lead avalia sua necessidade durante Planning; nenhum contrato de produto é exigido antes dessa avaliação. Consulte [`contracts/README.md`](../contracts/README.md) para ciclo de vida, schemas e comandos.

Crie uma especificação para cada incremento que o usuário definir, mesmo quando dependa de incremento anterior. A entrada em outra etapa operacional do fluxo, por si só, não justifica outro arquivo. Artefatos de Planning, tarefas e contratos devem indicar a spec incremental de origem; quando um artefato atender a mais de um incremento, liste todas as referências pertinentes.

## Referências

- [Regras do projeto](../AGENTS.md)
- [Fluxo de trabalho](../plans/FLUXO-PROJETO-SOFTWARE.md)
- [Skill de levantamento de requisitos](../.agents/skills/requirements-discovery/SKILL.md)
- [Contexto e memorandos](../docs/project-context.md)
- [Roadmap](../docs/project-roadmap.md)
- [Registro de decisões](../docs/decision-log.md)
