# Infra local (Docker)

Stack de desenvolvimento do Fuse Studio: os serviços de apoio rodam em containers, e o app
pode rodar no host (mais rápido para editar) ou também em containers (perfil `app`).

| Serviço      | Imagem padrão                                  | Porta no host (127.0.0.1)        | Para quê                                  |
| ------------ | ---------------------------------------------- | -------------------------------- | ----------------------------------------- |
| `postgres`   | `postgres:17-alpine`                           | 5432                             | Banco principal da v2 (ADR-008)           |
| `minio`      | `minio/minio:RELEASE.2025-04-22T22-12-26Z`     | 9000 (S3), 9001 (console)        | Mídia S3-compatível (ADR-009)             |
| `minio-init` | `minio/mc:RELEASE.2025-04-16T18-13-26Z`        | —                                | Cria o bucket `S3_BUCKET` e sai           |
| `redis`      | `redis:8.2-alpine`                             | 6379                             | Filas BullMQ / cache (ADR-010)            |
| `mailpit`    | `axllent/mailpit:v1.27`                        | 1025 (SMTP), 8025 (UI)           | Captura todo e-mail enviado em dev        |
| `api`*       | build de `api.Dockerfile`                      | 8787                             | API atual (`apps/web/server`)             |
| `web`*       | build de `web.Dockerfile`                      | 8080                             | Build estático + proxy `/api` (nginx)     |

\* só com `--profile app`.

Todos os serviços têm healthcheck e volume nomeado (`postgres-data`, `minio-data`,
`redis-data`, `mailpit-data`, `api-data`). Portas são publicadas só em `127.0.0.1` e podem
ser trocadas pelas variáveis `*_HOST_PORT` do `.env`. Imagens podem ser trocadas por
`POSTGRES_IMAGE`, `MINIO_IMAGE`, `MINIO_MC_IMAGE`, `REDIS_IMAGE` e `MAILPIT_IMAGE`.

## Pré-requisitos

- Docker Engine 24+ com Compose v2 (Docker Desktop no Windows/macOS).
- Node 22.12+ e pnpm 10 (para rodar o app no host).

## Começo rápido

```sh
cp .env.example .env                      # na raiz do repositório
pnpm install

# Opção A: infraestrutura em Docker + web e API no host, tudo num comando
node infra/docker/dev-all.mjs             # (vira `pnpm dev:all` quando o script for registrado na raiz)

# Opção B: só a infraestrutura
docker compose -f infra/docker/docker-compose.yml --env-file .env up -d --wait

# Opção C: tudo em containers (app em http://localhost:8080)
docker compose -f infra/docker/docker-compose.yml --env-file .env --profile app up -d --build --wait
```

`dev-all.mjs` sobe a infraestrutura com `--wait` (bloqueia até os healthchecks passarem),
carrega o `.env` da raiz e inicia o Vite (`:5173`) e a API (`:8787`) com saída prefixada.
Opções: `--no-infra` (não chama o Docker) e `--down` (derruba os containers ao sair).

Endereços úteis:

- App (host): http://localhost:5173 · App (container): http://localhost:8080
- Console do MinIO: http://127.0.0.1:9001 (usuário/senha = `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`)
- Caixa do Mailpit: http://127.0.0.1:8025
- Postgres: `psql postgres://fuse:fuse-dev-password@127.0.0.1:5432/fuse`

## Comandos do dia a dia

```sh
C="docker compose -f infra/docker/docker-compose.yml --env-file .env"
$C ps                      # estado e saúde
$C logs -f api             # logs de um serviço
$C down                    # para tudo, mantém os volumes
$C down -v                 # para tudo e APAGA os dados (bancos, bucket, e-mails)
$C config                  # valida o arquivo e mostra a configuração resolvida
```

## Imagens do app

Os dois Dockerfiles usam a **raiz do repositório** como contexto e têm um
`<Dockerfile>.dockerignore` próprio em modo allowlist — isso impede que o material de
pesquisa local (vários GB, fora do controle de versão) entre no contexto de build.

- `api.Dockerfile` (2 estágios): verifica a sintaxe dos módulos e gera uma imagem Node sem
  `node_modules` (o servidor atual só usa módulos nativos, inclusive `node:sqlite`). Roda como
  usuário `node`, guarda SQLite e mídia em `/data`.
- `web.Dockerfile` (3 estágios): instala dependências com pnpm (`--frozen-lockfile`, cache
  BuildKit), roda `pnpm --filter @fuse/web build` e serve `apps/web/dist` com
  `nginx-unprivileged` na porta 8080. `nginx/web.conf` faz fallback de SPA, cache longo de
  `/assets/` e proxy de `/api/` sem buffer (necessário para os streams SSE de colaboração).

```sh
docker build -f infra/docker/api.Dockerfile -t fuse-studio/api:dev .
docker build -f infra/docker/web.Dockerfile -t fuse-studio/web:dev .
```

## Estado de transição (onda 0)

- O servidor atual ainda usa **SQLite + disco**. `DATABASE_URL`, `S3_*`, `REDIS_URL` e
  `SMTP_*` já são definidos e repassados ao container, mas só passam a ter efeito com os
  módulos da onda 1 (A1-02/A1-03 para Postgres e S3, workers para Redis).
- O servidor faz `listen(port, '127.0.0.1')`. Para ser alcançável dentro do Docker,
  `api-entrypoint.mjs` troca esse host por `STUDIO_API_HOST` (padrão `0.0.0.0` na imagem)
  sem alterar o código do app. Remover quando o servidor ler o host do ambiente.
- E-mail: hoje o único provedor do app é HTTP (`STUDIO_EMAIL_PROVIDER=resend`). O Mailpit já
  está pronto para o transporte SMTP da v2 (`SMTP_URL`).
- A MinIO parou de publicar imagens novas da edição comunitária em 2025; a tag está fixada na
  última versão estável conhecida. Qualquer armazenamento S3-compatível pode substituí-la.

## Segurança

As credenciais do `.env.example` são exclusivas de desenvolvimento. Não exponha estas
portas fora de `127.0.0.1` sem trocar senhas, e nunca coloque chaves de IA ou de provedores
em variáveis `VITE_*` — elas iriam para o bundle do navegador.
