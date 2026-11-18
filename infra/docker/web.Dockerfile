# syntax=docker/dockerfile:1.7
# Front-end do Fuse Studio (build estatico servido por nginx sem root).
# Contexto de build: raiz do repositorio.
#   docker build -f infra/docker/web.Dockerfile -t fuse-studio/web:dev .

ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.29-alpine

# ---------------------------------------------------------------- stage 1: dependencias
FROM ${NODE_IMAGE} AS deps
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
# Somente manifestos primeiro, para reaproveitar o cache de camadas.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@fuse/web..." --store-dir /pnpm/store

# ---------------------------------------------------------------- stage 2: build
FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/web/ apps/web/
RUN pnpm --filter @fuse/web run build

# ---------------------------------------------------------------- stage 3: runtime
FROM ${NGINX_IMAGE} AS runtime
COPY infra/docker/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=6 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
