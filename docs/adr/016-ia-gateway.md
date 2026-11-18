# ADR-016 — IA via `ai-gateway` com múltiplos providers e políticas por organização

- **Status:** Aceito (plano v2, 17/11/2026)
- **Data:** 2026-11-17
- **Relacionados:** ADR-007, ADR-010, ADR-012, ADR-019

## Contexto

Os recursos de IA atuais (`ai-*.mjs`, o laboratório de geração) dependem de um provider fixo. Um diferencial do produto é usar **a chave do próprio usuário (BYO-key)** ou **modelos locais**, com controle de privacidade e de custo pela organização.

## Decisão

- Módulo `ai-gateway` em `apps/server/modules`, com uma interface de provider única para as capacidades: texto (chat e completions), geração de imagem, edição de imagem, upscale e transcrição.
- Providers iniciais:
  - **OpenAI-compatible** (cobre qualquer servidor com essa API, inclusive locais);
  - **Anthropic**;
  - **Ollama** (local);
  - **ComfyUI / Stable Diffusion local** (imagem), via API HTTP do ComfyUI.
- Chaves de API cifradas em repouso, por usuário ou por org; nunca enviadas ao cliente.
- **Políticas por org:** providers permitidos, modelos permitidos, "só local", quotas por usuário/período e retenção.
- **Logs sem conteúdo:** registra-se metadado (provider, modelo, tokens, latência, custo estimado), nunca prompt nem resposta, salvo opt-in explícito da org.
- Jobs longos (imagem, transcrição) vão para a fila `ai` (ADR-010).
- `packages/ai-client` fornece o cliente tipado e a UI do composer; toda ação de IA no documento passa pelos comandos do editor e é revisável e desfazível.

## Consequências

- **Positivas:** sem lock-in de provider; modo totalmente local possível; controle de custo e privacidade.
- **Negativas:** o menor denominador comum entre providers limita alguns recursos; cada provider exige testes de contrato com mocks.

## Alternativas consideradas

| Alternativa | Por que foi rejeitada |
| --- | --- |
| Provider único | Lock-in; não atende self-host com modelo local |
| Chamadas diretas do navegador ao provider | Expõe chaves; impede políticas e quotas |
| Proxy genérico de terceiros (SaaS) | Mais uma dependência externa para dados sensíveis |

## Versões verificadas (`npm view <pkg> version`, 17/11/2026)

| Pacote / serviço | Versão estável | Link oficial |
| --- | --- | --- |
| `openai` (cliente OpenAI-compatible) | 7.59.0 | https://github.com/openai/openai-node |
| `@anthropic-ai/sdk` | 1.10.0 | https://docs.anthropic.com |
| `ollama` (cliente JS) | 0.6.4 | https://github.com/ollama/ollama-js |
| Ollama (servidor) | versão a verificar | https://ollama.com |
| ComfyUI (servidor) | versão a verificar | https://github.com/comfyanonymous/ComfyUI |
