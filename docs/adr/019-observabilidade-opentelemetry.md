# ADR-019 — Observabilidade com OpenTelemetry e integração Sentry-compatible opcional

- **Status:** Aceito (plano v2, 17/11/2026)
- **Data:** 2026-11-17
- **Relacionados:** ADR-007, ADR-010, ADR-016

## Contexto

Hoje o diagnóstico depende de `console.log`. Quem opera uma instância auto-hospedada, ou a nuvem, precisa de traces, métricas e logs correlacionados para servidor, colaboração e workers, sem amarrar o projeto a um fornecedor.

## Decisão

- Instrumentar `apps/server` e `apps/worker` com **OpenTelemetry** (SDK Node e auto-instrumentação de HTTP, Fastify, Postgres e Redis), exportando por **OTLP** para qualquer backend (Grafana, Jaeger, Prometheus etc.).
- Logs estruturados em JSON, com `trace_id` e `span_id` e **sem conteúdo de usuário** (documentos, prompts, e-mails).
- Métricas dos orçamentos do plano v2 §5: latência de colaboração, duração de export, tamanho das filas e erros por módulo.
- **Sentry-compatible opcional:** se um DSN for configurado, os erros de cliente e servidor são enviados a um serviço compatível (Sentry ou alternativa auto-hospedada compatível). Desligado por padrão.
- Telemetria de produto para o projeto é **opt-in** e anônima (Onda 6).

## Consequências

- **Positivas:** padrão aberto e neutro em relação a fornecedores; o self-host escolhe o backend.
- **Negativas:** custo de overhead da instrumentação; os pacotes do SDK do OpenTelemetry para Node mudam com frequência (linha 0.x), exigindo atualização cuidadosa.

## Alternativas consideradas

| Alternativa | Por que foi rejeitada |
| --- | --- |
| `console.log` (estado atual) | Sem correlação nem métricas |
| SDK de APM proprietário | Lock-in |
| Só Sentry | Cobre erros, mas não métricas e traces de forma neutra |

## Versões verificadas (`npm view <pkg> version`, 17/11/2026)

| Pacote | Versão estável | Link oficial |
| --- | --- | --- |
| `@opentelemetry/api` | 1.10.0 | https://opentelemetry.io/docs/languages/js/ |
| `@opentelemetry/sdk-node` | 0.301.2 | https://opentelemetry.io/docs/languages/js/ |
| `@opentelemetry/auto-instrumentations-node` | 0.83.1 | https://github.com/open-telemetry/opentelemetry-js-contrib |
| `@opentelemetry/exporter-trace-otlp-http` | 0.301.2 | https://opentelemetry.io/docs/languages/js/exporters/ |
| `@sentry/node` (opcional) | 11.14.0 | https://docs.sentry.io/platforms/javascript/guides/node/ |
| `@sentry/browser` (opcional) | 11.14.0 | https://docs.sentry.io/platforms/javascript/ |
