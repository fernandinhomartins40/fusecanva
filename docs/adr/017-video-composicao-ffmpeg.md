# ADR-017 — Vídeo: composição declarativa no modelo, render no worker com FFmpeg e preview com WebCodecs

- **Status:** Aceito (plano v2, 17/11/2026)
- **Data:** 2026-11-17
- **Relacionados:** ADR-003, ADR-005, ADR-010

## Contexto

O export de vídeo atual usa `MediaRecorder` no navegador: depende da velocidade da máquina, perde quadros, trava a interface e tem suporte limitado a áudio e a formatos de saída.

## Decisão

- A composição é **declarativa** no modelo `.fuse` (`timeline`: faixas, clipes, transições, keyframes com easing, legendas), sem estado de player.
- O cliente faz o **preview** decodificando mídia com **WebCodecs** e desenhando os quadros com o renderer único (ADR-005). Sem WebCodecs, o preview cai para elementos `<video>` sincronizados.
- O **export final** é um job na fila `media` (ADR-010): o worker desenha cada quadro com o renderer headless (`skia-canvas`), mixa o áudio e codifica com **FFmpeg** para MP4 (H.264/AAC), WebM (VP9/Opus) e GIF.
- O export é determinístico por quadro (tempo → quadro), sem depender do relógio real.
- Escopo inicial com transições limitadas (risco "Alta" no plano v2 §11).

## Consequências

- **Positivas:** vídeos fiéis, com áudio, sem travar o navegador; o mesmo render da tela.
- **Negativas:** o self-host precisa do binário FFmpeg no worker (incluído na imagem Docker); a renderização quadro a quadro no servidor consome CPU, exigindo limites por org.
- **Atenção:** os codecs e o build do FFmpeg distribuído têm implicações de licença e patentes (por exemplo, H.264); a imagem Docker deve documentar o build usado.

## Alternativas consideradas

| Alternativa | Por que foi rejeitada |
| --- | --- |
| `MediaRecorder` no cliente (estado atual) | Perde quadros, depende da máquina e trava a UI |
| ffmpeg.wasm no navegador | Lento e com uso alto de memória para vídeos longos |
| Serviço de render de terceiros | Contraria self-host e local-first |

## Versões verificadas (`npm view <pkg> version`, 17/11/2026)

| Pacote / ferramenta | Versão estável | Link oficial |
| --- | --- | --- |
| FFmpeg (binário) | versão a verificar | https://ffmpeg.org/download.html |
| `skia-canvas` | 4.0.1 | https://skia-canvas.org |
| `mediabunny` (candidato a mux/demux no cliente, a avaliar) | 1.66.0 | https://mediabunny.dev |
| WebCodecs | API da plataforma (sem versão) | https://developer.mozilla.org/docs/Web/API/WebCodecs_API |

Observação: `fluent-ffmpeg` (2.1.3) e `@ffmpeg-installer/ffmpeg` (1.1.0) existem no npm, mas não são recomendados como dependência; o worker chama o binário com `child_process` e argumentos validados.
