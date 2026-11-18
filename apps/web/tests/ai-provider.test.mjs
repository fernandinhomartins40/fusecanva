import assert from 'node:assert/strict'
import test from 'node:test'
import { AiProviderError, createTextGenerator } from '../server/ai-provider.mjs'

test('AI text generator has an explicit deterministic sandbox with no network dependency', async () => {
  let networkCalls = 0
  const generator = createTextGenerator({ mode: 'sandbox', fetchImpl: async () => { networkCalls += 1; throw new Error('network must not be used in sandbox') } })
  assert.equal(await generator.generate('Uma chamada para um cartaz'), 'Rascunho de demonstração para: Uma chamada para um cartaz')
})

test('AI text generator calls a configurable chat-completions provider and bounds output', async () => {
  let request
  const generator = createTextGenerator({
    mode: 'openai-compatible', baseUrl: 'https://provider.example/v1/', apiKey: 'test-secret', model: 'text-model',
    fetchImpl: async (url, options) => {
      request = { url, options }
      return Response.json({ choices: [{ message: { content: '  Generated copy  ' } }] })
    },
  })
  assert.equal(await generator.generate('prompt'), 'Generated copy')
  assert.equal(request.url, 'https://provider.example/v1/chat/completions')
  assert.equal(request.options.headers.authorization, 'Bearer test-secret')
  assert.equal(JSON.parse(request.options.body).model, 'text-model')
})

test('AI text generator caps long provider output and rejects malformed or empty responses', async () => {
  const config = { mode: 'openai-compatible', baseUrl: 'https://provider.example/v1', apiKey: 'key', model: 'model' }
  const capped = createTextGenerator({ ...config, fetchImpl: async () => Response.json({ choices: [{ message: { content: 'x'.repeat(20_500) } }] }) })
  assert.equal((await capped.generate('prompt')).length, 20_000)

  const malformed = createTextGenerator({ ...config, fetchImpl: async () => new Response('{', { status: 200 }) })
  await assert.rejects(malformed.generate('prompt'), error => error instanceof AiProviderError && error.status === 502)
  const empty = createTextGenerator({ ...config, fetchImpl: async () => Response.json({ choices: [{ message: { content: '  ' } }] }) })
  await assert.rejects(empty.generate('prompt'), error => error instanceof AiProviderError && error.status === 502)
})
test('AI text generator fails clearly when disabled or the provider fails', async () => {
  await assert.rejects(createTextGenerator().generate('prompt'), error => error instanceof AiProviderError && error.status === 503)
  const failing = createTextGenerator({ mode: 'openai-compatible', baseUrl: 'https://provider.example/v1', apiKey: 'key', model: 'model', fetchImpl: async () => new Response('', { status: 429 }) })
  await assert.rejects(failing.generate('prompt'), error => error instanceof AiProviderError && error.status === 502 && /429/.test(error.message))
})
