# ADR-012 — Autorização com modelo ReBAC simples num único módulo `authz`

- **Status:** Aceito (plano v2, 17/11/2026)
- **Data:** 2026-11-17
- **Relacionados:** ADR-004, ADR-007, ADR-011

## Contexto

As checagens de permissão estão espalhadas pelas rotas do servidor, o que gera inconsistências (uma rota permite o que outra nega). A colaboração em tempo real, a API, os comentários e os plugins precisam da mesma resposta para "este usuário pode fazer X neste recurso?".

## Decisão

- Modelo **ReBAC** (controle de acesso baseado em relações) com a hierarquia **org → team → folder → doc**.
- Papéis: `owner`, `editor`, `commenter`, `viewer`, mais **link público** (somente leitura ou comentário, com expiração opcional).
- As permissões herdam pela hierarquia; o papel efetivo é o maior entre os concedidos diretamente e os herdados.
- `packages/authz` contém as regras puras (sem I/O), compartilhadas por servidor, Hocuspocus, worker e cliente (o cliente só usa para esconder controles; a decisão é sempre do servidor).
- O módulo `authz` do servidor resolve as relações no Postgres, com cache curto por request.
- Testes de tabela (papel × ação × recurso) são obrigatórios.

## Consequências

- **Positivas:** uma fonte de verdade para ACL; fácil de auditar e testar.
- **Negativas:** o modelo simples não cobre políticas por atributo (ABAC); se elas forem necessárias, entram como extensão do módulo.

## Alternativas consideradas

| Alternativa | Por que foi rejeitada |
| --- | --- |
| Checagens espalhadas (estado atual) | Inconsistentes e difíceis de auditar |
| Serviço externo estilo Zanzibar (OpenFGA, SpiceDB) | Mais um serviço no self-host; complexo demais para o modelo atual |
| RBAC plano por organização | Não expressa compartilhamento por pasta e por documento |

## Versões

Não há dependência externa: o módulo é código próprio. Referência conceitual: https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/
