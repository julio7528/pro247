# Regras de trabalho do projeto

- Para definir, criar ou alterar o produto ArqCalc, siga o processo geral em [`plans/FLUXO-PROJETO-SOFTWARE.md`](plans/FLUXO-PROJETO-SOFTWARE.md). O tipo de produto e a tecnologia não estão pré-definidos.
- Execute uma etapa por vez. Apresente seu entregável e aguarde orientação do usuário antes de avançar para a próxima etapa.
- Na etapa de requisitos, trabalhe interativamente com o usuário: esclareça objetivo, usuários, escopo, comportamentos, dados, integrações e critérios; registre decisões e não invente requisitos nem escolhas de arquitetura.
- Registre uma spec para o incremento de produto atual, conforme a fronteira definida pelo usuário. Complete o ciclo de requisitos, planejamento, desenho, desenvolvimento, QA, revisão e entrega desse incremento antes de abrir o próximo; não exija que o usuário defina o produto inteiro de antemão.
- Não crie specs para as etapas operacionais do workflow nem divida ou agrupe um incremento sem confirmação. Para cada incremento, guarde plano, tarefas, avaliação/contratos, desenho e evidências em artefatos que referenciem sua spec de origem.
- Antes de executar ou retomar qualquer etapa, confira [`specs/workflow.yaml`](specs/workflow.yaml) e identifique o incremento ativo e sua spec aprovada; para iniciar um novo ciclo de requisitos, siga [`specs/INIT.md`](specs/INIT.md).
- Especificações de produto em `specs/` registram requisitos confirmados; planos, tarefas, contratos, designs e evidências de teste permanecem em seus diretórios e referenciam a especificação de origem.
- Mantenha requisitos e decisões aprovados como referência para planejamento, design, implementação, testes e revisão.
- Antes de executar uma tarefa, consulte `contracts/` e os contratos aplicáveis a seu estágio e `TASK-NNN`; respeite entradas, saídas, invariantes, dependências e escopo aprovados. Se houver lacuna ou conflito, bloqueie apenas a tarefa dependente e peça esclarecimento ao responsável adequado.
- A avaliação de escopo em um contrato não isola o sistema de arquivos. Não trate `allowed_scope.paths` como sandbox nem como autorização para ampliar permissões do executor.
- Validação de JSON/YAML confirma apenas estrutura e regras declaradas; não declare requisitos funcionais atendidos sem evidência funcional ou QA separado.
- Corrija e reteste problemas encontrados pelo QA ou Tech Lead antes de solicitar aprovação final.
- Não publique em produção antes da aprovação explícita do Product Owner. Após a publicação, verifique e relate o resultado.
- Mantenha `README.md` na raiz como guia de entrada do repositório e `src/README.md` como guia de execução da aplicação. Documente comandos de instalação e execução somente depois que a tecnologia e os scripts correspondentes estiverem definidos e verificados.

## Operação do orquestrador

- Inicialize o primeiro workflow a partir de `specs/INIT.md` e preserve o estado inicial declarado: Etapa 1 `NOT_STARTED`, etapas seguintes `PENDING`, sem especificações aprovadas e sem gates concedidos.
- Trate `specs/workflow.yaml` como definição declarativa. Estado de execução, respostas, eventos, artefatos e aprovações pertencem ao SQLite local configurado em `orchestrator/config.json`; não resete estado persistido ao recarregar a definição.
- Execute um incremento ativo por vez. O estado de cada etapa operacional é separado por incremento; só abra o próximo depois da entrega do ciclo atual e por comando explícito do usuário. Não exija a lista de incrementos futuros.
- Nunca trate um campo `APPROVED` editado no YAML ou Markdown como aprovação. Toda aprovação deve vir de ação explícita do usuário, referenciar versão e hash do artefato e ser registrada no SQLite e em `docs/decision-log.md`.
- Aprovar uma especificação, concluir uma etapa e autorizar a próxima são decisões separadas. Não avance automaticamente e não inicie a etapa seguinte sem comando explícito do usuário.
- Use os perfis em `.codex/agents/` e as Skills em `.agents/skills/` como fontes de verdade; não replique suas instruções no código do orquestrador.
- Mantenha execução real do Codex desabilitada e dry-run como padrão. Só inicie processo após configuração habilitada, etapa pronta e autorização explícita para aquela execução. Não execute deploy nem execução concorrente automaticamente.
- Se o estado declarado, o bootstrap, as dependências ou as aprovações estiverem inconsistentes, bloqueie a etapa e informe a evidência ausente; nunca tente corrigir a inconsistência por inferência.
- A Etapa 2 registra a avaliação do Tech Lead sobre contratos por especificação e tarefa, inclusive a justificativa explícita de que nenhum contrato de produto adicional é necessário. Contratos de produto derivam somente de especificação aprovada e tarefas/decisões técnicas confirmadas.
- Contratos de produto exigem aprovação explícita, vinculada a ID, versão e hash, antes de liberar as tarefas que os referenciam. Essa aprovação é independente da aprovação da especificação, do gate de etapa, da transição e da autorização de deploy.
- Contratos alterados ou cuja especificação de origem mudou precisam ser revalidados e, quando aplicável, aprovados novamente. Estados `APPROVED` em YAML não concedem aprovação.
- Se o desenho da solução revelar uma obrigação de interface, dados ou integração ausente, registre a descoberta para o Tech Lead. Uma revisão confirmada pode atualizar a avaliação e gerar uma nova versão do contrato; isso invalida o gate de Planning, que precisa ser revisado e aprovado novamente, assim como o novo contrato, antes que tarefas dependentes avancem.
- Mantenha planos, tarefas e avaliações de contrato segregados por `SPEC-NNN`; os IDs `TASK-NNN` continuam globalmente únicos no projeto. A avaliação de contrato deve considerar a spec ativa e suas tarefas, sem substituir avaliações de incrementos já aceitos.

## Registro obrigatório do projeto

Antes de iniciar uma tarefa, consulte os registros atuais em `docs/`. Em toda tarefa que alterar arquivos, código, configuração ou artefatos do projeto, atualize os registros pertinentes no mesmo conjunto de mudanças:

- `docs/project-context.md`: mantenha um memorando por feature, registrando o objetivo, o que foi criado, como foi feito, arquivos e locais afetados, validações e pendências. Para mudanças que não pertencem a uma feature, atualize o memorando de fundação/manutenção.
- `docs/project-roadmap.md`: atualize o status da etapa afetada, o que foi concluído e o próximo trabalho previsto. Não marque como concluído algo sem evidência.
- `docs/decision-log.md`: acrescente um registro sequencial `DEC-00X` para cada evento de trabalho ou decisão relevante, incluindo contexto, resultado e impactos. Nunca reutilize um identificador.

Faça os registros junto com a alteração correspondente, antes de encerrar a tarefa. Se uma validação não foi executada ou um dado ainda é desconhecido, registre isso claramente em vez de presumir um resultado.
