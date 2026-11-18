# ADR-008 — Postgres com Drizzle ORM e migrações

- **Status:** Aceito (plano v2, 17/11/2026)
- **Data:** 2026-11-17
- **Relacionados:** ADR-004, ADR-007, ADR-012

## Contexto

O servidor atual usa SQLite. Para produção multi-tenant precisamos de concorrência de escrita, busca full-text, backups online, réplicas e, opcionalmente, Row-Level Security (RLS).

## Decisão

- **PostgreSQL** como banco principal de `apps/server` e de `apps/worker`.
- **Drizzle ORM** para schema tipado e queries, com **drizzle-kit** para gerar e aplicar migrações versionadas no repositório.
- Os updates Yjs dos documentos são persistidos como snapshots + updates incrementais, com compactação periódica.
- Busca full-text com `tsvector` (configurações PT-BR e EN).
- Um script de migração SQLite → Postgres preserva os dados atuais (A1-03).
- SQLite continua apenas como modo **"single-user desktop"**, atrás da mesma camada de repositório.

## Consequências

- **Positivas:** banco pronto para produção; RLS disponível como defesa em profundidade; full-text sem serviço extra.
- **Negativas:** o self-host passa a exigir um serviço Postgres (incluído no `docker compose`); manter dois dialetos (Postgres e SQLite) tem custo, então o modo SQLite cobre só o subconjunto single-user.

## Alternativas consideradas

| Alternativa | Por que foi rejeitada |
| --- | --- |
| SQLite como banco único | Limites de concorrência e de operação multi-tenant |
| MySQL/MariaDB | Full-text e JSONB inferiores para o nosso uso |
| Prisma | Engine extra e migrações menos transparentes que o SQL gerado pelo Drizzle |
| Kysely | Bom query builder, mas sem schema e migrações integrados |

## Versões verificadas (`npm view <pkg> version`, 17/11/2026)

| Pacote / serviço | Versão estável | Link oficial |
| --- | --- | --- |
| `drizzle-orm` | 0.45.4 | https://orm.drizzle.team |
| `drizzle-kit` | 0.31.11 | https://orm.drizzle.team/docs/kit-overview |
| `pg` (driver) | 8.23.1 | https://node-postgres.com |
| `postgres` (driver alternativo) | 4.1.1 | https://github.com/porsager/postgres |
| PostgreSQL (servidor) | versão a verificar | https://www.postgresql.org/support/versioning |
