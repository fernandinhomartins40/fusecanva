# ADR-010 — Filas com Redis + BullMQ e workers separados

- **Status:** Aceito (plano v2, 17/11/2026)
- **Data:** 2026-11-17
- **Relacionados:** ADR-005, ADR-009, ADR-016, ADR-017

## Contexto

Export, mídia (FFmpeg), IA e thumbnails rodam hoje no navegador ou no processo HTTP. Tarefas pesadas travam a interface, não têm retry nem cancelamento e não informam progresso.

## Decisão

- **Redis** como broker e **BullMQ** como biblioteca de filas.
- `apps/worker` com processos separados por fila: `export`, `media` (FFmpeg), `ai`, `thumbnails` e `email`, escaláveis de forma independente.
- Cada job tem payload validado por schema, idempotência por chave, retry com backoff, cancelamento e progresso publicado ao cliente (via WebSocket ou SSE do servidor).
- Resultados vão para o object storage (ADR-009); o job guarda só referências.
- O export no cliente continua disponível para casos leves (PNG de uma página), usando o mesmo renderer (ADR-005).

## Consequências

- **Positivas:** export pesado fora do navegador; isolamento de falhas; escala horizontal dos workers.
- **Negativas:** mais um serviço (Redis) no self-host; observabilidade das filas passa a ser obrigatória (ADR-019).
- **Atenção:** confirmar a licença da versão do servidor Redis adotada; um fork compatível de licença aberta (por exemplo, Valkey) é aceitável se for preciso.

## Alternativas consideradas

| Alternativa | Por que foi rejeitada |
| --- | --- |
| Export só no cliente (estado atual) | Trava o navegador; sem áudio fiel no vídeo |
| pg-boss (fila no Postgres) | Viável e mais simples, mas com menos recursos de prioridade, rate limit e fluxos |
| RabbitMQ / Kafka | Operação mais pesada que o necessário |

## Versões verificadas (`npm view <pkg> version`, 17/11/2026)

| Pacote / serviço | Versão estável | Link oficial |
| --- | --- | --- |
| `bullmq` | 6.7.7 | https://docs.bullmq.io |
| `ioredis` | 6.0.0 | https://github.com/redis/ioredis |
| Redis (servidor) | versão a verificar | https://redis.io |
