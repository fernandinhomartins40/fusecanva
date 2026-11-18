# ADR-005 — Renderer próprio sobre Canvas 2D com interface `RenderBackend`

- **Status:** Aceito (plano v2, 17/11/2026)
- **Data:** 2026-11-17
- **Relacionados:** ADR-006, ADR-010, ADR-017, princípio 4 do plano v2

## Contexto

Hoje o editor desenha com uma biblioteca de canvas e as exportações (`export.ts`, `svg-export.ts`, `gif-export.ts`) usam outro código, por isso o arquivo exportado diverge da tela. O princípio "um modelo, um renderer" exige que o mesmo código desenhe o editor, o export e o render headless (CLI e worker).

## Decisão

- Criar `packages/renderer`, que desenha todos os nós de `@fuse/format` sobre uma interface **`RenderBackend`** compatível com a API Canvas 2D.
- Backends: **Canvas do DOM** (editor), **OffscreenCanvas em Web Worker** (thumbnails e export no cliente) e **`skia-canvas` no Node** (worker e CLI).
- SVG e PDF vetorial saem de backends de gravação, que recebem a mesma sequência de chamadas de desenho.
- Testes **golden image** no `test-kit`: diff ≤ 0,5% entre editor, PNG e headless (Gate 1).
- O export antigo fica atrás de flag até os goldens passarem.

## Consequências

- **Positivas:** fidelidade entre tela e export; um só lugar para corrigir bugs de desenho; o mesmo render roda no servidor.
- **Negativas:** hit-test, dirty rects e cache de camadas ficam por nossa conta; diferenças de antialiasing entre engines exigem tolerância nos goldens.

## Alternativas consideradas

| Alternativa | Por que foi rejeitada |
| --- | --- |
| Konva no editor + canvas próprio no export | Duas implementações divergentes (estado atual) |
| CanvasKit (Skia wasm) em todos os ambientes | Bundle grande no cliente; pode virar um backend extra depois |
| DOM/SVG como superfície do editor | Desempenho ruim com milhares de nós; difícil de reproduzir no headless |

## Versões verificadas (`npm view <pkg> version`, 17/11/2026)

| Pacote | Versão estável | Link oficial |
| --- | --- | --- |
| `skia-canvas` | 4.0.1 | https://skia-canvas.org |
| Canvas 2D / OffscreenCanvas | API da plataforma (sem versão) | https://developer.mozilla.org/docs/Web/API/OffscreenCanvas |
