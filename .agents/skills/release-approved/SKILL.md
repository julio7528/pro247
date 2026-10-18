---
name: release-approved
description: Entrega ou publica uma versão aprovada conforme o destino planejado; produção exige aceite do PO e autorização explícita do usuário.
---

# Entrega e publicação aprovadas

Use esta Skill somente para a etapa 7 de `plans/FLUXO-PROJETO-SOFTWARE.md`.

1. Leia `AGENTS.md`, a etapa 7 do plano, a spec do incremento ativo, o parecer de revisão, o aceite do PO e o destino aprovado para essa fatia.
2. Entregue o pacote, instruções, instalação ou handoff do incremento que constar do plano. O ciclo pode terminar com entrega local sem publicar o produto inteiro. Não presuma publicação em produção.
3. Se houver publicação em produção, confirme o aceite explícito do PO e a autorização explícita do usuário para o alvo e a versão. Se faltar qualquer evidência, não publique; informe o que falta e aguarde.
4. Inspecione a configuração existente e identifique plataforma, ambiente e processo já usados. Quando a delegação estiver disponível, envolva `devops` e os desenvolvedores pertinentes. Não presuma provedor, domínio, credenciais ou configurações.
5. Proteja segredos e não crie infraestrutura fora do escopo aprovado. Após uma publicação autorizada, verifique o destino e os fluxos essenciais e registre versão, alvo, verificações, resultados e problemas.

**Entregável:** registro de entrega ou relatório de publicação com versão, destino e evidências pertinentes. Se houver falha, informe o estado observado e a ação necessária; não alegue sucesso sem evidência.
