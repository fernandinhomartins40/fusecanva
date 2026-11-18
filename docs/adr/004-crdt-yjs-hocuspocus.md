# ADR-004 — CRDT Yjs para todo documento, Hocuspocus no servidor e y-indexeddb no cliente

- **Status:** Aceito (plano v2, 17/11/2026)
- **Data:** 2026-11-17
- **Relacionados:** ADR-003, ADR-008, ADR-012, ADR-014, plano v2 §4 e §7

## Contexto

A colaboração atual usa merge/rebase artesanal (`text-merge.mjs`, `document-merge.mjs`, `collaboration.ts`, SSE) e exige código novo para cada tipo de operação. Conflitos ainda chegam ao usuário (HTTP 409). Os princípios do plano exigem local-first, nenhum conflito visível e undo por usuário.

## Decisão

- Todo documento vive num **`Y.Doc`** (Yjs). Mapeamento: cada `Node` é um `Y.Map`; listas ordenadas usam `Y.Array` com IDs estáveis; texto rico usa `Y.Text` com marcas como atributos.
- No servidor, **Hocuspocus** (WebSocket) com persistência em Postgres (ADR-008), autenticação pelo token de sessão e autorização pelo módulo `authz` (ADR-012).
- No cliente, **`y-indexeddb`** para persistência offline e **awareness** para presença (cursor, seleção, seguir).
- Undo por usuário com `Y.UndoManager` restrito às origens locais.
- O código de merge atual é aposentado depois que os testes de colaboração forem portados e estiverem verdes, com feature flag por tipo de documento durante a transição.

## Consequências

- **Positivas:** coedição, offline e undo por usuário resolvidos de forma genérica; o protocolo é aberto e documentado.
- **Negativas:** o histórico do CRDT cresce e exige snapshots e compactação; invariantes do modelo (por exemplo, um nó com dois pais) precisam de normalização depois do merge; os dados atuais exigem um migrador com teste de roundtrip.

## Alternativas consideradas

| Alternativa | Por que foi rejeitada |
| --- | --- |
| Manter OT/rebase próprio | Custo linear por feature; conflitos visíveis |
| Automerge | Viável, mas com menos providers e bindings de editor que o Yjs |
| Servidor autoritativo com locks | Não funciona offline |

## Versões verificadas (`npm view <pkg> version`, 17/11/2026)

| Pacote | Versão estável | Link oficial |
| --- | --- | --- |
| `yjs` | 13.6.33 | https://docs.yjs.dev |
| `y-protocols` | 1.0.7 | https://github.com/yjs/y-protocols |
| `y-indexeddb` | 9.0.12 | https://github.com/yjs/y-indexeddb |
| `@hocuspocus/server` | 4.8.0 | https://tiptap.dev/docs/hocuspocus |
| `@hocuspocus/provider` | 4.8.0 | https://tiptap.dev/docs/hocuspocus |
| `@hocuspocus/extension-database` | 4.8.0 | https://tiptap.dev/docs/hocuspocus |
