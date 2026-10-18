---
name: test-software-project
description: Valida o produto ArqCalc contra critérios aprovados e seleciona verificações conforme a arquitetura e o escopo.
---

# Testes e QA do produto

Use esta Skill somente para a etapa 5 de `plans/FLUXO-PROJETO-SOFTWARE.md`.

1. Leia `AGENTS.md`, a etapa 5 do plano, a spec e os critérios de aceitação do incremento ativo, os contratos aplicáveis e o resumo da implementação dessa fatia.
2. Quando a delegação estiver disponível, envolva o perfil `qa_tester` e especialistas pertinentes. Teste os critérios acordados e selecione verificações relevantes: fluxos funcionais, APIs e integrações, persistência, segurança, desempenho, acessibilidade ou avaliação de agentes/RAG quando aplicáveis.
3. Use as ferramentas e verificações disponíveis. Separe validação de schema/contrato de teste funcional; um documento estruturalmente válido não prova comportamento correto. Não invente evidências nem declare testes que não foram executados. Operar em modo de validação: não alterar a implementação.
4. Para cada falha, registre severidade, passos para reproduzir, resultado esperado e observado e evidência disponível. Separe PASS, FAIL e não verificado.
5. Encaminhe problemas ao responsável pela implementação. Se houver correções, repita os testes afetados e atualize o relatório.

**Entregável:** relatório PASS/FAIL por critério da spec ativa, com evidências, limitações e itens a corrigir. Apresente o resultado e aguarde orientação antes da revisão e aceite.
