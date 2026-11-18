# ADR-006 — Motor de layout de texto próprio sobre HarfBuzz (wasm) e fontes OFL

- **Status:** Aceito (plano v2, 17/11/2026)
- **Data:** 2026-11-17
- **Relacionados:** ADR-005, ADR-017

## Contexto

As métricas de texto do DOM variam entre navegadores e não são as mesmas usadas na geração de PDF. Quebras de linha, kerning e ligaduras mudam entre o editor e o export, e o texto "pula" depois de exportado.

## Decisão

- Criar `packages/text` com shaping via **HarfBuzz compilado para wasm** (`harfbuzzjs`), mais um motor próprio de layout de parágrafos: quebra de linha (regras Unicode UAX #14), bidi, alinhamento, espaçamento, listas e autoajuste.
- O layout produz glifos posicionados, consumidos pelo renderer (ADR-005) e pelo export PDF, que embute subsets das mesmas fontes.
- As fontes padrão do produto são **OFL** (ou licença equivalente que permita embutir e redistribuir), servidas pelo próprio app, sem CDN de terceiros.
- Cache de shaping por (fonte, tamanho, texto, features).

## Consequências

- **Positivas:** medição idêntica no editor, no PNG, no PDF e no headless; suporte a scripts complexos.
- **Negativas:** o wasm acrescenta peso ao bundle inicial (carregamento preguiçoso no editor); a edição de texto inline exige uma camada própria de caret e seleção sobre o layout.

## Alternativas consideradas

| Alternativa | Por que foi rejeitada |
| --- | --- |
| Métricas do DOM (`measureText` / elementos ocultos) | Divergem do PDF e entre navegadores |
| opentype.js para shaping | Shaping incompleto em scripts complexos |
| Texto como HTML sobreposto ao canvas | Não reproduzível no headless |

## Versões verificadas (`npm view <pkg> version`, 17/11/2026)

| Pacote | Versão estável | Link oficial |
| --- | --- | --- |
| `harfbuzzjs` | 1.6.4 | https://github.com/harfbuzz/harfbuzzjs |
| HarfBuzz (biblioteca nativa) | versão a verificar | https://harfbuzz.github.io |
| SIL Open Font License 1.1 | licença | https://openfontlicense.org |
