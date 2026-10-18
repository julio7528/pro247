# Registro de eventos e decisões

Registre eventos de trabalho e decisões relevantes em ordem sequencial usando identificadores `DEC-00X`. Não reutilize IDs nem apague entradas anteriores; corrija por meio de uma nova entrada que referencie a anterior. Cada registro deve explicar o contexto e o efeito no projeto.

## Registros

### DEC-001 — Fluxo de landing page em sete etapas

- **Registrado em:** 2026-10-11
- **Evento/decisão:** Adotado um fluxo sequencial com levantamento de requisitos, planejamento, UX/UI, desenvolvimento, QA, revisão/aprovação e deploy.
- **Contexto:** O usuário definiu que deseja executar o trabalho por etapas, revisar entregáveis e orientar o avanço.
- **Efeito:** O fluxo foi documentado em `plans/FLUXO-LANDING-PAGE.md`; as regras gerais ficam em `AGENTS.md`.

### DEC-002 — Papéis especializados como perfis de agente

- **Registrado em:** 2026-10-11
- **Evento/decisão:** Definidos oito perfis: Product Owner, Analista de Requisitos, UX Designer, UI Designer, Desenvolvedor Frontend, QA Tester, Tech Lead e DevOps.
- **Contexto:** O usuário solicitou responsabilidades específicas para os agentes que participam das etapas.
- **Efeito:** Os perfis TOML estão em `.codex/agents/`; cada arquivo descreve o comportamento do respectivo papel.

### DEC-003 — Skills organizadas por etapa do fluxo

- **Registrado em:** 2026-10-11
- **Evento/decisão:** Adotada uma Skill por etapa, com os agentes participantes, as instruções de trabalho, os entregáveis e o ponto de espera pela orientação do usuário.
- **Contexto:** O usuário aprovou o plano de preencher sete Skills alinhadas ao fluxo.
- **Efeito:** As Skills estão em `.agents/skills/`; a validação do `skill-creator` passou para as sete.

### DEC-004 — Registros contínuos em `docs/`

- **Registrado em:** 2026-10-11
- **Evento/decisão:** Criados `project-context.md`, `project-roadmap.md` e `decision-log.md`; sua atualização passa a ser obrigatória em toda tarefa que alterar o projeto.
- **Contexto:** O usuário pediu memorandos por feature, um roadmap vivo por etapa e registros sequenciais `DEC-00X` para acompanhar o trabalho e as decisões.
- **Efeito:** `AGENTS.md` agora exige consultar e atualizar esses registros antes de encerrar cada tarefa. A fundação atual foi documentada; o levantamento de requisitos da landing page permanece não iniciado.

### DEC-005 — Arquitetura progressiva de especificações

- **Registrado em:** 2026-10-11
- **Evento/decisão:** Inicializada a arquitetura de especificações de produto com descoberta incremental, rastreabilidade, ciclo de vida controlado e gates de aprovação humana.
- **Contexto:** O usuário solicitou que a descoberta comece sem requisitos previamente definidos, preserve artefatos por etapa em seus diretórios e registre aprovações antes de avançar.
- **Efeito:** Criados os artefatos em `specs/`; `AGENTS.md` e a Skill de levantamento apontam para o bootstrap. A Etapa 1 permanece `NOT_STARTED`, as demais `PENDING`, não há requisitos aprovados e nenhum gate está concedido. `specs/SPEC-001.md` permaneceu vazio e preservado.

### DEC-006 — MVP do orquestrador progressivo

- **Registrado em:** 2026-10-11
- **Evento/decisão:** Implementado um MVP local para avaliar e conduzir o workflow com especificações progressivas, estado persistente e aprovações humanas verificáveis.
- **Contexto:** A solicitação anexada pediu um ciclo determinístico de inspeção, avaliação, esclarecimento, execução controlada e validação, mantendo as etapas e os papéis já existentes como fonte de verdade.
- **Efeito:** Criados o pacote `orchestrator/`, a CLI, schema de workflow, configuração em dry-run, armazenamento SQLite e 20 testes. O bootstrap e os estados iniciais da landing page foram preservados; nenhuma especificação foi criada nem aprovada. A execução real do Codex permanece desabilitada; qualquer futuro deploy exige autorização explícita de escopo e versão.

### DEC-007 — Evidência obrigatória para requisito funcional verificável

- **Registrado em:** 2026-10-11
- **Evento/decisão:** Requisitos funcionais só contam como confirmados quando a linha contém uma descrição e uma evidência confirmada; referências ainda em formato de placeholder mantêm o requisito pendente.
- **Contexto:** A validação do MVP identificou que uma descrição de requisito sem origem registrada poderia ser tratada como suficiente para aprovar a especificação.
- **Efeito:** O resolvedor exige evidência não-placeholder para considerar o campo funcional completo; a coleta reutiliza somente requisitos com evidência. A suíte passou com 21 testes e `SPEC-001.md` continua vazio.

### DEC-008 — Contratos rastreáveis integrados ao orquestrador

- **Registrado em:** 2026-10-11
- **Evento/decisão:** Implementada uma camada de contratos operacionais e de produto com schemas, avaliação de Planning, geração por tarefa, revisão/aprovação humana vinculada a ID/versão/hash e validação integrada ao runtime.
- **Contexto:** A solicitação anexada definiu contratos reutilizáveis e verificáveis para entradas/saídas, escopo, dependências, resultados e handoffs, mantendo especificações, gates, autorizações e execução controlada existentes como fontes distintas.
- **Efeito:** Adicionados `contracts/` e `orchestrator/contracts/`; integrados `WorkflowEngine`, `StageController`, `DependencyValidator`, `QualityGate`, `ApprovalManager`, `StateManager`, `CodexExecutor` e a CLI. Planning exige a avaliação do Tech Lead mesmo quando não há contrato de produto. Revisões confirmadas em UX/UI podem criar versão nova e invalidam o gate de Planning até nova aprovação. As migrações SQLite são aditivas e preservam os registros existentes. `python -m compileall -q orchestrator tests` passou e `python -m unittest discover -s tests -v` passou com 43 testes. O estado do workflow, especificações e aprovações do projeto não foram resetados; nenhum processo Codex real nem deploy foi executado. Execução paralela, isolamento real de escopo e testes funcionais continuam fora do subsistema.

### DEC-009 — Guias de início do fluxo e da aplicação

- **Registrado em:** 2026-10-11
- **Evento/decisão:** Documentados os pontos de entrada para iniciar o fluxo de trabalho e para encontrar as futuras instruções de execução da aplicação.
- **Contexto:** O usuário pediu orientações claras para iniciar o trabalho do projeto e, separadamente, para iniciar a aplicação que será desenvolvida em `src/`.
- **Efeito:** `README.md` na raiz explica o fluxo no Codex e o uso básico do orquestrador; `src/README.md` reserva o guia de execução da aplicação. Comandos da aplicação permanecem pendentes da escolha e implementação da tecnologia no Planejamento. `AGENTS.md` orienta manter ambos atualizados.

### DEC-010 — Processo do ArqCalc generalizado para software de escopo aberto

- **Registrado em:** 2026-10-17 (America/Cuiaba)
- **Evento/decisão:** O usuário orientou preparar o ArqCalc para definir o tipo de produto e a arquitetura depois, sem restringi-lo a landing pages.
- **Contexto:** O repositório continha um fluxo de landing page, papéis de frontend e uma etapa de deploy de site, apesar de não haver requisitos de produto aprovados.
- **Efeito:** O fluxo, bootstrap, Skills, perfis e orquestrador agora acomodam aplicações, APIs/serviços, automações e IA/agentes/RAG quando requisitos aprovados os justificarem. A descoberta da forma do produto, preferências tecnológicas e IA é opcional; frameworks permanecem não escolhidos. A entrega local/handoff não exige autorização de produção; tarefas de produção são vinculadas a alvo, escopo, versão e autorização explícita. A etapa 1 permanece `NOT_STARTED`, as seguintes `PENDING`, não há especificação aprovada e nenhum gate foi concedido. A validação automatizada não foi executada nesta alteração.

### DEC-011 — Perfil especializado para desenvolvimento agêntico

- **Registrado em:** 2026-10-17 (America/Cuiaba)
- **Evento/decisão:** Criado um perfil próprio para desenvolvimento de produtos com comportamento agêntico.
- **Contexto:** O usuário identificou falta de um desenvolvedor agêntico e de backend. A inspeção confirmou que `backend-developer.toml` já existe e que `ai-engineer.toml` cobre IA/RAG de modo mais amplo, sem substituir responsabilidades de orquestração de agentes.
- **Efeito:** Adicionado `.codex/agents/agentic-developer.toml` com responsabilidades para ferramentas, estado, autonomia, permissões, falhas e avaliação; o perfil foi incluído nas etapas técnicas pertinentes e na Skill de implementação. O perfil backend existente foi mantido, sem duplicação.

### DEC-012 — Uma spec por incremento de produto definido pelo usuário

- **Registrado em:** 2026-10-17 (America/Cuiaba)
- **Evento/decisão:** Alterado o comportamento de especificação para representar separadamente cada incremento de produto definido pelo usuário.
- **Contexto:** O usuário relatou que o teste anterior produziu uma única spec e pediu uma spec para cada etapa incremental que ele definir. A configuração anterior proibia criar uma spec por etapa e o coletor reutilizava sempre o mesmo documento.
- **Efeito:** `specs/workflow.yaml` e os procedimentos relacionados agora distinguem incrementos de produto das etapas operacionais. A CLI abre sessões incrementais nomeadas, associa respostas novas somente à sessão corrente, cria uma `SPEC-NNN` por incremento, preserva a ordem definida e exige aprovação de cada spec antes de iniciar a seguinte. O gate de Requirements Discovery verifica cada spec incremental registrada. A confirmação de que a lista de incrementos está completa consta no procedimento, mas ainda não é persistida como sinal próprio no runtime. O armazenamento SQLite recebe somente tabela aditiva; nenhuma instância foi iniciada e os testes/validadores não foram executados nesta mudança. A avaliação de contratos do Planning ainda trabalha com uma origem ativa por execução e precisa aceitar múltiplas specs para automatizar esse estágio em lote.

### DEC-013 — Ciclo de entrega por fatia vertical

- **Registrado em:** 2026-10-17 (America/Cuiaba)
- **Evento/decisão:** Alterado o processo para concluir uma fatia vertical de produto de cada vez antes de definir a próxima.
- **Contexto:** O usuário esclareceu que quer entregar funcionalidades delimitadas (por exemplo, login e cadastro), com spec, plano, contratos e trabalho de agentes apenas para essa fatia, sem especificar ou planejar o produto completo de antemão.
- **Efeito:** A Etapa de requisitos agora trata uma spec ativa; Planning, desenho, desenvolvimento, QA, revisão e entrega se repetem como ciclo por incremento. Avaliações e artefatos são segregados por spec, e o SQLite mantém estado operacional por incremento. Depois da entrega, a abertura do próximo ciclo exige comando explícito. Perfis de agentes permanecem disponíveis; execução real automatizada do Codex segue desabilitada e dry-run segue padrão. Nenhum teste/validador foi executado, nenhuma instância SQLite foi aberta e o estado inicial do produto permaneceu sem alterações. Revisao, aprovacao, rejeicao e selecao de specs ficam restritas ao incremento ativo; a idempotencia de execucoes inclui o ID do incremento. A revisao estatica removeu declaracoes duplicadas no StateManager e corrigiu exemplos de caminhos por spec.
