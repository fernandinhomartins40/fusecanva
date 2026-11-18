# ADR-007 — Back-end Node com Fastify, organizado em módulos de domínio

- **Status:** Aceito (plano v2, 17/11/2026)
- **Data:** 2026-11-17
- **Relacionados:** ADR-002, ADR-008, ADR-011, ADR-012, plano v2 §7

## Contexto

O servidor atual é um único `server/index.mjs` de 278 KB sobre `node:http`, com roteamento, validação e autorização misturados. Isso impede o trabalho paralelo e a revisão de segurança.

## Decisão

- **Fastify** como framework HTTP de `apps/server`.
- Um plugin Fastify por módulo de domínio: `auth, authz, org, docs, media, comments, notifications, audit, sites, print, ai-gateway, plugins`. Cada módulo tem rotas, serviço e repositório próprios.
- Validação de entrada e saída por schema; a especificação **OpenAPI** é gerada das rotas (`@fastify/swagger`) e alimenta `packages/api-client`.
- O WebSocket de colaboração (Hocuspocus, ADR-004) roda no mesmo processo, ou em processo dedicado quando escalar.
- A desmontagem do monólito (A1-02) usa os testes de API atuais como rede de segurança.

## Consequências

- **Positivas:** fronteiras claras por domínio; validação por schema; ecossistema de plugins (cookie, CORS, rate limit, multipart).
- **Negativas:** custo de migração das rotas atuais; o time precisa conhecer o ciclo de vida de plugins e hooks do Fastify.

## Alternativas consideradas

| Alternativa | Por que foi rejeitada |
| --- | --- |
| `node:http` monolítico (estado atual) | Sem estrutura nem validação |
| Express | Sem validação por schema nativa; desempenho menor |
| NestJS | Mais cerimônia (decorators, DI) do que o necessário |
| Hono | Viável, mas com menos plugins prontos para o servidor Node que precisamos |

## Versões verificadas (`npm view <pkg> version`, 17/11/2026)

| Pacote | Versão estável | Link oficial |
| --- | --- | --- |
| `fastify` | 5.12.8 | https://fastify.dev |
| `@fastify/swagger` | 9.9.5 | https://github.com/fastify/fastify-swagger |
| `@fastify/websocket` | 11.3.7 | https://github.com/fastify/fastify-websocket |
| `@fastify/cookie` | 11.1.5 | https://github.com/fastify/fastify-cookie |
