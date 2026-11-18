# @fuse/format

Formato aberto `.fuse` v1 do Fuse Studio: schemas Zod, JSON Schema publicado, migrações puras, (de)serialização
do pacote zip e migrador do formato atual do app (IndexedDB / SQLite `documents.data_json`).

Licença: MIT (ADR-020). Sem dependência de DOM/Node além de Web Crypto (`crypto.subtle`), `atob`/`btoa` e JSZip.

## Pacote em disco

Um arquivo `.fuse` é um zip (`application/vnd.fuse-studio.document+zip`):

| Entrada | Conteúdo |
| --- | --- |
| `document.json` | `FuseFile` (JSON, UTF-8). Validado por `schema/fuse-file.v1.schema.json`. |
| `assets/<sha256>` | Binário do ativo; o nome é o SHA-256 (hex minúsculo) do conteúdo e é verificado na leitura. |
| `thumbnail.png` | Miniatura opcional. |

Dentro do documento, ativos empacotados são referenciados pela URI `fuse-asset:<sha256>`. O empacotador extrai
data: URLs base64 (canônicas) para `assets/` e registra um `AssetRef` `sha256:<hash>`; `unpackFuse(..., { inlineDataUrls: true })`
faz o caminho inverso com roundtrip exato. As entradas do zip usam data fixa: o mesmo conteúdo gera os mesmos bytes.

## Modelo (schemaVersion = 1)

```
FuseFile = { format: 'fuse', schemaVersion: 1, id, kind, meta, pages[], doc?, sheets?, timeline?, site?, assets, styles, extensions? }
kind     = design | presentation | doc | whiteboard | sheet | video | site
Page     = { id, name, width, height, background: Paint, hidden?, notes?, children: Node[], extensions? }
Node     = Frame | Group | Shape | Path | Text | Image | Video | Audio | Sticky | Connector | Table | Chart | Embed | QR | PluginNode
```

- **Coordenadas:** `x/y` relativos ao Frame ancestral mais próximo (ou à página). Grupos não criam espaço de coordenadas.
  Rotação em graus, horário. Conectores não têm caixa: ligam `from.nodeId` → `to.nodeId` com âncora normalizada opcional.
- **DocBody:** `sections[]` (`{ pageId, blocks[] }`), blocos com marcas inline e tabelas (`table.rows`, mesclagens, bordas por célula `"linha:coluna"`).
- **Sheet:** grade esparsa — `cells` só guarda células com `input` ou `format`, chave A1 (`B12`). `rowCount/columnCount` dão as dimensões.
- **Timeline:** `clips[]` com `pageId` (cena), faixa, trims, volume, fades e keyframes com easing.
- **SiteMeta:** navegação (ordem de páginas), SEO, favicon, idioma.
- **AssetRef:** `sha256`, `mime`, dimensões/duração, licença (SPDX), origem, escopo de biblioteca.
- **styles:** tokens locais de cor, estilo de texto e efeito; `meta.brandKitId` vincula um kit de marca.
- **Comentários** não fazem parte do arquivo (vivem no servidor).

Regras entre campos verificadas por `validateFuseFile()` (não expressáveis em JSON Schema): IDs de página e de nó únicos
(inclusive aninhados) e referências `pageId` existentes em `doc`, `sheets`, `timeline` e `site`.

### Extensões

`extensions` (arquivo, página, nó, bloco, clipe, planilha, ativo) é um mapa por namespace. Leitores **devem preservar**
namespaces desconhecidos. Namespaces reservados:

| Namespace | Uso |
| --- | --- |
| `fuse.legacy` | Detalhes do formato antigo sem equivalente v1 (campos extras, grupos não contíguos, presença de listas vazias...). |
| `fuse.library` | Estado de biblioteca do documento migrado: `folderId`, `archivedAt`, `trashedAt`. |
| `fuse.package` | Marca ativos extraídos de data: URLs (`dataUrlPrefix`). |

Plugins guardam dados em `PluginNode.data` (opaco, validado pelo plugin dono) ou em `extensions["<id-do-plugin>"]`.

## Versões e migrações

`migrate(json)` detecta a versão (`0` = formato legado, sem `format`), aplica `MIGRATIONS[n]` até a versão atual e valida.
Arquivos de versões futuras geram `FuseFormatError` com `code: 'unsupported-version'`. Cada novo `schemaVersion`
exige uma migração pura `v(n) → v(n+1)` registrada em `MIGRATIONS` e um novo `schema/fuse-file.v<n>.schema.json`.

## Formato legado → v1

| Legado (`apps/web/src/model.ts`) | v1 |
| --- | --- |
| `DesignDocument.name/updatedAt/brandKitId` | `meta.title/updatedAt (+createdAt)/brandKitId` |
| `type` (ausente = design) | `kind` |
| `width/height` | `Page.width/height` em cada página |
| `text` (`bold`, `kerning`, `lineSpacing`, `href`) | `Text` (`style.fontWeight` 700/400, `letterSpacing`, `lineHeight`, `link`) |
| `shape` | `Shape` (`startArrow/endArrow` → `markers`) |
| `shape` com `qrConfig` | `QR` (`url` → `data`, `name` → `label`, `corner` → `cornerRadius`) |
| `image` | `Image` (`altText` → `alt`, ajustes → `adjustments`, `filterPreset` → `filter`, `maskStrokes` → `mask`) |
| `sticky-note` / `free-draw` | `Sticky` / `Path` (`tool: 'freehand'`) |
| tipo desconhecido | `PluginNode` `fuse.legacy.unknown-element` com o objeto original em `data` |
| `page.connectors` | nós `Connector` no fim de `children` |
| `page.groups` | `Group` aninhado quando os membros são contíguos; senão preservado em `fuse.legacy` |
| `page.timelineClips` + `videoDurationMs` | `timeline.clips` (`pageId`) + `timeline.durationMs` |
| `page.blocks` + `docPageSetup` | `doc.sections` + `doc.pageSetup` |
| `page.cells/cellMerges/cellFormats/charts` | `sheets[]` esparso (A1), `merges`, `format` na célula, `charts` com faixa A1 |
| `MediaAsset` | `AssetRef` (`fingerprint` SHA-256 → `sha256`) |

`toLegacy(fromLegacy(doc))` reproduz o documento original (testado em todas as fixtures). `toLegacyWithReport()`
converte arquivos v1 nativos para o app atual e lista o que foi aproximado ou descartado (frames achatados, gradientes,
nós de vídeo/áudio/tabela/gráfico/embed etc.).

## API

```ts
import { migrate, validateFuseFile, packFuse, unpackFuse, fromLegacy, toLegacy, buildJsonSchema } from '@fuse/format'

const file = migrate(JSON.parse(text))            // qualquer versão conhecida → FuseFile v1 validado
const bytes = await packFuse(file, { thumbnail })  // Uint8Array (.fuse)
const { file: back, assets } = await unpackFuse(bytes)
```

## Desenvolvimento

```
pnpm --filter @fuse/format build
pnpm --filter @fuse/format test            # vitest
pnpm --filter @fuse/format test:coverage   # limiar: 90% linhas/funções
pnpm --filter @fuse/format schema:generate # regenera schema/fuse-file.v1.schema.json
```

Fixtures: `test/fixtures/legacy/` foram geradas a partir de `createStarterDocument()` e `createTypedBlankDocument()` do app
(12 modelos + 7 tipos em branco); `test/fixtures/handmade/` cobre todos os campos opcionais e casos de borda.
Um teste falha se o JSON Schema versionado divergir dos schemas Zod.
