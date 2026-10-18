# Bootstrap das especificações

Este documento inicia ou retoma o ciclo do incremento ativo do ArqCalc. O tipo de produto, o escopo e a tecnologia não estão pré-definidos. Trabalhe uma fatia de produto por vez; não peça a definição do produto inteiro. O bootstrap não contém requisitos aprovados e não autoriza automaticamente uma etapa seguinte.

## Estado inicial

- **Etapa atual:** 1 — Levantamento de requisitos.
- **Estado da etapa:** `NOT_STARTED`.
- **Especificações de produto aprovadas:** nenhuma.
- **Gates de aprovação:** nenhum concedido.
- **Próximas etapas:** `PENDING` até a conclusão da etapa anterior e autorização humana explícita.

O arquivo `SPEC-001.md` é um placeholder vazio preservado. Não o trate como briefing, requisito ou aprovação.

## Preparação da sessão

Antes de conversar sobre requisitos, leia nesta ordem ou confirme que estão atualizados:

1. `AGENTS.md` e `docs/` para as regras e o estado registrado do projeto e dos incrementos já aceitos.
2. `specs/README.md`, este arquivo e `specs/workflow.yaml`.
3. `plans/FLUXO-PROJETO-SOFTWARE.md` para o processo e os gates das sete etapas.
4. `.agents/skills/requirements-discovery/SKILL.md`.
5. Os perfis `.codex/agents/product-owner.toml` e `.codex/agents/analista-requisitos.toml`, quando a execução de agentes estiver disponível.

Confira o estado real e os artefatos existentes antes de retomar. Preserve conteúdo, decisões e aprovações anteriores. Se as ferramentas não puderem invocar os agentes ou a Skill, siga suas instruções diretamente e registre essa limitação quando pertinente.

## Execução da etapa 1

- Trabalhe somente nos requisitos do incremento atual. Converse com o usuário para entender problema, objetivo, usuários, escopo, comportamentos, dados, integrações, restrições e critérios de sucesso dessa fatia.
- Pergunte, sem exigir uma decisão, se o usuário já imagina uma forma de produto, como aplicação web, serviço/API, automação ou sistema com agentes/RAG. Registre tecnologia apenas como preferência/restrição confirmada; a análise de arquitetura e stack ocorre no Planejamento.
- Pergunte qual incremento o usuário quer construir agora e se ele depende de incrementos já aceitos. Não pergunte pela lista completa de incrementos futuros; cada próximo incremento será definido somente depois que o atual concluir seu ciclo.
- Separe fatos confirmados, decisões, sugestões e perguntas em aberto. Não converta silêncio, suposições ou recomendações de agentes em requisitos.
- Considere segurança, privacidade, desempenho, disponibilidade, acessibilidade, uso de agentes ou RAG somente quando forem pertinentes ao escopo confirmado.
- Só crie ou atualize um arquivo em `specs/generated/` quando houver informação confirmada suficiente para definir o objetivo, o escopo identificável e ao menos um requisito verificável do incremento atual. Caso contrário, continue a conversa sem gerar uma especificação incompleta.
- Atribua o próximo identificador `SPEC-NNN` livre, pesquisando a árvore inteira de `specs/`; `SPEC-001.md` já está reservado pelo placeholder existente. Use o [modelo](templates/SPEC-TEMPLATE.md).
- Crie uma `SPEC-NNN` para a fatia atual, mesmo que dependa de um incremento anterior. Registre somente dependências confirmadas e não divida nem agrupe escopos sem esclarecer a fronteira com o usuário.
- Para começar o primeiro incremento, use `python -m orchestrator discover --name "Nome do incremento atual"`. Para abrir o próximo, use `python -m orchestrator discover --new-increment --name "Nome do próximo incremento"` somente depois da entrega do ciclo anterior e do retorno autorizado a Requirements Discovery. As respostas novas são associadas somente à sessão corrente.
- Apresente e aprove a spec do incremento atual por ID, versão e hash. Depois, obtenha autorização explícita própria para iniciar o Planejamento; não exija que o usuário enumere ou aprove incrementos futuros.
- Não crie specs para as sete etapas operacionais (requisitos, planejamento, desenho, desenvolvimento, QA, revisão e entrega); essas etapas geram os artefatos descritos em `workflow.yaml`.

## Aprovação e autorização para avançar

Só registre uma especificação como `APPROVED` quando o usuário aprovar explicitamente a versão identificada. Registre a decisão no artefato e acrescente um novo `DEC-NNN` em `docs/decision-log.md`, incluindo especificação, versão, data/hora com fuso, evidência da resposta e alcance da autorização.

Aprovar o conteúdo e autorizar o início da etapa seguinte são decisões humanas; a resposta pode conter ambas, desde que isso esteja explícito. Atualize o gate em `workflow.yaml` com uma referência verificável ao registro, não apenas alterando um status. Se a pessoa aprovar o documento sem autorizar o avanço, mantenha a etapa seguinte bloqueada e aguarde orientação. Nunca fabrique identidade, data, aprovação ou evidência.

Após a validação e autorização, atualize os registros obrigatórios de `docs/` e o estado do ciclo. Apresente a spec e pare. Não inicie Planejamento, desenho, implementação, QA, revisão ou entrega sem orientação explícita.

## Rastreabilidade das etapas seguintes

Planos e tarefas devem apontar para a spec aprovada do incremento atual e ficar segregados por `SPEC-NNN`. Desenhos de arquitetura/solução, interfaces, contratos, código, relatórios de QA, pareceres e registros de entrega também devem carregar ou referenciar o ID e a versão de origem. Mantenha cada artefato em seu local próprio, conforme `specs/README.md` e `workflow.yaml`.
