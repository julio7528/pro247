# Roadmap do projeto

Documento vivo do andamento. Atualize o status, o trabalho concluído e o próximo passo previsto sempre que uma tarefa alterar o projeto ou avançar uma etapa. Os memorandos detalhados ficam em `project-context.md`; eventos e decisões sequenciais ficam em `decision-log.md`.

## Status

- **Concluída:** entregável realizado e evidência registrada.
- **Em andamento:** trabalho iniciado e ainda não finalizado.
- **Aguardando orientação:** entregável apresentado e depende de decisão/instrução do usuário.
- **Não iniciada:** ainda não começou.

## Estado atual

| Etapa | Status | Feito | Próximo trabalho |
| --- | --- | --- | --- |
| Fundação do processo e documentação | Concluída | Regras, fluxo de sete etapas, perfis de agentes, Skills, registros contínuos, arquitetura progressiva de especificações e guias README para iniciar o fluxo e localizar as instruções da aplicação. | Manter os guias e registros atualizados; definir comandos de execução da aplicação após a decisão tecnológica no Planejamento. |
| Generalização do processo para software | Aguardando orientação | Processo, bootstrap, Skills, perfis e orquestrador foram atualizados para produto de escopo aberto, incluindo app, serviço/API, automação e IA/RAG quando confirmados. A etapa 1 e os gates permanecem intactos. | Revisar o entregável; validação automatizada não foi executada. Depois, iniciar requisitos somente com orientação explícita. |
| Ciclo vertical por incremento | Aguardando orientação | Cada fatia percorre seu próprio ciclo de requisitos, planejamento, desenho aplicável, desenvolvimento, QA, revisão e entrega. A spec, tarefas, avaliação de contratos, gates, execuções e estado das etapas ficam vinculados ao incremento ativo; planos/contratos usam diretórios por `SPEC-NNN`. O próximo incremento só começa após a entrega do atual e comando explícito do usuário. | Revisao estatica removeu declaracoes duplicadas no StateManager e corrigiu exemplos de caminhos por spec; validacao automatizada permanece pendente. A execucao real do Codex segue desabilitada. A Etapa 1 permanece NOT_STARTED; iniciar somente quando o usuario nomear a primeira fatia. |
| MVP do orquestrador progressivo | Concluída | CLI, schema, persistência SQLite, descoberta progressiva, requisitos com evidência confirmada, gates vinculados a hash, autorização específica de deploy, dry-run e suíte de 43 testes (21 de regressão e 22 de contratos); execução real do Codex continua desabilitada. | Aguardar orientação para iniciar o levantamento de requisitos pelo CLI ou priorizar a próxima fase do orquestrador. |
| Subsistema de contratos | Concluída | Schemas e templates versionados, três contratos operacionais, avaliação obrigatória no Planning, geração de contratos de produto por tarefa, revisão/aprovação por versão e hash, validação de execução/saídas/handoffs e migrações aditivas; 43 testes passaram na implementação original. Mudanças confirmadas no desenho de solução podem criar nova versão e invalidar o gate de Planning. | Usar a avaliação na Etapa 2 quando uma especificação for aprovada; reapreciar contratos após mudanças confirmadas de interface, dados ou integração. |
| 1. Requisitos do incremento ativo | Não iniciada | Nenhuma spec de produto foi criada/aprovada e nenhum gate foi concedido. O primeiro incremento ainda não foi nomeado. | Quando o usuário orientar o início, seguir `specs/INIT.md` e produzir uma spec somente para a primeira fatia nomeada. |
| 2. Planejamento e arquitetura do incremento ativo | Não iniciada | Nenhum plano técnico foi produzido; stack e tipo de produto continuam em aberto. | Após aprovar a spec corrente e receber autorização, comparar alternativas para essa fatia e criar tarefas/avaliação de contratos sob `SPEC-NNN`. |
| 3. Desenho da solução | Não iniciada | Nenhum desenho de arquitetura, dados, interfaces ou UX/UI foi produzido. | Após Planejamento aprovado, criar somente os artefatos pertinentes ao escopo definido. |
| 4. Desenvolvimento | Não iniciada | Nenhuma implementação de produto foi realizada. | Após requisitos e desenho aprovados e orientação do usuário, implementar tarefas com os especialistas previstos. |
| 5. Testes e QA | Não iniciada | Nenhum teste de produto foi executado. | Validar critérios e componentes pertinentes à arquitetura, incluindo IA/RAG somente se aplicável. |
| 6. Revisão e aprovação | Não iniciada | Nenhuma revisão de implementação ou aprovação de produto ocorreu. | Revisar a versão testada; corrigir achados e obter decisão do PO. |
| 7. Entrega e publicação | Não iniciada | Nenhum pacote, handoff ou publicação de produto foi realizado. | Entregar conforme plano aprovado; produção exige aceite do PO e autorização explícita do usuário para alvo e versão. |

**Próxima etapa elegível:** Etapa 1 — Levantamento de requisitos, quando o usuário orientar seu início. Nenhuma especificação de produto foi criada e nenhum tipo de produto ou stack foi decidido.
