---
name: requirements-discovery
description: Conduz o levantamento interativo de requisitos do produto ArqCalc sem pressupor tipo de software ou tecnologia; use antes do planejamento.
---

# Levantamento de requisitos

Use esta Skill somente para a etapa 1 de `plans/FLUXO-PROJETO-SOFTWARE.md`.

1. Leia as regras de `AGENTS.md` e a etapa 1 do plano. Verifique se já existem requisitos ou decisões para preservar.
   Leia também `specs/README.md`, `specs/INIT.md` e `specs/workflow.yaml`; confirme que a etapa atual permite o levantamento e consulte as especificações existentes sem sobrescrevê-las.
2. Quando a delegação estiver disponível, envolva os perfis `product_owner` e `analista_requisitos`. O PO ajuda a esclarecer objetivo, público, valor e prioridades; o Analista converte as respostas em requisitos verificáveis. Trabalhe com ambos e com o usuário de forma interativa.
3. Pergunte sobre o problema, usuários, escopo, comportamentos, dados, integrações, restrições e critérios de sucesso. Pergunte se o usuário já imagina uma forma de produto ou tem preferências tecnológicas, mas permita deixar essas decisões para o Planejamento. Não presuma aplicação web, framework, agente ou RAG.
4. Pergunte qual fatia de produto o usuário quer construir agora e quais dependências confirmadas existem em incrementos já aceitos. Não peça uma lista completa de incrementos futuros nem antecipe suas specs.
5. Preserve incertezas como perguntas em aberto. Só crie ou atualize a spec do incremento corrente em `specs/generated/` quando houver objetivo, escopo identificável e ao menos um requisito verificável confirmados; use `specs/templates/SPEC-TEMPLATE.md` e o próximo ID livre conforme `specs/README.md`. Nomeie a primeira sessão com `discover --name "..."`; somente depois que o ciclo do incremento atual concluir e o workflow retornar a Requirements Discovery, abra outro com `discover --new-increment --name "..."`. As respostas são segregadas por incremento e preservadas no SQLite.
6. Apresente e aprove a spec corrente por ID, versão e hash. O usuário precisa autorizar separadamente o início do Planejamento. Futuras fatias permanecem indefinidas até o usuário iniciar cada uma.
7. Registre cada decisão no artefato e em `docs/decision-log.md` com evidência e referência cruzada. Não marque como `APPROVED`, não libere o próximo gate nem avance sem evidência e autorização explícitas. Atualize os registros obrigatórios em `docs/`.

**Entregável:** spec validada do incremento atual, com suas dependências confirmadas. Pare nesta etapa; não avance para planejamento, desenho ou implementação até receber orientação.
