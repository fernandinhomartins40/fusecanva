# Registros de decisão de arquitetura (ADRs)

Decisões de arquitetura do Fuse Studio no formato [MADR](https://adr.github.io/madr/): contexto, decisão, consequências e alternativas consideradas. A origem é o §2 do [plano v2](../v2/02-PLANO-V2.md).

As versões de dependências foram verificadas com `npm view <pacote> version` em 17/11/2026. Serviços e binários fora do npm (PostgreSQL, Redis, MinIO, FFmpeg, Ollama, ComfyUI, Node.js LTS) estão marcados como **versão a verificar** e devem ser fixados pelo agente que criar a infraestrutura correspondente.

## Índice

| ADR | Título | Status |
| --- | --- | --- |
| [001](001-monorepo-pnpm-turborepo.md) | Monorepo com pnpm workspaces e Turborepo | Aceito |
| [002](002-typescript-strict-esm.md) | TypeScript strict e ESM em todo o código | Aceito |
| [003](003-modelo-documento-zod-json-schema.md) | Modelo de documento em Zod → JSON Schema, com migrações puras | Aceito |
| [004](004-crdt-yjs-hocuspocus.md) | CRDT Yjs, Hocuspocus no servidor e y-indexeddb no cliente | Aceito |
| [005](005-renderer-unico-canvas2d.md) | Renderer próprio sobre Canvas 2D com `RenderBackend` | Aceito |
| [006](006-texto-harfbuzz.md) | Layout de texto próprio sobre HarfBuzz (wasm) e fontes OFL | Aceito |
| [007](007-backend-fastify-modular.md) | Back-end Node com Fastify em módulos de domínio | Aceito |
| [008](008-postgres-drizzle.md) | Postgres com Drizzle ORM e migrações | Aceito |
| [009](009-armazenamento-s3.md) | Armazenamento S3-compatível com URLs pré-assinadas e SHA-256 | Aceito |
| [010](010-filas-redis-bullmq-workers.md) | Filas Redis + BullMQ e workers separados | Aceito |
| [011](011-autenticacao-better-auth-sso.md) | Autenticação com Better Auth, OIDC/SAML e cookie httpOnly | Aceito |
| [012](012-autorizacao-rebac.md) | Autorização ReBAC num único módulo `authz` | Aceito |
| [013](013-ui-react-design-system.md) | UI com React 19 e design system próprio | Aceito |
| [014](014-estado-editor-zustand-ydoc.md) | Estado do editor em store Zustand derivada do Y.Doc | Aceito |
| [015](015-plugins-iframe-sandbox.md) | Plugins em iframe sandbox com RPC tipado e permissões | Aceito |
| [016](016-ia-gateway.md) | IA via `ai-gateway` multi-provider com políticas por org | Aceito |
| [017](017-video-composicao-ffmpeg.md) | Vídeo declarativo, render no worker com FFmpeg, preview WebCodecs | Aceito |
| [018](018-i18n-icu-formatjs.md) | i18n com ICU MessageFormat (FormatJS) | Aceito |
| [019](019-observabilidade-opentelemetry.md) | Observabilidade com OpenTelemetry | Aceito |
| [020](020-licenca-agpl-mit.md) | Licença AGPL-3.0 (app) e MIT (SDK, formato, CLI) | **Proposto — decisão do mantenedor** |

## Pendências registradas nos ADRs

- **ADR-002:** validar a compatibilidade do TypeScript 7.x (`latest` no npm) com o toolchain antes de fixá-lo.
- **ADR-009:** revisar a licença e a distribuição do MinIO antes de adotá-lo como padrão do self-host.
- **ADR-010:** confirmar a licença do servidor Redis adotado (fork aberto compatível, como Valkey, é aceitável).
- **ADR-017:** documentar o build do FFmpeg e as implicações de codecs.
- **ADR-020:** aprovação do mantenedor (licenças, `-only` ou `-or-later`, DCO ou CLA, política de marca).

## Como propor um novo ADR

1. Copie o ADR mais próximo e use o próximo número livre (`NNN-titulo-curto.md`).
2. Preencha status (`Proposto`), contexto, decisão, consequências, alternativas e versões verificadas (com o comando e a data).
3. Abra um PR. Quando aprovado, o status muda para `Aceito`. Um ADR substituído recebe `Substituído por ADR-NNN` e não é apagado.
