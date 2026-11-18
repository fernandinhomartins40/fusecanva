export class AiProviderError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.status = status
  }
}

export function createTextGenerator({ mode = 'disabled', baseUrl = '', apiKey = '', model = '', fetchImpl = fetch } = {}) {
  return {
    mode,
    async generate(prompt) {
      if (mode === 'sandbox') return `Rascunho de demonstração para: ${prompt}`
      if (mode !== 'openai-compatible' || !baseUrl || !apiKey || !model) {
        throw new AiProviderError('A geração de IA está desativada. Configure STUDIO_AI_MODE, STUDIO_AI_BASE_URL, STUDIO_AI_API_KEY e STUDIO_AI_MODEL.', 503)
      }
      const root = baseUrl.replace(/\/+$/, '')
      const endpoint = root.endsWith('/chat/completions') ? root : `${root}/chat/completions`
      let response
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.7 }),
          signal: AbortSignal.timeout(30_000),
        })
      } catch {
        throw new AiProviderError('O provedor de IA não respondeu. Tente novamente mais tarde.', 502)
      }
      if (!response.ok) throw new AiProviderError(`O provedor de IA retornou HTTP ${response.status}.`, 502)
      let payload
      try { payload = await response.json() } catch { throw new AiProviderError('O provedor de IA retornou uma resposta inválida.', 502) }
      const text = payload?.choices?.[0]?.message?.content
      if (typeof text !== 'string' || !text.trim()) throw new AiProviderError('O provedor de IA não retornou texto.', 502)
      return text.trim().slice(0, 20_000)
    },
  }
}
