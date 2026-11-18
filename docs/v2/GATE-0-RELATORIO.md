# Relatório do Gate 0 (A0-INT)

Data: 18/11/2026. Verificação local em Windows 10, Node v22.17.1, pnpm 10.34.9. Nenhum commit nem push foi feito.

## Resumo

Todos os comandos locais do Gate 0 passaram depois de duas correções simples de integração. Duas partes do gate não puderam ser comprovadas nesta máquina: o CI real no GitHub Actions, porque o repositório ainda não tem commits, e o `docker compose up`, porque o Docker Desktop estava desligado.

## Situação por agente

| Agente | Status | Entregas |
| --- | --- | --- |
| A0-01 Higiene | Concluído | `.gitignore` (ignora `analysis/`, `visual-references/`, segredos e artefatos de build), `scripts/repo-hygiene/check.mjs` |
| A0-02 Encoding | Concluído, com correção do integrador | `.editorconfig`, `.gitattributes`, `scripts/check-encoding.mjs`, mojibake corrigido nos três `IMPLEMENTATION-*` |
| A0-03 Monorepo | Concluído | `web/` foi movido para `apps/web`; pnpm workspaces + Turborepo; `tsconfig.base.json` strict; 25 pacotes esqueleto e `apps/worker`, `apps/cli` e `apps/docs-site`; `tooling/check-boundaries.mjs` |
| A0-04 CI/CD | Concluído, sem execução real | `.github/workflows/{ci,e2e,security}.yml`, scripts de shard e de licenças, templates, dependabot |
| A0-05 Infra local | Parcial | `infra/docker/` (compose, Dockerfiles, nginx, `dev-all.mjs`) e `.env.example`; o compose foi validado com `config`, mas a stack não chegou a subir |
| A0-06 ADRs | Concluído | `docs/adr/001` a `020` e o índice; o ADR-020 (licença) aguarda o mantenedor |
| A0-07 Backlog | Concluído | `docs/backlog/` com 156 histórias e rastreabilidade dos 131 casos |
| A0-08 `@fuse/format` | Concluído | Schemas Zod, JSON Schema v1, pacote `.fuse` em zip, migração e conversão do formato antigo; 219 testes |
| A0-09 `@fuse/ui` e `@fuse/i18n` | Concluído | Tokens, 25 componentes, testes de contraste e axe, catálogos pt-BR e en; 126 + 14 testes |
| A0-10 Kit open source | Concluído | `LICENSE` (AGPL-3.0), `LICENSE-MIT`, `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `GOVERNANCE.md` |

## Correções do integrador

1. **`scripts/check-encoding.mjs`: lista de exceções desatualizada.** A lista ainda apontava para `web/...` e não acompanhou a mudança para `apps/web/...`. Corrigi os três caminhos.
2. **Mojibake e BOM em 21 arquivos de `apps/web`.** Rodei `node scripts/check-encoding.mjs --fix` e depois removi o BOM dos arquivos em que a única falha era o BOM, porque o `--fix` não regrava um arquivo cujo texto não mudou. A correção só converte de volta texto corrompido em CP1252/UTF-8 e não altera a lógica. As cópias originais estão em `C:/Users/USURIO~2/AppData/Local/Temp/claude/c--Users-Usu-rio-Desktop-fusecanva/361e1652-347e-4975-8f4a-f35be4f04d56/scratchpad/backup-int/`.
   - Em `apps/web/server/`: `index.mjs` e `email-provider.mjs`.
   - Em `apps/web/src/`: `persistence.ts`, `BulkCreatePanel.tsx` e `BrandAssistantReview.tsx`.
   - Em `apps/web/tests/`: `api`, `bulk-create`, `pptx-import`, `sheet` e `whiteboard-connector-drag-static`.
   - Em `apps/web/scripts/`: 11 scripts `check-*-browser.mjs` e `check-sheet-debug.mjs`.
3. **`package.json` da raiz.** Acrescentei o script `"dev:all": "node infra/docker/dev-all.mjs"`, que o A0-05 tinha pedido.

## Comandos executados

| Comando | Resultado | Trecho da saída |
| --- | --- | --- |
| `node scripts/check-encoding.mjs` (antes) | Falhou | `508 files scanned, 226 problem(s)` |
| `node scripts/check-encoding.mjs` (depois das correções) | Passou (exit 0) | `508 files scanned, 0 problem(s), 6 line(s) with U+FFFD (lost characters, warning only)` |
| `node scripts/repo-hygiene/check.mjs` | Passou (exit 0) | `578 versionable files, 5.74 MB total (limit 5 MB/file)` / `repo-hygiene: OK` |
| `pnpm install --frozen-lockfile` | Passou (exit 0) | `Done in 2s using pnpm v10.34.9`, com aviso de que o script de build do core-js foi ignorado |
| `pnpm build` | Passou (exit 0) | `Tasks: 29 successful, 29 total`; vite `✓ built in 1.46s` |
| `pnpm typecheck` | Passou (exit 0) | `Tasks: 29 successful, 29 total` |
| `pnpm lint` | Passou (exit 0) | `check-boundaries: ok` |
| `pnpm test --force` (sem cache) | Passou (exit 0) | `@fuse/format` 219 passed; `@fuse/ui` 126 passed; `@fuse/i18n` 14 passed; `@fuse/web` `# tests 295 # pass 295 # fail 0`; `Tasks: 4 successful, 4 total` |
| Validação dos 7 YAML de `.github/` (parser `yaml@2.8.1`, com checagem de `on`, `jobs`, `runs-on` e `steps`) | Passou (exit 0) | `7 arquivos, 0 falha(s)` |
| `node docs/backlog/verificar-rastreabilidade.mjs` | Passou | `OK` |
| `docker info` | Falhou | `failed to connect to the docker API ... dockerDesktopLinuxEngine` |
| `actionlint` | Não disponível | Não está instalado |

Durante os testes do web apareceu várias vezes a mensagem `WebSocket server error: Port 24678 is already in use`. Ela vem da porta de HMR do Vite, que já estava ocupada por outro processo, e não fez nenhum teste falhar.

## Critérios do Gate 0 (plano v2 §8)

| Critério | Situação |
| --- | --- |
| `pnpm i && pnpm build && pnpm test` verdes | **Verde localmente.** No CI ainda não foi comprovado, porque não há commit nem push |
| `docker compose up` sobe a stack | **Não verificado.** O Docker estava desligado; só o `docker compose config` foi validado (A0-05) |
| Spec `.fuse` publicada | **Sim.** `packages/format/README.md` e `packages/format/schema/fuse-file.v1.schema.json` |

## Pendências

1. **CI real.** Depende do primeiro push, que é decisão do mantenedor. A pasta `analysis/` já está ignorada.
2. **Docker.** Com o Docker Desktop ligado, falta rodar `docker compose -f infra/docker/docker-compose.yml --env-file .env.example up -d --wait` e depois o mesmo com `--profile app --build`.
3. **ADR-020 (licença).** O mantenedor ainda precisa decidir quatro pontos: o par AGPL/MIT, `-only` ou `-or-later`, DCO ou CLA e a política de marca.
4. **Nomes de terceiros em arquivos versionáveis.** Há cerca de 40 arquivos com essas ocorrências, entre eles 14 em `apps/web/src`, 10 em `apps/web/scripts`, os scripts `scripts/record-*.mjs`, os `IMPLEMENTATION-*`, `VISUAL-REFERENCE-INDEX.csv` e `docs/backlog/rastreabilidade.csv`. A limpeza cabe ao A1-01 e à revisão de marca antes do push público. Também falta decidir se os registros históricos (`IMPLEMENTATION-*`, `scripts/record-*`, `VISUAL-REFERENCE-INDEX.csv`) devem mesmo entrar no repositório público.
5. **`apps/web/IMPLEMENTATION-STATUS.json` tem 0 bytes** e não é um JSON válido. É preciso apagá-lo ou preenchê-lo.
6. **Pasta `web/` vazia na raiz.** Pode ser apagada quando nenhum processo estiver usando a pasta.
7. **Raiz.** O `.gitignore` ainda tem `/web/artifacts/`, que ficou inofensivo porque o `apps/web/.gitignore` já cobre `artifacts/`.
8. **O `apps/web` ainda não herda o `tsconfig.base.json`.** Isso gera cerca de 846 erros e fica para o A1-01.
9. **`turbo.json` não considera `scripts/` nos inputs de build**, o que afeta o `build-css.mjs` do `@fuse/ui`.
10. **Testes de navegador (`test:browser:*`) e axe/Lighthouse no CI** ainda não foram executados.
11. **Caracteres já perdidos.** São 82 caracteres U+FFFD em `IMPLEMENTATION-PLAN.md`, que precisam ser reescritos à mão.

## Recomendação

**Pode iniciar a Onda 1: sim.**

O ambiente local está verde: instalação, build, typecheck, lint, testes de todos os pacotes e do app, encoding, higiene e sintaxe dos workflows. A Onda 1 trabalha sobre esse código e não depende do Docker nem do push. Duas coisas precisam ser fechadas antes do A1-03 (Postgres/MinIO) e antes de declarar o Gate 0 encerrado de vez: subir a stack com `docker compose up` e ter a primeira execução verde do CI no GitHub.
