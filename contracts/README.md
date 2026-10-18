# Contratos de execução e interface

`contracts/` contém definições YAML versionadas e verificadas por schemas JSON. Contratos dão forma às obrigações de execução, entradas/saídas, escopo, dependências e handoffs; não substituem `specs/`, Skills, gates de etapa, testes funcionais nem a decisão humana.

## Organização

| Local | Finalidade |
| --- | --- |
| `schemas/` | Schemas Draft 2020-12 para contratos, tarefas planejadas, resultados, avaliações e handoffs. |
| `templates/` | Modelos para contratos de tarefa/interface e para metadados de tarefa planejada. |
| `operational/` | Contratos reutilizáveis versionados com o orquestrador: execução, resultado estruturado e handoff. Não exigem aprovação individual. |
| `generated/SPEC-NNN/` | Contratos de produto, gerados apenas quando uma avaliação de planejamento os exigir. Cada versão é preservada em arquivo próprio. |

Contratos de produto gerados para uma fatia ficam em `generated/SPEC-NNN/`; contratos operacionais continuam em `operational/`. Arquivos legados diretamente em `generated/` sao preservados e carregados.

IDs `CONTRACT-NNN` são estáveis; versões usam `MAJOR.MINOR.PATCH`. O SHA-256 é calculado sobre os dados do contrato, excluindo apenas `content_hash`, estado de ciclo de vida e metadados de aprovação. SQLite é a fonte de verdade de registro, validações e aprovações. A cópia de hash/estado no YAML não concede autorização.

## Avaliação na Etapa 2

Cada ciclo de Planning avalia somente a spec aprovada do incremento ativo, mesmo quando o Tech Lead conclui que nenhum contrato de produto adicional é necessário. A avaliação fica em `plans/increments/SPEC-NNN/contract-assessment.yaml` e referencia `SPEC-NNN@versão`, o hash da especificação aprovada, cada tarefa incluída, hashes dos arquivos de tarefa e a justificativa. Preserve avaliações de ciclos anteriores; não reutilize o caminho de outra spec.

Use arquivos de tarefa YAML em `tasks/SPEC-NNN/` que atendam a `schemas/planned-task.schema.json`. Mantenha `TASK-NNN` globalmente único entre incrementos, pois os estados e referências de tarefa são indexados por esse ID. Campos contratuais vêm de decisões confirmadas do planejamento; deixe campos ausentes vazios para registrá-los em `missing_fields` e esclarecer com o responsável.

Para publicação em produção, identifique a tarefa com `delivery_target: production`, `deployment_scope` e `deployment_version`. Os demais destinos — pacote, local, staging ou handoff — não pedem autorização de produção.

Exemplo de avaliação global sem contratos adicionais:

```powershell
python -m orchestrator contract assess --justification "As tarefas planejadas não expõem uma interface ou obrigação adicional que justifique contrato de produto."
```

Exemplo de avaliação por tarefa com uma tarefa dependente de contrato:

```powershell
python -m orchestrator contract assess --task-file tasks/SPEC-002/TASK-001.yaml --task-file tasks/SPEC-002/TASK-002.yaml --contract-task TASK-001 --justification "TASK-001 define uma interface consumida por outras tarefas; TASK-002 não cria uma fronteira contratual adicional."
```

Ao informar tarefas, IDs omitidos em `--contract-task` ficam explicitamente avaliados como sem contrato adicional. Sem arquivos de tarefa, uma avaliação `NO_PRODUCT_CONTRACTS_REQUIRED` vale para a especificação inteira; novas tarefas criadas depois exigem nova avaliação.

## Ciclo de vida de contrato de produto

1. A especificação de origem precisa estar completa, aprovada e com aprovação SQLite válida.
2. A avaliação do Tech Lead identifica tarefa(s) que exigem contrato. O gerador reutiliza a tarefa YAML, IDs de requisito e dados de interface explicitamente fornecidos; não inventa campos técnicos.
3. O rascunho `DRAFT` passa por schema, hash, referência de especificação, rastreabilidade e consistência com escopo/dependências. Campos não definidos permanecem em `missing_fields`; um contrato incompleto não pode ser revisado nem usado.
4. `contract review` registra um evento de revisão com versão e hash. O usuário aprova ou rejeita explicitamente essa versão/hash. Aprovação reutiliza `ApprovalManager`, grava em `approval_records`, SQLite, YAML informativo e `docs/decision-log.md`.
5. Antes de uma tarefa dependente, o resolvedor verifica contrato atual, aprovação, especificação, hashes, tarefa, requisito, entradas presentes e dependências. Falhas bloqueiam somente as tarefas relacionadas.
6. Mudança no contrato cria outra versão no gerador; o hash novo não herda aprovação. Mudança na especificação invalida avaliação e contratos derivados até atualização e nova aprovação.

Se o desenho da solução confirmar uma obrigação de interface, dados ou integração ausente, o Tech Lead pode executar `contract assess` durante a etapa Desenho da solução (`ux-ui-design`), após atualizar a tarefa com a decisão confirmada. O gerador cria uma nova versão, que exige revisão e aprovação próprias. Como a avaliação também é um entregável de Planning, sua atualização invalida o gate anterior: revise e aprove novamente o gate de Planning antes de executar tarefas dependentes.

Estados YAML como `APPROVED` nunca são suficientes sem registro de revisão e aprovação explícitos para o mesmo hash no SQLite. Aprovação de contrato não conclui etapa, aprova gate, autoriza transição ou permite deploy.

## Interfaces operacionais

- `CONTRACT-001` descreve os limites de execução, mantendo dry-run por padrão e exigindo as autorizações já configuradas para executar processos reais.
- `CONTRACT-002` define o resultado serializável do orquestrador; seus schemas validam estrutura e metadados, não comportamento funcional.
- `CONTRACT-003` define registros de transferência entre agentes. Use handoffs com referência de tarefa, especificação e hashes dos contratos usados.

Quando uma saída estruturada tiver schema declarado, a validação estrutural deve ser relatada separadamente de testes funcionais e QA. Um JSON válido não prova que um requisito foi atendido.

`allowed_scope.paths` documenta escopo e é validado para caminhos relativos seguros. Não constitui sandbox, isolamento do sistema de arquivos nem controle de permissões do processo; o executor continua sujeito à configuração e ao ambiente existentes.

## Comandos

```powershell
python -m orchestrator contract list
python -m orchestrator contract evaluate --stage development --task TASK-001 --json
python -m orchestrator contract assess --task-file tasks/SPEC-002/TASK-001.yaml --contract-task TASK-001 --justification "A interface compartilhada exige contrato."
python -m orchestrator contract generate --task-file tasks/SPEC-002/TASK-001.yaml
python -m orchestrator contract validate CONTRACT-004 --version 0.1.0 --check-inputs
python -m orchestrator contract review CONTRACT-004 --version 0.1.0
python -m orchestrator contract approve CONTRACT-004 --version 0.1.0 --hash HASH_EXIBIDO --confirm --evidence "Aprovo este contrato e sua versão exata."
python -m orchestrator contract reject CONTRACT-004 --version 0.1.0 --hash HASH_EXIBIDO --confirm --reason "Definir a saída que falta."
python -m orchestrator contract validate-output CONTRACT-004 docs/contract-output.json --version 0.1.0
python -m orchestrator contract validate-handoff tasks/SPEC-002/TASK-001-handoff.json
python -m orchestrator run --task TASK-001
```

O comando `run` continua dry-run por padrão. Para tarefa que exige contrato, `--task` é obrigatório e toda validação precisa passar. `--execute --authorize` não habilita a execução real por si só: `allow_real_execution` permanece desabilitado em `orchestrator/config.json`.

## Persistência e limites

O estado é adicionado ao SQLite existente por migrações não destrutivas: catálogo/versionamento, avaliações, validações, handoffs, referência de tarefa e hashes de contratos nas execuções/artefatos. Aprovações continuam na tabela de aprovação existente. Dados antigos recebem valores padrão; workflow, execuções, gates e aprovações existentes não são resetados.

O sistema valida declarações e estrutura, mas não inventa decisões, não executa agentes em paralelo, não cria isolamento por worktree e não substitui testes funcionais. Revisão manual de contrato e QA continuam necessários.
