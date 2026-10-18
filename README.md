# ArqCalc

Repositório do projeto ArqCalc. Este é um projeto de software de escopo aberto: o tipo de produto e a arquitetura serão definidos com o usuário. Pode resultar em aplicação web, serviço/API, automação ou solução com agente e RAG, se os requisitos confirmados justificarem essas opções. Nenhuma tecnologia foi escolhida.

## Como iniciar o trabalho

Abra o repositório na raiz no Codex e solicite:

> Inicie somente os requisitos do incremento que vou nomear. Não avance para o planejamento sem me apresentar a spec.

O Codex deve seguir [`AGENTS.md`](AGENTS.md), [`specs/INIT.md`](specs/INIT.md) e a Skill de [levantamento de requisitos](.agents/skills/requirements-discovery/SKILL.md). A conversa define somente a fatia atual; requisitos não confirmados ficam como perguntas em aberto. Você aprova essa spec e autoriza o Planejamento antes de avançarmos.

O ArqCalc trabalha uma fatia vertical por vez: spec → planejamento/tarefas/contratos → desenho aplicável → implementação com os agentes adequados → QA → aceite → entrega local ou handoff. Cada artefato aponta para a spec daquela fatia. Quando o ciclo termina, você nomeia o próximo incremento; não é necessário definir o produto inteiro antes. O processo e os gates estão em [`plans/FLUXO-PROJETO-SOFTWARE.md`](plans/FLUXO-PROJETO-SOFTWARE.md); o roadmap e as decisões ficam em [`docs/project-roadmap.md`](docs/project-roadmap.md) e [`docs/decision-log.md`](docs/decision-log.md).

## Como usar o orquestrador

O orquestrador local registra respostas, especificações, aprovações e o estado do fluxo. Requer Python 3.11 ou superior. Na raiz do repositório:

```powershell
python -m pip install -r requirements.txt
python -m orchestrator status
python -m orchestrator discover
```

`discover` coleta os requisitos do incremento atual. Depois de concluir e entregar todo o ciclo, abra o seguinte com `python -m orchestrator discover --new-increment --name "Nome do próximo incremento"`. Os perfis de agentes e Skills orientam a equipe por tarefa; o orquestrador não inicia agentes independentes. Django, React, Next.js e componentes de agente/RAG ficam para o Planejamento da fatia atual. A execução real do Codex permanece desabilitada e `run` opera em dry-run por padrão. Consulte [`orchestrator/README.md`](orchestrator/README.md) antes de usar os comandos de aprovação, avanço ou execução.

## Aplicação

O código do produto ficará em [`src/`](src/). As instruções para instalar, executar, testar e compilar ficarão em [`src/README.md`](src/README.md) depois que o Planejamento definir a arquitetura, as ferramentas e os comandos disponíveis.

## Estrutura principal

- `.codex/agents/` — perfis dos papéis do projeto.
- `.agents/skills/` — instruções reutilizáveis por etapa.
- `specs/` — requisitos confirmados e especificações do produto.
- `plans/` e `tasks/` — planejamento e tarefas.
- `contracts/` — contratos de execução e de produto.
- `docs/` — contexto, roadmap e registro de decisões.
- `orchestrator/` — ferramenta local para conduzir e registrar o fluxo.
- `src/` — código da aplicação.
