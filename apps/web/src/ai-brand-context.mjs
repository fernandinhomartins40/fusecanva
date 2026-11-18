import { AUDITED_BRAND_PALETTE, AUDITED_TITLE_STYLE, BRAND_KITS } from './brand-kit.mjs'

const LAB_KIT_ID = 'rea-laboratory'

export function getAiBrandContext(brandKitId) {
  const kit = BRAND_KITS.find(item => item.id === brandKitId)
  if (!kit) return null

  if (kit.id !== LAB_KIT_ID) {
    return {
      kitId: kit.id,
      kitName: kit.name,
      hasResources: false,
      summary: 'Este kit ainda não tem paleta ou tipografia salvas.',
      promptContext: '',
    }
  }

  const colorMappings = Object.entries(AUDITED_BRAND_PALETTE.mappings)
    .map(([source, target]) => `${source} → ${target}`)
  const typography = `${AUDITED_TITLE_STYLE.role}: ${AUDITED_TITLE_STYLE.fontFamily}, ${AUDITED_TITLE_STYLE.fontSize}px, ${AUDITED_TITLE_STYLE.bold ? 'negrito' : 'regular'}, ${AUDITED_TITLE_STYLE.color}`
  const summary = `Cor principal ${AUDITED_BRAND_PALETTE.primary}; ${colorMappings.join('; ')}. ${typography}.`
  const promptContext = [
    `Use este kit de marca como contexto visual, somente quando for relevante: ${kit.name}.`,
    `Paleta: cor principal ${AUDITED_BRAND_PALETTE.primary}; mapeamentos ${colorMappings.join('; ')}.`,
    `Tipografia: ${typography}; texto de exemplo ${JSON.stringify(AUDITED_TITLE_STYLE.text)}.`,
    'Use somente estes recursos e não invente logotipos ou outros ativos da marca.',
  ].join('\n')

  return {
    kitId: kit.id,
    kitName: kit.name,
    hasResources: true,
    summary,
    promptContext,
  }
}

export function buildAiRequestPrompt(prompt, brandContext = null, attachments = []) {
  const request = String(prompt ?? '').trim()
  const context = [
    brandContext?.hasResources ? brandContext.promptContext : '',
    buildAiAttachmentContext(attachments),
  ].filter(Boolean).join('\n\n')
  if (!context) return request
  const available = Math.max(0, 2000 - context.length - 2)
  return `${request.slice(0, available)}\n\n${context}`
}

export function buildAiAttachmentContext(attachments = []) {
  const entries = (Array.isArray(attachments) ? attachments : []).slice(0, 4).map(item => {
    if (!item || typeof item.name !== 'string') return ''
    const kind = item.kind === 'design' ? 'Design salvo neste app' : 'Arquivo local'
    return `${kind}: ${item.name}\nContexto: ${String(item.context ?? '').trim().slice(0, 1600)}`
  }).filter(Boolean)
  return entries.join('\n\n').slice(0, 1200)
}

export function summarizeAiDesign(document) {
  if (!document || typeof document !== 'object') return ''
  const data = document.data && typeof document.data === 'object' ? document.data : document
  const snippets = []
  for (const page of Array.isArray(data.pages) ? data.pages : []) {
    if (typeof page?.name === 'string') snippets.push(page.name)
    for (const element of Array.isArray(page?.elements) ? page.elements : []) {
      if (['text', 'sticky-note'].includes(element?.type) && typeof element.text === 'string') snippets.push(element.text)
      if (snippets.length >= 24) break
    }
  }
  for (const block of Array.isArray(data.blocks) ? data.blocks : []) {
    if (typeof block?.text === 'string') snippets.push(block.text)
    if (snippets.length >= 24) break
  }
  for (const row of Array.isArray(data.cells) ? data.cells.slice(0, 8) : []) {
    if (Array.isArray(row)) snippets.push(...row.filter(value => typeof value === 'string').slice(0, 8))
  }
  return snippets.map(value => value.trim()).filter(Boolean).join(' · ').slice(0, 600)
}

export function getAiPromptLimit(brandContext = null, attachments = []) {
  const brandLength = brandContext?.hasResources ? brandContext.promptContext.length + 2 : 0
  const attachmentContext = buildAiAttachmentContext(attachments)
  const attachmentLength = attachmentContext ? attachmentContext.length + 2 : 0
  return Math.max(3, 2000 - brandLength - attachmentLength)
}
