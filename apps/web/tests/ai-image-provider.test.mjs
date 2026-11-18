import assert from 'node:assert/strict'
import test from 'node:test'
import { createImageGenerator } from '../server/ai-image-provider.mjs'

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])

test('sandbox generation is deterministic and never invokes fetch', async () => {
  let fetchCalls = 0
  const generator = createImageGenerator({ mode: 'sandbox', fetchImpl: async () => { fetchCalls++; throw new Error('network forbidden') } })
  const first = await generator.generate('uma montanha azul')
  const again = await generator.generate('uma montanha azul')
  const other = await generator.generate('um oceano laranja')
  assert.equal(first.mode, 'sandbox')
  assert.equal(first.mimeType, 'image/svg+xml')
  assert.equal(first.width, 512)
  assert.equal(first.dataUrl, again.dataUrl)
  assert.notEqual(first.dataUrl, other.dataUrl)
  assert.equal(fetchCalls, 0)
})

test('configured OpenAI-compatible provider receives bounded request and accepts bounded PNG base64 only', async () => {
  const calls = []
  const generator = createImageGenerator({ mode: 'openai-compatible', baseUrl: 'https://image.example/v1/', apiKey: 'test-key', model: 'image-model', fetchImpl: async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200 })
  } })
  const result = await generator.generate('capa azul')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://image.example/v1/images/generations')
  assert.equal(calls[0].options.headers.authorization, 'Bearer test-key')
  assert.deepEqual(JSON.parse(calls[0].options.body), { model: 'image-model', prompt: 'capa azul', n: 1, size: '1024x1024', response_format: 'b64_json' })
  assert.equal(result.mimeType, 'image/png')
  assert.equal(result.mode, 'openai-compatible')
  assert.equal(result.dataUrl, `data:image/png;base64,${png.toString('base64')}`)
})

test('provider mode without configuration fails before network and rejects unsafe or oversized responses', async () => {
  let calls = 0
  const missing = createImageGenerator({ mode: 'openai-compatible', fetchImpl: async () => { calls++ } })
  await assert.rejects(missing.generate('capa azul'), /Configure STUDIO_IMAGE_AI_MODE/)
  await assert.rejects(createImageGenerator().generate(' x '), /3 a 2.000/)
  await assert.rejects(createImageGenerator({ mode: 'openai-compatible', baseUrl: 'https://image.example', apiKey: 'x', model: 'm', fetchImpl: async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('<svg/>').toString('base64') }] })) }).generate('capa azul'), /PNG, JPEG ou WebP/)
  await assert.rejects(createImageGenerator({ mode: 'openai-compatible', baseUrl: 'https://image.example', apiKey: 'x', model: 'm', fetchImpl: async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64') }] })) }).generate('capa azul'), /excede 8 MB/)
  await assert.rejects(createImageGenerator({ mode: 'openai-compatible', baseUrl: 'https://image.example', apiKey: 'x', model: 'm', fetchImpl: async () => new Response('x'.repeat(11 * 1024 * 1024 + 1)) }).generate('capa azul'), /resposta do provedor excedeu o limite/)
  assert.equal(calls, 0)
})

test('provider request has a timeout and reports transport failures', async () => {
  const generator = createImageGenerator({ mode: 'openai-compatible', baseUrl: 'https://image.example', apiKey: 'x', model: 'm', timeoutMs: 25, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) })
  const keepEventLoopAlive = setTimeout(() => {}, 500)
  try { await assert.rejects(generator.generate('capa azul'), /limite de tempo/) }
  finally { clearTimeout(keepEventLoopAlive) }
})
