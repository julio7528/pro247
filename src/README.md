# Aplicação Pro247

Este diretório é a raiz da aplicação do incremento `SPEC-002`; o scaffold Next.js usa App Router em `app/`.

## Estado atual

A landing page pública está em Desenvolvimento e aguarda revisão. O código inclui a página responsiva, estilos CSS Modules, metadata e um wordmark candidato usado como referência visual. O desenho UX/UI aprovado está em [solution-design.md](../plans/increments/SPEC-002/solution-design.md).

O `package.json` declara Next.js, React e TypeScript e inclui scripts `dev`, `build` e `start`. A instalação com `npm ci` e o build foram verificados com sucesso em 18/10/2026. O servidor `dev` também respondeu a uma requisição local para `/`. O diretório `node_modules/` é criado pela instalação e ignorado pelo Git; `.npm-cache/` contém cache ignorado da tentativa anterior.

O CTA de cadastro está intencionalmente desabilitado até a confirmação da rota/URL (Q-004). O catálogo não atribui estados de disponibilidade às funcionalidades enquanto Q-001 permanecer em aberto. A página não foi publicada.

## Instalação e execução

Na raiz `src/`, instale as dependências e inicie o servidor de desenvolvimento:

```powershell
npm ci
npm run dev
```

Para compilar a página:

```powershell
npm run build
```

O script `start` existe, mas não foi verificado nesta etapa. A etapa formal de QA ainda não foi iniciada.

Consulte o [`README.md` da raiz](../README.md), o [roadmap](../docs/project-roadmap.md) e o [resumo da implementação](../tasks/SPEC-002/implementation-summary.md) para o estado do incremento.
