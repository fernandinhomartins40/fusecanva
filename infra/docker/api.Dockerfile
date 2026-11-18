# syntax=docker/dockerfile:1.7
# API do Fuse Studio. Contexto de build: raiz do repositorio.
#   docker build -f infra/docker/api.Dockerfile -t fuse-studio/api:dev .
#
# O servidor atual vive em apps/web/server (A0-03 manteve-o junto do web; A1-02 o move para
# apps/server). Ele so usa modulos nativos do Node (inclusive node:sqlite), entao a imagem final
# nao precisa de node_modules.

ARG NODE_IMAGE=node:22-alpine

# ---------------------------------------------------------------- stage 1: verificacao
FROM ${NODE_IMAGE} AS source
WORKDIR /app
COPY apps/web/server/ apps/web/server/
COPY apps/web/src/text-merge.mjs apps/web/src/text-merge.mjs
COPY infra/docker/api-entrypoint.mjs infra/docker/api-entrypoint.mjs
# Falha cedo se algum arquivo tiver erro de sintaxe ou import relativo ausente.
RUN for f in apps/web/server/*.mjs apps/web/src/text-merge.mjs infra/docker/api-entrypoint.mjs; do \
      node --check "$f" || exit 1; \
    done \
 && rm -f apps/web/server/*.md

# ---------------------------------------------------------------- stage 2: runtime
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    STUDIO_API_HOST=0.0.0.0 \
    STUDIO_DB_PATH=/data/studio.sqlite \
    STUDIO_MEDIA_OBJECT_DIR=/data/media
WORKDIR /app
RUN mkdir -p /data/media && chown -R node:node /data
COPY --from=source --chown=node:node /app /app
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "infra/docker/api-entrypoint.mjs"]
