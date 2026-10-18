---
name: implement-feature
description: Implementa uma funcionalidade com escopo e critérios aprovados, seguindo o planejamento do projeto; use durante a etapa de desenvolvimento, não para iniciar fases ainda não aprovadas.
---

# Implementar funcionalidade

Use esta Skill para a etapa de desenvolvimento de qualquer funcionalidade do ArqCalc com requisitos e escopo definidos.

1. Leia `AGENTS.md`, os requisitos, o plano e o desenho aplicável. Confirme que o usuário orientou o início da etapa e que os artefatos necessários estão aprovados.
2. Inspecione a estrutura e as convenções existentes antes de escolher arquivos ou tecnologias. Resolva o contrato aplicável à tarefa: confirme ID, versão, hash, aprovação, entradas presentes, dependências, invariantes e escopo. Um bloqueio contratual deve impedir somente a tarefa que depende dele.
3. Se a delegação estiver disponível, use o perfil técnico adequado à tarefa, como `software_developer`, `backend_developer`, `agentic_developer`, `desenvolvedor_frontend`, `ai_engineer` ou `data_engineer`. Use `agentic_developer` para fluxos com autonomia, ferramentas, estado ou orquestração de agentes; não o confunda com engenharia de modelos/RAG. Mantenha o escopo limitado à tarefa aprovada e preserve alterações preexistentes.
4. Implemente a menor mudança completa que atenda aos critérios, respeitando requisitos e contratos aprovados. Se UX/UI revelar necessidade de alterar interface contratada, solicite revisão de contrato e nova aprovação antes de continuar. `allowed_scope.paths` descreve escopo, não isola o sistema de arquivos.
5. Valide saídas contra schemas declarados quando aplicável. Trate isso como validação estrutural, não como prova de funcionamento ou atendimento funcional.
6. Execute verificações proporcionais à alteração e relate exatamente o que foi verificado, os resultados e limitações.

**Entregável:** resumo da implementação, arquivos alterados, verificações e pendências. Apresente o resultado e aguarde orientação antes de iniciar a próxima etapa. Não faça deploy nesta Skill.
