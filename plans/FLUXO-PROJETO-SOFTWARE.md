# Fluxo de desenvolvimento de software

## Objetivo

Conduzir a definição e a entrega do ArqCalc como projeto de software de escopo aberto. O produto pode ser uma aplicação web, API/serviço, automação, sistema com agentes de IA e RAG ou outra solução que os requisitos confirmados justifiquem. O fluxo não escolhe antecipadamente o produto, a tecnologia, os provedores ou a infraestrutura.

## Acordos de execução

- Execute uma etapa por vez. Apresente o entregável e aguarde orientação explícita antes de começar a próxima.
- Descubra primeiro o problema e os comportamentos esperados. Decisões de arquitetura e tecnologia pertencem ao Planejamento e devem considerar requisitos aprovados.
- Registre apenas decisões confirmadas. Preserve sugestões e alternativas como propostas; mantenha dúvidas em aberto.
- Use os requisitos aprovados e a versão/hash de origem como referência para planos, tarefas, contratos, código, QA e entrega.
- Trabalhe uma fatia vertical definida pelo usuário por ciclo. Cada incremento recebe sua própria spec e percorre requisitos, planejamento, desenho aplicável, desenvolvimento, QA, revisão e entrega antes do próximo.
- Consulte contratos aplicáveis antes de uma tarefa dependente. Uma lacuna bloqueia somente a tarefa afetada.
- Se design, implementação, QA ou revisão revelar uma lacuna de produto, interrompa a parte dependente e encaminhe a decisão ao usuário e ao responsável adequado.
- Mantenha execução real desabilitada por padrão. Produção exige aceite do PO e autorização explícita do usuário para o escopo e a versão.
- Atualize os registros de `docs/` junto com cada alteração de projeto. Não declare validações que não foram realizadas.

## Etapas

| Etapa | Responsáveis | Entregável e condição para avançar |
| --- | --- | --- |
| 1. Levantamento de requisitos | Product Owner (PO) + Analista de Requisitos | Spec do incremento atual com escopo e critérios confirmados. Aprovar essa versão e autorizar o Planejamento; não é necessário enumerar incrementos futuros. |
| 2. Planejamento e arquitetura | Tech Lead + especialistas necessários | Plano proporcional à spec atual, decisão técnica proposta, tarefas, prioridades, dependências, riscos, estratégia de dados/integrações e avaliação justificada de contratos por tarefa. Apresentar e aguardar orientação. |
| 3. Desenho da solução | Tech Lead + UX/UI, backend, dados ou IA conforme o escopo | Desenho proporcional ao produto: arquitetura e fluxos, interfaces/API, modelo e fluxos de dados, interações com agentes/RAG e UX/UI quando aplicáveis. Apresentar e aguardar orientação. |
| 4. Desenvolvimento | Desenvolvedores e especialistas definidos no Planejamento | Implementação do escopo aprovado e registro das verificações locais realmente executadas. |
| 5. Testes e QA | QA Tester + especialistas pertinentes | Evidências por critério; testes funcionais e de integração e verificações de segurança, desempenho, acessibilidade ou qualidade de IA/RAG quando aplicáveis. Problemas voltam para correção. |
| 6. Revisão e aceite | Tech Lead + PO | Parecer técnico, conformidade com requisitos/contratos e decisão do PO. Ajustes são corrigidos e revalidados antes do aceite. |
| 7. Entrega e publicação | DevOps, desenvolvedores e responsáveis necessários | Pacote, instalação, handoff ou publicação conforme o plano aprovado. Publicação em produção só ocorre quando estiver no escopo, após aceite do PO e autorização explícita do usuário. |

## Procedimento por etapa

### 1. Levantamento de requisitos — PO + Analista de Requisitos

Converse com o usuário para entender o objetivo, quem será afetado, os fluxos e comportamentos esperados, o escopo, dados e integrações relevantes, restrições e critérios de sucesso da fatia atual. Pergunte qual incremento ele quer construir agora e quais dependências confirmadas existem em incrementos já aceitos. Não solicite a lista completa de funcionalidades futuras. Produza uma `SPEC-NNN` para o incremento atual; não agregue nem divida escopos sem confirmação. Pergunte se o usuário já imagina uma forma de produto — por exemplo aplicação web, API, serviço, automação ou agente com RAG — sem exigir essa decisão. Registre preferência tecnológica somente quando o usuário a confirmar; mantenha alternativas e dúvidas em aberto. Não faça descoberta de produto com perguntas próprias de uma landing page. A Etapa 1 termina quando a spec corrente é aprovada e o usuário autoriza o Planejamento.

**Entregável:** especificação do incremento atual, com objetivo, escopo, requisitos funcionais e não funcionais pertinentes, prioridades, critérios de aceitação, dependências, evidências e perguntas abertas.

### 2. Planejamento e arquitetura — Tech Lead + equipe necessária

Inspecione o repositório, a spec corrente e os incrementos anteriores que ela declarar como dependências. Compare somente alternativas relevantes para a fatia atual; Django, React, Next.js, serviços de backend, agentes e RAG são opções, não pressupostos. Explique trade-offs, dependências, custos operacionais e riscos. Defina tarefas da fatia atual, ligadas à sua spec, e avalie por tarefa se contratos de produto são necessários. Preserve decisões e interfaces já aceitas; não planeje funcionalidades futuras que o usuário ainda não definiu. Não instale dependências nem implemente nesta etapa.

**Entregáveis:** plano em `plans/increments/SPEC-NNN/`, tarefas em `tasks/SPEC-NNN/`, decisões de arquitetura/tecnologia apresentadas para orientação e avaliação de contratos junto ao plano, mesmo quando nenhum contrato adicional for necessário. IDs de tarefa continuam únicos globalmente.

### 3. Desenho da solução — Tech Lead + especialistas conforme o plano

Produza, para a spec e o plano do incremento atual, somente os artefatos que seu escopo exige. Isso pode incluir diagramas de componentes e dados, fluxos de API, limites de módulos, segurança, desenho de agente e ferramentas, fontes e recuperação RAG, fluxos de usuário, wireframes ou especificações visuais. UX/UI e Figma só são necessários quando houver interface que os justifique. Se uma descoberta alterar tarefa ou contrato, solicite revisão, nova versão e aprovação pertinente; mudanças podem invalidar o gate de Planning.

**Entregável:** desenho revisável da solução com decisões confirmadas, interfaces/fluxos aplicáveis, perguntas em aberto e referência à especificação de origem.

### 4. Desenvolvimento — equipe definida no Planejamento

Antes de cada tarefa, verifique a spec do incremento ativo, requisito, dependências e contrato aplicável, incluindo versão, hash, aprovação, entradas, invariantes, saídas e escopo. Use o perfil de agente adequado à tarefa. Entregue somente a fatia aprovada, sem adiantar funcionalidades futuras nem ultrapassar pré-requisitos. Preserve contratos e requisitos aprovados. Apresente arquivos alterados, comportamento entregue, verificações realizadas e limitações. Não faça publicação em produção nesta etapa.

**Entregável:** implementação e resumo fiel das verificações locais.

### 5. Testes e QA — QA Tester + especialistas pertinentes

Teste os critérios e fluxos da spec corrente. Se aplicável, inclua APIs, persistência e migrações, integrações, autenticação/autorização, segurança, desempenho, responsividade/acessibilidade e qualidade de agentes ou recuperação RAG. Registre separadamente validação estrutural, teste funcional e avaliação de IA; nenhuma delas substitui as demais. Informe evidências e itens não verificados. Corrija achados e repita os testes afetados antes da revisão.

**Entregável:** relatório de QA ligado à especificação, tarefas e critérios aprovados.

### 6. Revisão e aceite — Tech Lead + PO

Revise arquitetura, código, manutenção, riscos pertinentes, contratos, rastreabilidade e evidências de QA do incremento atual. O Tech Lead registra o parecer técnico; o PO avalia o atendimento ao problema e aos critérios da spec. Solicitações de ajuste retornam à etapa responsável e passam novamente pela validação afetada. O aceite do PO não autoriza produção por si só.

**Entregável:** parecer técnico e decisão explícita do PO, com evidências e pendências.

### 7. Entrega e publicação — responsáveis definidos no Planejamento

Entregue o pacote, instruções, instalação, handoff ou publicação local prevista para o incremento atual. O ciclo pode terminar com pacote ou handoff sem publicar o produto inteiro. Para produção, confirme a aprovação do PO e autorização explícita do usuário para ambiente/escopo e versão antes de iniciar. Identifique a infraestrutura existente; não presuma provedor, domínio, serviço ou credenciais. Após uma publicação autorizada, verifique o resultado e registre versão, destino e evidências. Somente depois do ciclo completo o usuário pode iniciar o próximo incremento.

**Entregável:** registro de entrega ou publicação. Se produção não fizer parte do escopo, registre a modalidade de entrega aprovada sem publicar.
