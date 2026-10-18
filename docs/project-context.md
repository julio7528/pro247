# Contexto do projeto

Este documento guarda memorandos de contexto, um por feature ou iniciativa relevante. Registre o que foi criado, como foi feito, onde ficou e quais validações ou pendências existem. O roadmap acompanha o status das etapas; o decision log mantém o histórico sequencial de eventos e decisões.

## Memorando inicial — Fundação do fluxo de trabalho

- **Tipo:** Fundação de processo e governança; não é uma feature da aplicação.
- **Objetivo:** Preparar um fluxo de trabalho para desenvolver uma landing page em etapas, com papéis especializados, entregáveis revisáveis e orientação do usuário entre as etapas.
- **O que foi criado:** Regras do projeto, processo de sete etapas, oito perfis de agentes, sete Skills de etapa e a estrutura inicial de documentação contínua.
- **Como foi criado:** O fluxo foi documentado como uma sequência de levantamento de requisitos, planejamento, UX/UI, desenvolvimento, QA, revisão/aprovação e deploy. Os papéis foram definidos em perfis TOML do Codex. As Skills descrevem como conduzir cada etapa e referenciam as regras e o plano do projeto.
- **Onde foi criado:**
  - `AGENTS.md` — regras de trabalho e obrigação de manter os registros de `docs/`.
  - `plans/FLUXO-LANDING-PAGE.md` — etapas, responsáveis, entregáveis e gates do fluxo.
  - `.codex/agents/*.toml` — perfis de Product Owner, Analista de Requisitos, UX Designer, UI Designer, Desenvolvedor Frontend, QA Tester, Tech Lead e DevOps.
  - `.agents/skills/*/SKILL.md` — Skills para cada etapa do fluxo.
  - `docs/project-context.md`, `docs/project-roadmap.md` e `docs/decision-log.md` — registros de contexto, andamento e eventos/decisões.
- **Validações registradas:** As sete Skills passaram pelo validador do `skill-creator`. Não foi executada implementação de landing page.
- **Estado e limites conhecidos:** O levantamento de requisitos de uma landing page ainda não começou; `specs/SPEC-001.md` permanece vazio. Não há implementação de produto nem deploy registrado.
- **Referências de evento/decisão:** `DEC-001` a `DEC-004` em `docs/decision-log.md`.

## Memorando de manutenção — Arquitetura progressiva de especificações

- **Tipo:** Fundação e manutenção de governança; não é uma feature da aplicação.
- **Objetivo:** Permitir descoberta incremental de requisitos, criação rastreável de especificações de produto, aprovações humanas explícitas e controle das sete etapas do fluxo.
- **O que foi criado:** Ponto de entrada de bootstrap, convenções e ciclo de vida de especificações, modelo padrão, estado inicial de workflow e diretório de saída para futuras especificações.
- **Como foi feito:** Separando requisitos de produto dos artefatos de planejamento, tarefas, design, implementação, contratos e QA; definindo IDs globais `SPEC-NNN`, versões, estados `DRAFT` / `IN_REVIEW` / `APPROVED` e evidência cruzada com `DEC-NNN`. A configuração inicial deixa a Etapa 1 como `NOT_STARTED`, as demais `PENDING` e todos os gates sem concessão.
- **Arquivos e locais afetados:**
  - `specs/README.md`, `specs/INIT.md`, `specs/workflow.yaml`, `specs/templates/SPEC-TEMPLATE.md`, `specs/generated/.gitkeep`.
  - `AGENTS.md` e `.agents/skills/requirements-discovery/SKILL.md` para orientar sessões futuras.
  - `docs/project-context.md`, `docs/project-roadmap.md` e `docs/decision-log.md` para manter o histórico do projeto.
  - `specs/SPEC-001.md` foi preservado vazio, sem sobrescrita ou exclusão; o próximo ID livre é `SPEC-002`.
- **Validações executadas:** YAML carregado e conferido; sete etapas, ordem, estados, agentes, Skills e gates verificados; links Markdown locais resolvidos; Skill de requisitos aprovada pelo `quick_validate.py`; `SPEC-001.md` confirmado vazio.
- **Compatibilidade:** Os caminhos configurados correspondem aos perfis e Skills existentes; não foi identificada incompatibilidade com o fluxo atual.
- **Pendências e limites:** Nenhum requisito de produto foi levantado ou aprovado; não há motor de orquestração, execução de agentes, implementação de aplicação ou avanço de etapa nesta mudança.
- **Decisão relacionada:** `DEC-005`.

## Memorando de manutenção — MVP do orquestrador progressivo

- **Tipo:** Fundação e manutenção de engenharia; componente separado da landing page.
- **Status:** Concluída e validada localmente.
- **Objetivo e solicitação:** Implementar um orquestrador Python determinístico para conduzir as sete etapas existentes, coletar apenas informações ausentes, reutilizar especificações, registrar execução e exigir decisões humanas verificáveis.
- **O que foi criado:** Núcleo de workflow, controlador de etapas, resolução de especificações nos estados `MISSING`, `DRAFT`, `AWAITING_APPROVAL`, `READY` e `BLOCKED`; esclarecimento interativo; gates de qualidade; registros SQLite; adaptador subprocesso do Codex; CLI e suíte de testes.
- **Como foi implementado:** `specs/workflow.yaml` permanece a definição declarativa e ganhou regras de esclarecimento e caminho de bootstrap. `orchestrator/workflow.schema.json` valida a forma da definição. O runtime separado em SQLite registra respostas confirmadas e seus IDs, seleção explícita quando há múltiplas especificações, aprovações vinculadas à versão/hash apresentados, artefatos, transições, execuções e eventos. Requisitos gerados apontam para os IDs das respostas confirmadas. Edição de status em arquivo não concede aprovação; mudança de conteúdo depois da revisão ou de artefato validado invalida o respectivo hash/gate. O deploy exige autorização específica de escopo e versão. A execução real usa comando configurável, stdin, `shell=False`, timeout e logs limitados; permanece desabilitada por padrão.
- **Arquivos e locais afetados:** `orchestrator/` (pacote, CLI, schema, config e README); `specs/workflow.yaml`; `requirements.txt`; `.gitignore`; `AGENTS.md`; `tests/test_orchestrator.py`; este documento, `docs/project-roadmap.md` e `docs/decision-log.md`.
- **Validações executadas e resultados:** `python -m compileall -q orchestrator tests` passou. `python -m unittest discover -s tests -v` passou com 21 testes. Os testes cobrem os cinco resultados, descoberta sem inferência, evidência confirmada em requisitos funcionais, preservação de arquivos, hash informado na aprovação, bloqueio de dependência, execução não autorizada, dry-run, persistência, recuperação, gates, CLI, transições e autorização específica de deploy.
- **Estado preservado:** `python -m orchestrator status` confirmou `requirements-discovery` como etapa atual `NOT_STARTED`, demais etapas `PENDING`, execução `PENDING`, nenhuma especificação ativa e nenhum gate concedido. O banco local foi inicializado em `.codex/orchestrator-state.sqlite3` e é ignorado pelo Git. `specs/SPEC-001.md` continua vazio; nenhum requisito de produto foi criado.
- **Limitações:** Nenhum processo Codex real foi iniciado. Execução real está desativada em configuração e não foi validada contra uma sessão Codex; a sintaxe `codex exec -` foi conferida na documentação oficial. Um executor serial é implementado. Paralelismo, isolamento por Worktree, escalonamento distribuído e dashboard permanecem futuros.
- **Decisões relacionadas:** `DEC-006` e `DEC-007`.

## Memorando de manutenção — Subsistema de contratos do orquestrador

- **Tipo:** Fundação e manutenção de engenharia; não é uma feature da landing page.
- **Status:** Implementado e validado localmente.
- **Objetivo e solicitação:** Adicionar contratos operacionais reutilizáveis e contratos de produto derivados de especificações aprovadas, com validação determinística, rastreabilidade por tarefa, aprovação humana vinculada a hash e integração com o orquestrador existente.
- **O que foi criado:** Schemas JSON para contratos, tarefas planejadas, avaliação, resultados e handoffs; templates YAML; três contratos operacionais; registry, resolver, validator, generator e avaliação do Tech Lead; comandos CLI; persistência aditiva; validação de resultados e handoffs; avaliação de contratos como entregável obrigatório de Planning.
- **Como foi implementado:** Contratos de produto nascem somente de uma tarefa avaliada durante Planning e de uma especificação aprovada. Dados técnicos ausentes permanecem em `missing_fields`; contratos incompletos não podem ser revisados ou aprovados. O registro de revisão e aprovação reutiliza `ApprovalManager` e `approval_records`; cada referência de execução contém ID, versão e SHA-256. A avaliação vincula o hash da especificação e das tarefas. Mudanças de interface confirmadas em UX/UI podem gerar nova versão e reavaliação; a alteração invalida o gate de Planning e exige reapresentá-lo. Alterações de conteúdo/origem também invalidam aprovação ou avaliação conforme a origem afetada. Migrações adicionam tabelas e colunas sem recriar o banco; `start` também efetua a transição declarada de `PENDING` para `IN_PROGRESS` após o avanço explícito. PyYAML e jsonschema existentes foram reutilizados, sem novo serviço externo.
- **Arquivos e locais afetados:**
  - `contracts/schemas/`, `contracts/templates/`, `contracts/operational/`, `contracts/generated/` e `contracts/README.md`.
  - `orchestrator/contracts/` e integrações em `orchestrator/core/`, `orchestrator/governance/`, `orchestrator/executors/` e `orchestrator/cli.py`.
  - `orchestrator/core/state_manager.py` para migração aditiva de contratos, tarefas, avaliações, validações, handoffs e referências de artefatos/execuções.
  - `specs/workflow.yaml`, `plans/FLUXO-LANDING-PAGE.md`, `AGENTS.md`, Skills e perfis relacionados.
  - `tests/test_contracts.py`, `tests/test_orchestrator.py`, este memorando, `docs/project-roadmap.md` e `docs/decision-log.md`.
- **Validações executadas e resultados:** `python -m compileall -q orchestrator tests` passou. `python -m unittest discover -s tests -v` passou com 43 testes (22 de contratos e 21 de regressão do orquestrador). A migração preservou uma execução e aprovação legadas em banco de teste. Os testes exercitam avaliação sem contrato, rascunho obrigatório, aprovação por hash, bloqueios por tarefa, hashes desatualizados, revisão de contrato em UX/UI com invalidação/reaprovação do gate, validação de saída/handoff, idempotência e persistência. Nenhum processo Codex real foi iniciado.
- **Estado e limites:** A implementação não cria especificação nem aprovação de produto e não avança o workflow. A execução real continua desabilitada e não houve deploy. `allowed_scope.paths` é verificado como dado declarativo, mas não fornece isolamento do sistema de arquivos. Validação estrutural não substitui testes funcionais ou QA. Execução concorrente e agentes reais permanecem fora do escopo.
- **Decisão relacionada:** `DEC-008`.

## Memorando de manutenção — Guias de início do repositório e da aplicação

- **Tipo:** Fundação e documentação de uso; não é uma feature da aplicação.
- **Objetivo:** Explicar como iniciar o fluxo de trabalho no Codex e reservar um local claro para as futuras instruções de execução da aplicação.
- **O que foi criado:** Um README na raiz para orientar o início do levantamento, mostrar os comandos básicos do orquestrador e apontar para a documentação do processo; um README em `src/` para registrar o estado e as futuras instruções da aplicação.
- **Como foi feito:** Os comandos de execução da aplicação foram deixados pendentes porque a tecnologia e os scripts ainda serão definidos no Planejamento. As regras do projeto agora indicam onde manter cada guia e proíbem documentar comandos não verificados.
- **Arquivos e locais afetados:** `README.md`, `src/README.md`, `AGENTS.md`, este documento, `docs/project-roadmap.md` e `docs/decision-log.md`.
- **Validações executadas:** Revisão de consistência dos links e comandos documentados. Nenhum comando de aplicação ou teste foi executado; a aplicação ainda não existe.
- **Decisão relacionada:** `DEC-009`.

## Memorando de manutenção — Escopo geral de software do ArqCalc

- **Tipo:** Fundação e manutenção do processo e do orquestrador; não é uma feature de produto.
- **Status:** Entregável aplicado; aguardando orientação. Validação automatizada não executada.
- **Objetivo e solicitação:** Preparar o ArqCalc para que o usuário defina o tipo de produto após o levantamento, sem limitar o repositório a landing pages ou escolher antecipadamente framework, backend, agente ou RAG.
- **O que foi criado ou alterado:** Fluxo geral de sete etapas; descoberta opcional de forma do produto, preferências tecnológicas e aplicabilidade de IA; perfis gerais de desenvolvimento, backend, dados e IA; regras de entrega local/handoff e produção separada; migração não destrutiva do ID de workflow legado `landing-page` para `arqcalc`.
- **Como foi feito:** O planejamento compara arquitetura e stack após aprovação de requisitos; o desenho da solução inclui arquitetura, dados, API, agente/RAG ou UX/UI somente quando aplicável. O orquestrador mantém os mesmos IDs de etapa e o mesmo estado inicial, migra tabelas relacionadas ao workflow em uma transação e bloqueia se identificar estados antigo e novo coexistentes. Tarefas de produção declaram destino, escopo e versão; a autorização é verificada para a tarefa exata.
- **Arquivos e locais afetados:** `AGENTS.md`, `README.md`, `src/README.md`, `plans/FLUXO-PROJETO-SOFTWARE.md`, o arquivo histórico `plans/FLUXO-LANDING-PAGE.md`, `specs/`, `contracts/`, `.agents/skills/`, `.codex/agents/`, `orchestrator/`, `tests/`, este documento, `docs/project-roadmap.md` e `docs/decision-log.md`.
- **Validações executadas e resultados:** Não foram executados testes nem validação estrutural nesta solicitação. A inspeção somente de leitura antes da alteração não encontrou `.codex/orchestrator-state.sqlite3`; por isso, o caminho de migração SQLite foi implementado, mas não exercitado.
- **Estado preservado:** A etapa 1 continua `NOT_STARTED`, etapas seguintes `PENDING`, sem especificação de produto aprovada e sem gates. Nenhum requisito ou stack de produto foi escolhido; nenhum processo Codex real nem deploy foi executado.
- **Pendências, riscos ou limitações:** A validação automatizada do orquestrador permanece pendente. Os IDs internos das etapas foram preservados para compatibilidade; a autorização específica de produção aplica-se a tarefas explicitamente planejadas como `production`.
- **Decisão relacionada:** `DEC-010`.

## Memorando de manutenção — Perfis agênticos e especificações por incremento

- **Tipo:** Fundação e manutenção do fluxo do produto e do orquestrador; não é uma feature da aplicação ArqCalc.
- **Status:** Superado por DEC-013; mantido como registro historico do modelo anterior.
- **Objetivo e solicitação:** Separar a construção de produtos agênticos do papel de engenharia geral de IA e permitir uma especificação por cada incremento de produto definido pelo usuário, conforme a ordem escolhida.
- **O que foi criado ou alterado:** Criado `.codex/agents/agentic-developer.toml`; confirmado e mantido o perfil existente `.codex/agents/backend-developer.toml`; perfil agêntico incluído nas etapas técnicas e citado na Skill de implementação. A política de specs agora define granularidade por incremento de produto, revisão/aprovação individual, coleta sequencial e critérios para concluir Requirements Discovery. A CLI ganhou `discover --new-increment --name ...`; as respostas de cada incremento são segmentadas por posição de resposta e persistidas em sessões SQLite aditivas; a Etapa 1 verifica todas as specs de incrementos registradas.
- **Como foi feito:** `specs/workflow.yaml`, seu JSON Schema, `specs/INIT.md`, `specs/README.md`, o modelo de spec, a Skill de levantamento e os guias de início distinguem incrementos de produto das sete etapas operacionais. O coletor cria ou atualiza uma spec do incremento corrente e só inicia a seguinte após aprovação verificável da anterior. A nova tabela SQLite é criada com `CREATE TABLE IF NOT EXISTS`, sem apagar respostas, decisões ou aprovações existentes.
- **Arquivos e locais afetados:** `.codex/agents/agentic-developer.toml`; `AGENTS.md`; `README.md`; `.agents/skills/requirements-discovery/SKILL.md`, `.agents/skills/plan-software-project/SKILL.md`, `.agents/skills/design-software-solution/SKILL.md`, `.agents/skills/implement-feature/SKILL.md`, `.agents/skills/test-software-project/SKILL.md`, `.agents/skills/release-approved/SKILL.md`; `plans/FLUXO-PROJETO-SOFTWARE.md`; `specs/workflow.yaml`, `specs/INIT.md`, `specs/README.md`, `specs/templates/SPEC-TEMPLATE.md`; `orchestrator/workflow.schema.json`, `orchestrator/README.md`, `orchestrator/cli.py`, `orchestrator/core/state_manager.py`, `orchestrator/core/specification_resolver.py`, `orchestrator/core/workflow_engine.py`, `orchestrator/core/stage_controller.py`, `orchestrator/discovery/clarification_manager.py`, `orchestrator/discovery/requirements_collector.py`, `orchestrator/governance/quality_gate.py`; este memorando, `docs/project-roadmap.md` e `docs/decision-log.md`.
- **Validações executadas e resultados:** Nenhum teste ou validador JSON/YAML foi executado nesta alteração, conforme as instruções atuais. Nenhuma instância do orquestrador foi iniciada, portanto o SQLite local não foi aberto nem modificado por esta tarefa.
- **Estado e limites:** O estado inicial do workflow permanece intacto: Etapa 1 `NOT_STARTED`, etapas seguintes `PENDING`, sem especificações aprovadas e sem gates concedidos. O orquestrador aplica uma sessão por incremento durante a Etapa 1; o gate valida todas as specs associadas às sessões, enquanto a confirmação de que a lista está completa permanece uma decisão explícita no processo e ainda não tem um sinal próprio persistido. O planejamento e a execução devem agrupar tarefas pela ordem incremental, com cada tarefa ligada à sua spec. Não foi criado um ciclo automático de sete etapas por incremento. A avaliação de contratos do Planning ainda valida uma única spec de origem ativa; antes de usar várias specs nessa avaliação, será necessário generalizá-la para múltiplas origens.
- **Decisões relacionadas:** `DEC-011` e `DEC-012`.

## Memorando de manutenção — Ciclo vertical de um incremento por vez

- **Tipo:** Fundação e manutenção do processo/orquestrador; não é uma feature do produto ArqCalc.
- **Status:** Política e runtime ajustados; aguardando orientação para iniciar a primeira fatia de produto.
- **Objetivo e solicitação:** Permitir que o usuário desenvolva uma funcionalidade delimitada de ponta a ponta (por exemplo, login e cadastro) antes de definir a próxima, com spec, planejamento, tarefas, avaliação/contratos e trabalho dos agentes vinculados somente a essa fatia.
- **O que foi alterado:** `specs/workflow.yaml` e seu schema definem um ciclo operacional completo por incremento e deixam incrementos futuros indefinidos. Planos, tarefas e avaliação de contratos passam a usar diretórios associados a `SPEC-NNN`. O SQLite registra o incremento ativo e estados operacionais separados por incremento; artefatos, aprovações de gate e execuções são filtrados pela spec ativa. Ao concluir Entrega, uma transição autorizada retorna a Requirements Discovery; abrir a próxima fatia exige comando e nome explícitos. Revisao, aprovacao, rejeicao e selecao de specs aceitam somente o incremento ativo; a chave de idempotencia inclui seu ID.
- **Como foi feito:** Migrações SQLite aditivas mantêm estados anteriores sem reset. `SpecificationResolver` seleciona a spec do incremento ativo; gates e avaliações de contrato usam essa origem. A avaliação de contratos é armazenada em `plans/increments/SPEC-NNN/contract-assessment.yaml`. Os perfis e Skills continuam definindo os agentes por responsabilidade. Execução real do Codex permanece desabilitada e dry-run continua padrão. Contratos de produto gerados ficam em `contracts/generated/SPEC-NNN/`; registros antigos na raiz de `generated/` continuam legiveis.
- **Arquivos e locais afetados:** `AGENTS.md`, `README.md`, `specs/workflow.yaml`, `orchestrator/workflow.schema.json`, `specs/INIT.md`, `specs/README.md`, `plans/FLUXO-PROJETO-SOFTWARE.md`, Skills de requisitos, planejamento, desenho, QA, revisão e entrega, `orchestrator/core/state_manager.py`, `orchestrator/core/specification_resolver.py`, `orchestrator/core/workflow_engine.py`, `orchestrator/core/stage_controller.py`, `orchestrator/discovery/requirements_collector.py`, `orchestrator/discovery/clarification_manager.py`, `orchestrator/governance/quality_gate.py`, `orchestrator/governance/approval_manager.py`, `orchestrator/contracts/assessment.py`, `orchestrator/contracts/registry.py`, `orchestrator/cli.py`, `contracts/README.md`, `orchestrator/README.md`, este memorando, `docs/project-roadmap.md` e `docs/decision-log.md`.
- **Validações executadas:** Nenhum teste ou validador JSON/YAML foi executado nesta alteração. A inspeção anterior confirmou que `.codex/orchestrator-state.sqlite3` não existe; o runtime e as migrações não foram iniciados nesta tarefa. Revisao estatica removeu declaracoes duplicadas no StateManager e corrigiu exemplos de caminhos por spec; validacao automatizada permanece pendente.
- **Estado preservado:** Requirements Discovery permanece `NOT_STARTED`; etapas futuras `PENDING`; nenhuma spec aprovada ou gate concedido. Não foi iniciado agente, processo Codex, deploy ou incremento de produto.
- **Pendências e limites:** A execução de agentes pelo orquestrador continua desabilitada; os perfis orientam o trabalho, mas não são despachados automaticamente por esta configuração. O novo ciclo de estado por incremento ainda requer validação automatizada e revisão antes do primeiro uso.
- **Decisão relacionada:** `DEC-013`.

## Modelo — Memorando por feature

Copie este bloco para cada nova feature. Use um identificador estável e mantenha o histórico anterior; não substitua memorandos de outras features.

### [FEAT-XXX] — [Nome da feature]

- **Status:** Proposta / Em andamento / Concluída / Suspensa
- **Objetivo e solicitação:**
- **Requisitos e critérios relacionados:**
- **O que foi criado ou alterado:**
- **Como foi implementado:**
- **Arquivos e locais afetados:**
- **Validações executadas e resultados:**
- **Decisões relacionadas:** DEC-00X
- **Pendências, riscos ou limitações:**
