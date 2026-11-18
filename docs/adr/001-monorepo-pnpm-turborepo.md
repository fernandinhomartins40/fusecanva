# ADR-001 — Monorepo com pnpm workspaces e Turborepo

- **Status:** Aceito (plano v2, 17/11/2026)
- **Data:** 2026-11-17
- **Relacionados:** ADR-002, plano v2 §3 e §10

## Contexto

O código atual é um repositório plano (`web/src`, `web/server`) com dois monólitos: `App.tsx` (638 KB) e `server/index.mjs` (278 KB). O plano v2 distribui o trabalho entre vários agentes em paralelo, e cada agente precisa de uma fronteira de propriedade clara. Também precisamos de cache de build e de testes para manter o CI rápido conforme o número de pacotes cresce.

## Decisão

- Adotar um **monorepo** com **pnpm workspaces** (`apps/*`, `packages/*`) e **Turborepo** para orquestrar `build`, `typecheck`, `lint` e `test`, com cache local e cache remoto opcional.
- Cada pacote expõe só a API pública em `src/index.ts`. Imports profundos entre pacotes são barrados por lint de fronteiras (`eslint-plugin-boundaries` ou regra equivalente no linter adotado).
- A versão do pnpm fica fixada no campo `packageManager` da raiz (Corepack).

## Consequências

- **Positivas:** fronteira de pacote igual à fronteira de agente; grafo de dependências explícito; builds incrementais; o pnpm evita dependências fantasmas.
- **Negativas:** curva de aprendizado com workspaces e TS project references; a migração do código atual exige a desmontagem guiada (A1-01 e A1-02).
- **Riscos:** cache mal configurado pode mascarar falhas. Mitigação: o job de gate do CI roda sem cache remoto.

## Alternativas consideradas

| Alternativa | Por que foi rejeitada |
| --- | --- |
| Repo único plano (estado atual) | Não isola agentes, não tem cache e incentiva monólitos |
| npm/Yarn workspaces + Nx | Viável, mas o Nx traz mais conceitos do que precisamos; o pnpm isola melhor as dependências |
| Polyrepo | Mudanças de contrato atravessariam vários repositórios e PRs |

## Versões verificadas (`npm view <pkg> version`, 17/11/2026)

| Pacote | Versão estável | Link oficial |
| --- | --- | --- |
| `pnpm` | 12.21.0 | https://pnpm.io |
| `turbo` | 2.11.12 | https://turborepo.com |
| `eslint-plugin-boundaries` | 7.4.4 | https://github.com/javierbrea/eslint-plugin-boundaries |
