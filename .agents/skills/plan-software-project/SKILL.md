---
name: plan-software-project
description: Converte requisitos validados do ArqCalc em opções de arquitetura, tarefas, prioridades, dependências e decisões técnicas; use depois da aprovação dos requisitos.
---

# Planejamento e arquitetura do produto

Use esta Skill somente para a etapa 2 de `plans/FLUXO-PROJETO-SOFTWARE.md`.

1. Leia `AGENTS.md`, a etapa 2 do plano e a spec aprovada do incremento ativo. Confirme que o usuário autorizou o início do Planejamento e identifique somente dependências já aceitas e relevantes.
2. Inspecione o repositório para conhecer tecnologias, estrutura, convenções e integrações existentes antes de propor mudanças.
3. Quando a delegação estiver disponível, envolva `tech_lead` e selecione especialistas conforme os requisitos. Compare arquiteturas e stacks pertinentes à fatia atual; Django, React, Next.js e componentes de agentes/RAG são opções, nunca pressupostos. Divida somente esse escopo em tarefas, identifique a spec de origem, responsáveis, dependências, riscos e ordem. Use IDs `TASK-NNN` globalmente únicos e guarde as tarefas em `tasks/<SPEC-ID>/`. Avalie cada tarefa quanto à necessidade de contrato de produto e registre a justificativa, inclusive quando nenhum contrato adicional for necessário.
4. Guarde o plano e a avaliação de contratos em `plans/increments/<SPEC-ID>/`. Gere contratos de produto em DRAFT somente a partir da spec aprovada que origina a tarefa e dos artefatos de planejamento confirmados. Valide estrutura e rastreabilidade; registre campos pendentes e peça esclarecimento ao responsável adequado em vez de inventar interfaces ou decisões. A avaliação deste ciclo é vinculada à spec ativa; preserve avaliações e contratos de ciclos aceitos sem sobrescrevê-los. Armazene contratos de produto em `contracts/generated/<SPEC-ID>/`.
5. Proponha apenas decisões técnicas que o contexto justifique. Explique impactos e alternativas relevantes; destaque decisões que precisam da escolha do usuário. Não implemente código nem instale dependências nesta etapa.
6. Apresente plano, alternativas e decisão arquitetural proposta, avaliação de contratos, rascunhos e perguntas em aberto ao usuário.

**Entregável:** plano da fatia atual, tarefas ligadas à sua spec, prioridades, dependências, alternativas, decisões técnicas propostas, riscos e avaliação rastreável de contratos. Pare e aguarde orientação antes do desenho da solução ou desenvolvimento.
