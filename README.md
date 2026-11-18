# Fuse Studio

> Suite de design visual **aberta, local-first e auto-hospedável**.

Fuse Studio permite criar designs, documentos, apresentações, quadros brancos, planilhas, vídeos e sites, com colaboração em tempo real, IA com a sua própria chave ou com modelo local, e um formato de arquivo aberto (`.fuse`), sem aprisionamento a fornecedor.

## Status

**Pré-alpha.** O projeto está na **Onda 0** (fundação e higiene) do [plano v2](docs/v2/02-PLANO-V2.md). A aplicação em `apps/web` já roda localmente, mas as APIs, o formato `.fuse` e a estrutura de pacotes ainda vão mudar sem aviso. Não use em produção.

| Marco | Onda | Situação |
| --- | --- | --- |
| Fundação (monorepo, CI, infra local, ADRs, spec `.fuse` v1) | 0 | em andamento |
| Núcleo do editor (renderer único, texto, CRDT Yjs) | 1 | planejado |
| **Alpha** (editores de conteúdo) | 2 | planejado |
| **Beta** (IA, lote, plugins, equipe) | 4 | planejado |
| **1.0** (endurecimento e GA) | 6 | planejado |

## Por que o Fuse Studio

- **Formato aberto `.fuse`**: especificado com JSON Schema e com migrações de versão. Qualquer ferramenta pode ler e gravar o formato.
- **Local-first**: toda edição funciona offline, e a nuvem só sincroniza.
- **Auto-hospedável**: `docker compose` para desenvolvimento; Helm previsto para a versão 1.0.
- **IA sem aprisionamento**: use a sua própria chave de qualquer provedor compatível ou um modelo local.
- **Plugins abertos**: SDK em iframe isolado, com permissões declaradas.
- **Exportação profissional e linha de comando**: o mesmo renderer desenha o editor, o export e o modo headless (`fuse render`).

## Como rodar

Pré-requisitos: **Node.js 22.12+**, **pnpm 10** (via Corepack) e, para os serviços de apoio, **Docker** com Compose v2.

```sh
corepack enable            # ativa o pnpm fixado em package.json
pnpm install
cp .env.example .env       # variáveis locais (nunca versione o .env)

pnpm dev                   # front-end (Vite) em http://localhost:5173
pnpm dev:api               # API atual em http://localhost:8787 (outro terminal)
```

Para subir também Postgres, MinIO, Redis e Mailpit, siga [infra/docker/README.md](infra/docker/README.md):

```sh
node infra/docker/dev-all.mjs   # infraestrutura em Docker + web e API no host
```

Verificações (as mesmas do CI):

```sh
pnpm lint        # oxlint + lint de fronteiras entre pacotes
pnpm typecheck
pnpm test
pnpm build
```

> No Windows sem permissão de administrador, `corepack enable` pode falhar com `EPERM`. Use `corepack enable --install-directory "%APPDATA%\npm" pnpm`.

## Estrutura

Monorepo com pnpm workspaces e Turborepo ([ADR-001](docs/adr/001-monorepo-pnpm-turborepo.md)). Pacotes só se comunicam pela API pública (`src/index.ts`), e o `pnpm lint` barra imports profundos.

```text
apps/
  web/          PWA React (shell e editores); a API atual está em apps/web/server
  worker/       tarefas pesadas: export, mídia (FFmpeg), IA, thumbnails
  cli/          `fuse`: render, convert e validate headless
  docs-site/    documentação pública (formato, SDK, self-host)
packages/
  format/       @fuse/format: schemas, JSON Schema e migrações do .fuse
  sdk/          @fuse/sdk: API para plugins
  collab/       Yjs: coedição, presença e undo por usuário
  geometry/ text/ renderer/ editor-core/        núcleo do editor
  editor-design/ editor-doc/ editor-sheet/ editor-whiteboard/ editor-video/ editor-site/
  formula/ image-ops/ io-office/ io-export/ brand/ bulk/ ai-client/
  api-client/ authz/ i18n/ ui/ test-kit/
infra/docker/   stack local (Postgres, MinIO, Redis, Mailpit)
docs/
  v2/           análise, plano v2 e fichas dos agentes
  adr/          registros de decisão de arquitetura
  backlog/      user stories por domínio
tooling/        lint de fronteiras
scripts/        verificações do repositório (encoding, higiene)
```

A descrição completa de cada pacote está no §3 do [plano v2](docs/v2/02-PLANO-V2.md#3-estrutura-do-monorepo).

## Documentação

| Documento | Conteúdo |
| --- | --- |
| [docs/v2/01-ANALISE-PONTA-A-PONTA.md](docs/v2/01-ANALISE-PONTA-A-PONTA.md) | Diagnóstico do código atual |
| [docs/v2/02-PLANO-V2.md](docs/v2/02-PLANO-V2.md) | Visão, princípios, arquitetura, Definição de Pronto e roadmap |
| [docs/v2/03-AGENTES-OPUS.md](docs/v2/03-AGENTES-OPUS.md) | Divisão do trabalho por onda e por agente |
| [docs/adr/](docs/adr/README.md) | ADRs 001 a 020 |
| [docs/backlog/](docs/backlog/README.md) | User stories por domínio |

## Licenças

O Fuse Studio usa duas licenças, conforme o [ADR-020](docs/adr/020-licenca-agpl-mit.md).

| Licença | Arquivo | Aplica-se a |
| --- | --- | --- |
| **AGPL-3.0-only** | [LICENSE](LICENSE) | Todo o repositório, **exceto** os itens da linha abaixo: `apps/web`, `apps/worker`, `apps/docs-site`, o futuro `apps/server` e todos os demais `packages/*` |
| **MIT** | [LICENSE-MIT](LICENSE-MIT) | `packages/format` (`@fuse/format`), `packages/sdk` (`@fuse/sdk`) e `apps/cli` (`@fuse/cli`) |

Por que duas licenças:

- A **AGPL-3.0** protege o aplicativo e o servidor. Quem oferecer o Fuse Studio modificado como serviço em rede precisa publicar o código das modificações (seção 13 da licença).
- A **MIT** cobre o formato, o SDK de plugins e a linha de comando. Assim, qualquer pessoa ou empresa pode ler e gravar arquivos `.fuse` e escrever plugins e integrações sob a licença que quiser.
- Um pacote MIT **não pode depender** de um pacote AGPL. O CI verifica essa fronteira.

O campo `license` de cada `package.json` indica a licença do pacote. Em caso de divergência, vale o `package.json` do pacote.

> **Decisão pendente do mantenedor.** O ADR-020 ainda está como *Proposto*. Faltam definir: (a) aprovação final do par AGPL/MIT, (b) `-only` ou `-or-later`, (c) DCO ou CLA, (d) política de marca. O nome "Fuse Studio" e o logotipo **não** são licenciados pelas licenças de código.

## Contribuindo

Leia o [CONTRIBUTING.md](CONTRIBUTING.md), que tem um roteiro para o primeiro PR em 15 minutos, além do [Código de Conduta](CODE_OF_CONDUCT.md) e da [governança](GOVERNANCE.md). Para relatar vulnerabilidades, siga o [SECURITY.md](SECURITY.md) e **não** abra issue pública.

**Propriedade intelectual:** o Fuse Studio é um produto próprio. Não aceitamos código, textos, nomes, ícones, cores, layouts ou assets copiados de produtos de terceiros. O material de pesquisa local (`analysis/`, `visual-references/`) **não faz parte** do produto nem do repositório público.
