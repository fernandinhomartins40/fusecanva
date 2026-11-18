import { createHash } from 'node:crypto'

export class AiImageProviderError extends Error {
  constructor(message, status = 502) { super(message); this.status = status }
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_RESPONSE_BYTES = 11 * 1024 * 1024

async function readBoundedResponse(response) {
  const declaredLength = Number(response.headers?.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new AiImageProviderError('A resposta do provedor excedeu o limite permitido.', 502)
  if (!response.body?.getReader) {
    const raw = await response.text()
    if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) throw new AiImageProviderError('A resposta do provedor excedeu o limite permitido.', 502)
    return raw
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {})
        throw new AiImageProviderError('A resposta do provedor excedeu o limite permitido.', 502)
      }
      chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks, total).toString('utf8')
}

function sandboxImage(prompt) {
  const hash = createHash('sha256').update(prompt).digest()
  const hue = hash[0] * 360 / 255
  const hue2 = (hue + 80 + hash[1]) % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue.toFixed(0)} 78% 62%)"/><stop offset="1" stop-color="hsl(${hue2.toFixed(0)} 72% 38%)"/></linearGradient><radialGradient id="r"><stop stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="512" height="512" rx="54" fill="#17162b"/><circle cx="256" cy="256" r="176" fill="url(#g)"/><circle cx="196" cy="174" r="110" fill="url(#r)"/><path d="M105 342c72-78 141-80 202-7s92 62 115 30v93H105z" fill="#16152c" fill-opacity=".48"/><circle cx="349" cy="163" r="23" fill="#fff" fill-opacity=".8"/></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

export function createImageGenerator({ mode = 'sandbox', baseUrl = '', apiKey = '', model = '', fetchImpl = fetch, timeoutMs = 45_000 } = {}) {
  return {
    mode,
    async generate(prompt) {
      const normalized = typeof prompt === 'string' ? prompt.trim() : ''
      if (normalized.length < 3 || normalized.length > 2000) throw new AiImageProviderError('Descreva a imagem em 3 a 2.000 caracteres.', 400)
      if (mode === 'sandbox') return { mimeType: 'image/svg+xml', dataUrl: sandboxImage(normalized), width: 512, height: 512, mode }
      if (mode !== 'openai-compatible' || !baseUrl || !apiKey || !model) throw new AiImageProviderError('Geração de imagem indisponível. Configure STUDIO_IMAGE_AI_MODE, STUDIO_IMAGE_AI_BASE_URL, STUDIO_IMAGE_AI_API_KEY e STUDIO_IMAGE_AI_MODEL.', 503)
      const root = baseUrl.replace(/\/+$/, '')
      const endpoint = root.endsWith('/images/generations') ? root : `${root}/images/generations`
      let response
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model, prompt: normalized, n: 1, size: '1024x1024', response_format: 'b64_json' }),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch { throw new AiImageProviderError('O provedor de imagens não respondeu dentro do limite de tempo.', 502) }
      if (!response.ok) throw new AiImageProviderError(`O provedor de imagens retornou HTTP ${response.status}.`, 502)
      const raw = await readBoundedResponse(response)
      let payload
      try { payload = JSON.parse(raw) } catch { throw new AiImageProviderError('O provedor de imagens retornou uma resposta inválida.', 502) }
      const encoded = payload?.data?.[0]?.b64_json
      if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new AiImageProviderError('O provedor não retornou uma imagem base64 válida.', 502)
      const bytes = Buffer.from(encoded, 'base64')
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== encoded) throw new AiImageProviderError('A imagem retornada excede 8 MB ou tem base64 inválido.', 502)
      const mimeType = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
        : bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'image/jpeg'
          : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : null
      if (!mimeType) throw new AiImageProviderError('O provedor deve retornar PNG, JPEG ou WebP.', 502)
      return { mimeType, dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`, width: 1024, height: 1024, mode }
    },
  }
}
