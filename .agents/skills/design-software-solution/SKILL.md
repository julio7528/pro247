---
name: design-software-solution
description: Define o desenho técnico e de experiência necessário ao produto ArqCalc, com especialistas escolhidos conforme os requisitos aprovados.
---

# Desenho da solução

Use esta Skill somente para a etapa 3 de `plans/FLUXO-PROJETO-SOFTWARE.md`.

1. Leia `AGENTS.md`, a etapa 3 do plano, a spec do incremento ativo, o planejamento desse incremento, os contratos aplicáveis e as dependências confirmadas em incrementos aceitos.
2. Escolha especialistas pertinentes: arquitetura, UX/UI, backend, dados ou IA. Use UX/UI e Figma somente se o produto tiver interface que os justifique.
3. Desenhe os elementos que o escopo aprovado exige: arquitetura e componentes, dados, APIs/integrações, segurança, fluxos de agente/ferramentas/recuperação RAG e/ou experiência de usuário. Não introduza elementos que não tenham requisito ou justificativa aprovada.
4. Se identificar lacuna em um contrato de interface, registre-a e apresente-a ao usuário e ao Tech Lead. Não altere requisito aprovado nem contrato silenciosamente. Após confirmação, o Tech Lead pode atualizar tarefa e avaliação com `contract assess`, gerar nova versão com `contract generate` e solicitar nova aprovação do contrato e do gate de Planning. O gate antigo não libera tarefas dependentes.
5. Use Figma quando houver artefato visual solicitado e acesso disponível. Para desenhos não visuais, escolha o formato aprovado no Planejamento. Informe limitações sem alegar artefatos inexistentes.
6. Apresente o desenho aplicável, decisões confirmadas e dúvidas abertas. Não implemente nesta etapa.

**Entregável:** desenho revisável da solução proporcional à fatia atual, com referência à sua spec. Pare e aguarde orientação antes do desenvolvimento.
