---
name: code-review
description: Revisa uma implementação de software contra requisitos e critérios aprovados e produz parecer técnico e de produto.
---

# Revisão e aprovação

Use esta Skill para a etapa 6 de `plans/FLUXO-PROJETO-SOFTWARE.md` ou para revisar uma alteração já implementada.

1. Leia `AGENTS.md`, `plans/FLUXO-PROJETO-SOFTWARE.md`, a spec e os critérios aprovados do incremento ativo, contratos aplicáveis e suas aprovações/hash, o relatório de QA e as alterações dessa fatia.
2. Se a delegação estiver disponível, envolva `tech_lead` na revisão técnica e `product_owner` na avaliação do resultado de produto. Preserve a distinção entre os dois pareceres.
3. Procure bugs, regressões, riscos de segurança pertinentes, desvios de arquitetura e falhas nos critérios de aceitação. Priorize achados verificáveis, com severidade, evidência e referência a arquivo/linha quando possível.
4. Faça a verificação final de conformidade contratual: versão e hash atuais, referência à especificação ainda aprovada, rastreabilidade tarefa/requisito, entradas/saídas e evidências de revalidação. Avalie separadamente schema e resultado funcional.
5. Avalie separadamente a qualidade técnica e o atendimento ao briefing. Não trate itens sem evidência como aprovados e informe lacunas de testes ou limitações da revisão.
6. Se houver problemas, indique o responsável e o ajuste esperado; retorne à etapa apropriada e revalide após a correção.

**Entregável:** parecer do Tech Lead, decisão do PO (aprovado ou ajustes solicitados), evidências e pendências. Apresente a decisão ao usuário e aguarde orientação. A aprovação do PO não autoriza por si só a publicação em produção.
