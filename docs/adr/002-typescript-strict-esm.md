# ADR-002 — TypeScript strict e ESM em todo o código

- **Status:** Aceito (plano v2, 17/11/2026)
- **Data:** 2026-11-17
- **Relacionados:** ADR-001, ADR-003

## Contexto

Hoje o código mistura `.ts`, `.tsx`, `.mjs` e declarações `.d.mts` avulsas. Os tipos do servidor e do cliente não são compartilhados, e mudanças de contrato quebram só em tempo de execução.

## Decisão

- Todo código novo é **TypeScript** com `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` e `verbatimModuleSyntax`.
- Todos os pacotes são **ESM** (`"type": "module"`), com `exports` explícito no `package.json`.
- **TS project references** ligam os pacotes; `tsc -b` é o typecheck do CI.
- Os arquivos `.mjs` + `.d.mts` atuais são convertidos para `.ts` ao serem movidos para os pacotes (plano v2 §7).
- Node.js na linha LTS ativa, fixada em `.nvmrc` e em `engines`.

## Consequências

- **Positivas:** tipos compartilhados entre cliente, servidor, worker, CLI e plugins; refatoração segura.
- **Negativas:** a conversão do código existente tem custo, e as flags estritas extras geram muitos erros iniciais. Mitigação: habilitar pacote a pacote, conforme cada um migra.
- O TypeScript publicado hoje como `latest` é da linha 7. A compatibilidade dele com o restante do toolchain (bundler, linter, vitest, geradores de declaração) precisa ser validada antes de fixar a versão. Se houver incompatibilidade, fixa-se a última versão compatível e registra-se a escolha neste ADR.

## Alternativas consideradas

| Alternativa | Por que foi rejeitada |
| --- | --- |
| JS + `.d.mts` avulsos (estado atual) | As declarações divergem da implementação |
| JSDoc com `checkJs` | Menos expressivo e mais verboso para o modelo de documento |
| CommonJS | Incompatível com Workers e com o ecossistema ESM do front-end |

## Versões verificadas (`npm view <pkg> version`, 17/11/2026)

| Pacote / runtime | Versão estável | Link oficial |
| --- | --- | --- |
| `typescript` | 7.0.2 (compatibilidade com o toolchain a validar) | https://www.typescriptlang.org |
| `@types/node` | 26.6.6 | https://www.npmjs.com/package/@types/node |
| `tsx` | 4.23.15 | https://tsx.is |
| Node.js LTS | versão a verificar (instalada localmente: v22.17.1) | https://nodejs.org/en/about/previous-releases |
