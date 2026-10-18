# Orquestrador do projeto ArqCalc

Ferramenta Python para conduzir o fluxo de software declarado em specs/workflow.yaml, sem pressupor tipo de produto ou tecnologia. A definição do fluxo permanece declarativa; estados de execução, respostas, aprovações, artefatos e eventos ficam no SQLite local configurado em orchestrator/config.json.

## Instalação e validação

Requer Python 3.11 ou superior.

Na raiz do projeto, instale as duas dependências usadas para ler e validar YAML:

    python -m pip install -r requirements.txt
    python -m unittest discover -s tests -v

O primeiro comando instala PyYAML e jsonschema. Nenhum pacote adicional ou serviço externo é usado.

## Comandos

Todos os comandos devem ser executados na raiz do projeto.

    python -m orchestrator status
    python -m orchestrator evaluate
    python -m orchestrator evaluate planning --json
    python -m orchestrator discover
    python -m orchestrator discover --name "Incremento inicial"

discover inicia a etapa atual, reaproveita informações da spec do incremento corrente e pergunta somente pelos campos obrigatórios ausentes. Informe `--name` para identificar a primeira etapa de produto. Depois de revisar e aprovar a spec corrente, abra cada próximo incremento em uma sessão própria:

    python -m orchestrator discover --new-increment --name "Próximo incremento"

Cada sessão cria uma spec separada e não reutiliza respostas obrigatórias de incrementos anteriores. O incremento seguinte só pode ser aberto depois que o atual concluir o ciclo até Entrega e o usuário autorizar o retorno a Requirements Discovery. Aprovar a spec atual libera o Planejamento dela; não obriga o usuário a listar ou aprovar incrementos futuros.

Para registrar uma resposta sem modo interativo:

    python -m orchestrator answer objective "Resultado que o usuário confirmou."
    python -m orchestrator answer scope "Escopo confirmado pelo usuário."
    python -m orchestrator answer functional_requirement "Comportamento observável confirmado."
    python -m orchestrator answer product_form "Aplicação web, se essa forma já estiver confirmada."
    python -m orchestrator answer ai_relevance "Necessidade confirmada de agente/RAG ou explicação de por que é necessária."
    python -m orchestrator discover --no-interactive

Os campos opcionais `product_form`, `technology_preferences`, `ai_relevance` e `increment_dependencies` também podem ser registrados quando o usuário já tiver uma resposta; eles não bloqueiam a spec se permanecerem em aberto. Cada incremento percorre seu próprio ciclo de requisitos, planejamento, desenho aplicável, desenvolvimento, QA, revisão e entrega, com aprovações separadas por gate.

Nenhum arquivo de especificação é criado até haver objetivo, escopo e ao menos um requisito funcional verificável confirmados para o incremento corrente. O próximo identificador disponível é calculado em toda a árvore specs/; specs/SPEC-001.md continua reservado e vazio. Um rascunho incompleto do mesmo incremento é atualizado no mesmo caminho.

Cada rascunho registra os IDs dos eventos SQLite que confirmaram objetivo, escopo e requisitos. As sessões, respostas e estados das etapas são registrados por incremento no SQLite; `status` mostra a fatia ativa e `spec list` mantém o histórico. Enquanto houver um incremento ativo, o workflow vincula o Planning, as tarefas, os contratos, os gates e as execuções à sua spec. Os arquivos de planejamento ficam em `plans/increments/SPEC-NNN/`, tarefas em `tasks/SPEC-NNN/` e a avaliação de contratos em `plans/increments/SPEC-NNN/contract-assessment.yaml`; IDs `TASK-NNN` são únicos globalmente.

Revise e aprove explicitamente cada versão apresentada:

    python -m orchestrator spec list
    python -m orchestrator spec show SPEC-002
    python -m orchestrator spec review SPEC-002
    python -m orchestrator spec approve SPEC-002 --version 0.1.0 --hash HASH_MOSTRADO_NA_REVISAO --confirm --evidence "Aprovo SPEC-002 versão 0.1.0."
    python -m orchestrator complete --confirm
    python -m orchestrator advance --authorize --evidence "Autorizo iniciar o planejamento."
    python -m orchestrator start

spec review marca a versão como IN_REVIEW e aguarda o usuário. A aprovação grava ator, data/hora, decisão, evidência, ID DEC, versão e hash substantivo no SQLite e no arquivo. A aprovação não conclui a etapa nem avança o workflow. complete exige o gate da etapa; advance exige uma autorização explícita e registra um novo evento no decision log. Etapas seguintes ficam em PENDING até serem iniciadas por comando próprio.

Para solicitar ajustes, use:

    python -m orchestrator spec reject SPEC-002 --version 0.1.0 --hash HASH_MOSTRADO_NA_REVISAO --confirm --reason "Ajustar o requisito RF-001 conforme esta orientação."
    python -m orchestrator answer functional_requirement "Novo comportamento confirmado pelo usuário."
    python -m orchestrator discover

Para artefatos do incremento ativo, guarde o arquivo no diretório da respectiva spec e registre origem, requisitos e tarefas antes de solicitar aprovação do gate:

    python -m orchestrator artifact register planning implementation-plan plans/increments/SPEC-002/implementation-plan.md --version 1 --spec-ref SPEC-002@0.1.0 --requirement RF-001
    python -m orchestrator artifact register planning work-items tasks/SPEC-002/work-items.md --version 1 --spec-ref SPEC-002@0.1.0 --requirement RF-001 --task TASK-001
    python -m orchestrator gate review planning
    python -m orchestrator gate approve planning --hash HASH_MOSTRADO_NA_REVISAO --confirm --evidence "Aprovo os entregáveis de planejamento registrados."

Os arquivos precisam existir, corresponder aos entregáveis declarados e apontar para a versão aprovada da especificação. Requisitos precisam constar nessa especificação; IDs de tarefa precisam constar no arquivo ou em tasks/. Uma alteração posterior no arquivo invalida o gate e exige nova validação e aprovação.

## Contratos

Planning também exige `plans/increments/SPEC-NNN/contract-assessment.yaml`, inclusive quando a avaliação do Tech Lead conclui que não é necessário criar contratos de produto. O arquivo deve referenciar a versão/hash da especificação aprovada e as tarefas avaliadas. Consulte [`contracts/README.md`](../contracts/README.md) para schemas e o formato de tarefas. Contratos de produto gerados para a fatia ficam em `contracts/generated/SPEC-NNN/`.

```powershell
python -m orchestrator contract assess --justification "Nenhuma tarefa exige interface ou obrigação adicional."
python -m orchestrator contract assess --task-file tasks/SPEC-002/TASK-001.yaml --contract-task TASK-001 --justification "A tarefa define uma interface compartilhada."
python -m orchestrator contract generate --task-file tasks/SPEC-002/TASK-001.yaml
python -m orchestrator contract validate CONTRACT-004 --version 0.1.0 --check-inputs
python -m orchestrator contract review CONTRACT-004 --version 0.1.0
python -m orchestrator contract approve CONTRACT-004 --version 0.1.0 --hash HASH_MOSTRADO_NA_REVISAO --confirm --evidence "Aprovo esta versão exata."
python -m orchestrator contract evaluate --stage development --task TASK-001 --json
python -m orchestrator contract validate-output CONTRACT-004 docs/contract-output.json
python -m orchestrator contract validate-handoff tasks/SPEC-002/TASK-001-handoff.json
```

Contratos de produto são derivados de especificações aprovadas e artefatos de planejamento. Campos técnicos ausentes ficam explícitos em `missing_fields`; rascunhos incompletos não podem ser aprovados. A aprovação é vinculada ao ID, versão, hash e evento de revisão no SQLite. Alterações na especificação ou no contrato invalidam a prontidão da tarefa dependente. Aprovar um contrato permanece independente de aprovar o gate da etapa ou autorizar a próxima etapa.

Se o desenho da solução confirmar uma obrigação de interface, dados ou integração ausente, atualize a tarefa e repita `contract assess` durante Desenho da solução (`ux-ui-design`); gere, revise e aprove a nova versão. A avaliação atualizada invalida o gate de Planning, que precisa ser revisto e aprovado novamente antes de liberar tarefas dependentes.

A entrega é configurada conforme o produto aprovado e pode ser pacote, instalação, handoff ou publicação. A autorização abaixo é específica para publicar em produção; não é exigida para uma entrega local ou não produtiva:

    python -m orchestrator deployment authorize --confirm --scope "produção: ambiente aprovado" --version "1.0.0" --evidence "Autorizo publicar esta versão em produção."

Esse comando só aceita quando a etapa de entrega/publicação está atual e iniciada e a revisão técnica e o aceite do Product Owner estão concluídos e aprovados. O fluxo não publica automaticamente.

Uma execução real na etapa de entrega precisa usar o ID de uma tarefa aprovada no Planejamento. Tarefas de publicação em produção declaram `delivery_target: production`, `deployment_scope` e `deployment_version`; sua execução exige autorização persistida para o mesmo escopo e versão. Tarefas de pacote, instalação, ambiente local, staging ou handoff não exigem autorização de produção.

## Execução controlada

run é dry-run por padrão; apenas exibe o comando e o contexto preparado:

    python -m orchestrator run
    python -m orchestrator run --task TASK-001
    python -m orchestrator resume

run exige que a etapa atual tenha sido iniciada. Na Etapa 1, discover inicia a etapa; nas demais etapas, use start depois do avanço explícito. Em Desenvolvimento, se a avaliação de Planning apontar tarefas que exigem contratos, informe `--task` para resolver apenas as obrigações daquela tarefa.

O padrão está em orchestrator/config.json: comando codex exec -, execução real desabilitada e timeout de 120 segundos. O processo real só pode ser iniciado com --execute --authorize, etapa atual em andamento, dependências atendidas, configuração habilitada e comando preenchido. Depois de revisar as permissões e o sandbox apropriados, o usuário pode habilitar allow_real_execution em orchestrator/config.json e então executar:

    python -m orchestrator run --execute --authorize
    python -m orchestrator resume --execute --authorize

O adaptador envia o prompt por stdin, não usa shell, limita o tempo e o tamanho de logs e registra códigos de saída. A sintaxe documentada do comando codex exec com - para ler o prompt de stdin aparece no [exemplo oficial de automação com Codex](https://developers.openai.com/cookbook/examples/codex/build_iterative_repair_loops_with_codex). Nenhum processo Codex foi iniciado para construir ou testar este MVP; testes do adaptador usam apenas um processo Python falso. A configuração real permanece desabilitada.

## Estados e aprovações

Resultados de resolução são distintos dos estados de execução:

- MISSING: ainda não existe uma especificação de produto preenchida.
- DRAFT: a especificação do incremento selecionado tem campos obrigatórios pendentes.
- AWAITING_APPROVAL: objetivo, escopo e requisito verificável estão completos, mas falta aprovação humana válida.
- READY: dependências atendidas e aprovação válida da versão/hash presente.
- BLOCKED: há dependência, artefato, gate ou restrição não atendidos.

Execuções usam PENDING, RUNNING, COMPLETED e FAILED numa tabela separada. Um status APPROVED escrito manualmente no Markdown não concede aprovação. Editar o conteúdo substantivo depois da aprovação invalida o hash. Gates de artefato também são vinculados aos hashes dos arquivos validados.

## Persistência e limites

- Workflow e aprovações declarativas: specs/workflow.yaml, validadas por orchestrator/workflow.schema.json. A migração do identificador antigo `landing-page` para `arqcalc` preserva respostas, aprovações, execuções, artefatos, contratos e eventos SQLite; se os dois IDs já coexistirem, a inicialização bloqueia sem mesclar os registros.
- Respostas, execuções, gates, aprovações, artefatos e eventos: .codex/orchestrator-state.sqlite3 (ignorado pelo Git).
- Contratos, avaliações, validações, handoffs e hashes ligados à execução: `contracts/` e tabelas adicionadas ao mesmo SQLite por migrações aditivas.
- Especificações: specs/generated/, com o modelo specs/templates/SPEC-TEMPLATE.md.
- Perfis e Skills são lidos dos arquivos existentes em .codex/agents/ e .agents/skills/; o orquestrador não duplica suas instruções.
- A recuperação marca execuções deixadas em RUNNING como FAILED; resume reavalia e só tenta novamente com a autorização e configuração pedidas.

Este MVP executa um único executor. Agendamento distribuído, execução paralela, isolamento por Git Worktree e dashboard permanecem planejados. A criação de conteúdo para as etapas de planejamento até deploy depende de autorização da etapa e da tarefa Codex correspondente; nenhum deploy automático está habilitado.
