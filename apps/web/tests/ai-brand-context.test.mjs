import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAiRequestPrompt, getAiBrandContext, getAiPromptLimit, summarizeAiDesign } from '../src/ai-brand-context.mjs'
import { AI_UPLOAD_MAX_BYTES, createAiFileAttachment, validateAiAttachmentFile } from '../src/ai-attachments.mjs'

test('AI brand context uses the selected kit resources without inventing assets', () => {
  const context = getAiBrandContext('rea-laboratory')
  assert.equal(context?.hasResources, true)
  assert.match(context.promptContext, /#123456/)
  assert.match(context.promptContext, /#75511c → #123456/)
  assert.match(context.promptContext, /#b29365 → #2d4a6f/)
  assert.match(context.promptContext, /Arial, 42\.6667px, negrito, #000000/)
  assert.match(context.promptContext, /não invente logotipos/)
})

test('an empty/default kit cannot attach resources and unknown kits are rejected', () => {
  const context = getAiBrandContext('default')
  assert.equal(context?.hasResources, false)
  assert.equal(context?.promptContext, '')
  assert.match(context?.summary ?? '', /não tem paleta ou tipografia salvas/)
  assert.equal(getAiBrandContext('unknown-kit'), null)
})

test('AI request keeps the original prompt and appends selected brand context within endpoint limits', () => {
  const context = getAiBrandContext('rea-laboratory')
  const prompt = 'Write a welcome for a drawing workshop.'
  const request = buildAiRequestPrompt(prompt, context)
  assert.ok(request.startsWith(prompt))
  assert.ok(request.includes(context.promptContext))
  assert.ok(request.length <= 2000)
  assert.equal(getAiPromptLimit(context) + context.promptContext.length + 2, 2000)
  assert.equal(buildAiRequestPrompt(prompt, getAiBrandContext('default')), prompt)
})

test('AI attachments are bounded, labeled and reduce the prompt budget', () => {
  const file = createAiFileAttachment({ id: 'file:one', name: 'brief.txt', mimeType: 'text/plain', size: 12, content: 'Workshop invite' })
  const design = { id: 'saved:one', kind: 'design', name: 'Workshop', context: 'design — Cover · Draw together' }
  assert.equal(AI_UPLOAD_MAX_BYTES, 512 * 1024)
  assert.equal(validateAiAttachmentFile({ name: 'brief.txt', type: 'text/plain', size: 20 }), '')
  assert.match(validateAiAttachmentFile({ name: 'photo.png', type: 'image/png', size: 20 }), /TXT/)
  assert.match(validateAiAttachmentFile({ name: 'large.txt', type: 'text/plain', size: AI_UPLOAD_MAX_BYTES + 1 }), /512 KB/)
  assert.equal(file.context, 'Workshop invite')
  const attachments = [file, design]
  const prompt = buildAiRequestPrompt('Make an invitation', null, attachments)
  assert.ok(prompt.startsWith('Make an invitation\n\nArquivo local: brief.txt'))
  assert.ok(prompt.includes('Design salvo neste app: Workshop'))
  assert.ok(prompt.includes('Workshop invite'))
  assert.ok(prompt.length <= 2000)
  assert.equal('Make an invitation'.length <= getAiPromptLimit(null, attachments), true)
})

test('saved design summaries contain bounded human-readable text only', () => {
  assert.equal(summarizeAiDesign({ data: { pages: [{ name: 'Cover', elements: [{ type: 'text', text: 'Draw together' }, { type: 'image', src: 'secret-image-url' }] }] } }), 'Cover · Draw together')
  assert.equal(summarizeAiDesign({ pages: [{ elements: [{ type: 'text', text: 'x'.repeat(1000) }] }] }).length, 600)
})
