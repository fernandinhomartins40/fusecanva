# ADR-003 — Modelo de documento em Zod, exportado como JSON Schema, com migrações puras

- **Status:** Aceito (plano v2, 17/11/2026)
- **Data:** 2026-11-17
- **Relacionados:** ADR-002, ADR-004, ADR-015, plano v2 §4

## Contexto

O formato `.fuse` é um diferencial do produto: precisa ser aberto, documentado, validável fora do app e estável entre versões. Os tipos TS soltos de hoje não validam dados em tempo de execução, e não existe versionamento de schema.

## Decisão

- O pacote `@fuse/format` define todos os nós e tipos de documento com **Zod**. Os tipos TS são inferidos dos schemas (`z.infer`).
- O **JSON Schema** é gerado a partir dos schemas Zod e publicado na documentação do formato. A preferência é a conversão nativa do Zod 4 (`z.toJSONSchema`); `zod-to-json-schema` só entra se faltar algum recurso.
- Todo arquivo tem `format: 'fuse'` e `schemaVersion: number`. As migrações são **funções puras** `v(n) → v(n+1)`, testadas com fixtures, e `migrate()` aplica a cadeia.
- Arquivo em disco: zip com `document.json`, `assets/<sha256>` e `thumbnail.png`.
- `PluginNode` guarda dados opacos, validados pelo schema que o plugin dono declara no manifest (ADR-015).

## Consequências

- **Positivas:** um só contrato para editor, servidor, API, CLI e plugins; validação nas fronteiras (import, API e plugins); terceiros podem ler `.fuse` sem o nosso código.
- **Negativas:** toda mudança de schema exige migração e bump de versão; os schemas precisam continuar compatíveis com o mapeamento CRDT (ADR-004).

## Alternativas consideradas

| Alternativa | Por que foi rejeitada |
| --- | --- |
| Tipos TS soltos | Sem validação em runtime nem schema publicável |
| JSON Schema escrito à mão + gerador de tipos | Dupla manutenção ou experiência pior no código TS |
| Protobuf / FlatBuffers | Binário menos legível; pior para um formato aberto |

## Versões verificadas (`npm view <pkg> version`, 17/11/2026)

| Pacote | Versão estável | Link oficial |
| --- | --- | --- |
| `zod` | 4.6.7 | https://zod.dev |
| `zod-to-json-schema` (opcional) | 3.25.2 | https://github.com/StefanTerdell/zod-to-json-schema |
