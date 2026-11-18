export const PRINT_FORMATS = [
  { id: 'vertical-standard', label: 'Vertical – Padrão', size: '50 × 89 mm' },
  { id: 'horizontal-standard', label: 'Horizontal – Padrão', size: '89 × 50 mm' },
  { id: 'vertical-slim', label: 'Vertical – Fino', size: '48 × 90 mm' },
  { id: 'horizontal-slim', label: 'Horizontal – Fino', size: '90 × 48 mm' },
]

export const PRINT_PAPERS = [
  { id: 'standard', label: 'Papel padrão', weight: '240–325 g/m²', description: 'Uma opção de qualidade para uso cotidiano.' },
  { id: 'premium', label: 'Papel premium', weight: '325–350 g/m²', description: 'Mais espesso para dar mais destaque.' },
]

export const PRINT_FINISHES = [
  { id: 'matte', label: 'Laminação fosca', description: 'Acabamento sutil; superfície apta para escrita.' },
  { id: 'gloss', label: 'Laminação brilho', description: 'Brilho suave e maior proteção; não apta para escrita.' },
]

export const PRINT_QUANTITIES = [50, 100, 150, 200, 250, 500, 1000, 1500, 2000]
export const DEFAULT_PRINT_DRAFT = Object.freeze({ format: 'vertical-standard', paper: 'premium', finish: 'matte', quantity: 150 })

const observedPremiumTotals = new Map([[50, 38.5], [100, 51], [150, 69], [200, 86], [250, 97.5], [500, 175], [1000, 310], [1500, 420], [2000, 560]])

/** Local illustrative estimate anchored to the two captured session prices; never a provider quote. */
export function estimatePrintPrice({ paper, finish, quantity }) {
  const closest = [...observedPremiumTotals.keys()].sort((a, b) => Math.abs(a - quantity) - Math.abs(b - quantity))[0]
  let total = observedPremiumTotals.get(quantity) ?? observedPremiumTotals.get(closest) * (quantity / closest)
  if (paper === 'standard') total *= 63 / 69
  if (finish === 'gloss') total *= 1.05
  return Math.round(total * 100) / 100
}

export function formatSandboxPrice(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

export function normalizePrintDraft(value) {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PRINT_DRAFT }
  const draft = value
  return {
    format: PRINT_FORMATS.some(option => option.id === draft.format) ? draft.format : DEFAULT_PRINT_DRAFT.format,
    paper: PRINT_PAPERS.some(option => option.id === draft.paper) ? draft.paper : DEFAULT_PRINT_DRAFT.paper,
    finish: PRINT_FINISHES.some(option => option.id === draft.finish) ? draft.finish : DEFAULT_PRINT_DRAFT.finish,
    quantity: PRINT_QUANTITIES.includes(Number(draft.quantity)) ? Number(draft.quantity) : DEFAULT_PRINT_DRAFT.quantity,
  }
}

export function readPrintDraft(storage, key) {
  try {
    const raw = storage.getItem(key)
    return raw ? normalizePrintDraft(JSON.parse(raw)) : null
  } catch { return null }
}

export function writePrintDraft(storage, key, draft) {
  storage.setItem(key, JSON.stringify(normalizePrintDraft(draft)))
}

export function resetPrintDraft(storage, key) {
  storage.removeItem(key)
  return { ...DEFAULT_PRINT_DRAFT }
}

export function createPrintSpecification(documentId, draft, createdAt = new Date().toISOString()) {
  const configuration = normalizePrintDraft(draft)
  const format = PRINT_FORMATS.find(option => option.id === configuration.format)
  const paper = PRINT_PAPERS.find(option => option.id === configuration.paper)
  const finish = PRINT_FINISHES.find(option => option.id === configuration.finish)
  return {
    schema: 'fusecanva.print-sandbox-quote.v1',
    kind: 'sandbox-print-specification',
    documentId,
    createdAt,
    configuration: {
      format: { id: format.id, label: format.label, size: format.size },
      paper: { id: paper.id, label: paper.label, weight: paper.weight },
      finish: { id: finish.id, label: finish.label },
      quantity: configuration.quantity,
    },
    estimate: {
      amount: estimatePrintPrice(configuration),
      currency: 'BRL',
      basis: 'Local illustrative estimate anchored to captured session totals; unobserved combinations may be approximated.',
    },
    transaction: { orderPlaced: false, paymentCollected: false, externalProviderContacted: false },
    limitations: ['Not a current provider quote.', 'Shipping, taxes, regional availability, and production validation are not included.', 'This file is a local sandbox specification, not an order.'],
  }
}

export function serializePrintSpecification(documentId, draft, createdAt) {
  return JSON.stringify(createPrintSpecification(documentId, draft, createdAt), null, 2)
}
