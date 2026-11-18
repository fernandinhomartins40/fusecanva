import test from 'node:test'
import assert from 'node:assert/strict'
import { createPrintSpecification, DEFAULT_PRINT_DRAFT, PRINT_FINISHES, PRINT_FORMATS, PRINT_PAPERS, PRINT_QUANTITIES, estimatePrintPrice, normalizePrintDraft, readPrintDraft, resetPrintDraft, serializePrintSpecification, writePrintDraft } from '../src/print-sandbox.mjs'

test('audited business-card paper, format and quantity options are available with the captured defaults', () => {
  assert.equal(PRINT_FORMATS.length, 4)
  assert.deepEqual(PRINT_FORMATS.map(option => option.size), ['50 × 89 mm', '89 × 50 mm', '48 × 90 mm', '90 × 48 mm'])
  assert.deepEqual(PRINT_PAPERS.map(option => option.id), ['standard', 'premium'])
  assert.deepEqual(PRINT_FINISHES.map(option => option.id), ['matte', 'gloss'])
  assert.deepEqual(PRINT_QUANTITIES, [50, 100, 150, 200, 250, 500, 1000, 1500, 2000])
  assert.deepEqual({ ...DEFAULT_PRINT_DRAFT }, { format: 'vertical-standard', paper: 'premium', finish: 'matte', quantity: 150 })
})

test('estimate anchors exactly to observed 50-card and 150-card premiums and standard-paper transition', () => {
  assert.equal(estimatePrintPrice({ ...DEFAULT_PRINT_DRAFT, quantity: 50 }), 38.5)
  assert.equal(estimatePrintPrice(DEFAULT_PRINT_DRAFT), 69)
  assert.equal(estimatePrintPrice({ ...DEFAULT_PRINT_DRAFT, quantity: 1000 }), 310)
  assert.equal(estimatePrintPrice({ ...DEFAULT_PRINT_DRAFT, paper: 'standard' }), 63)
})

test('sandbox draft roundtrips, validates data, and reset restores the captured defaults', () => {
  const values = new Map()
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  const key = 'print-draft'
  const chosen = { format: 'horizontal-slim', paper: 'standard', finish: 'gloss', quantity: 50 }
  writePrintDraft(storage, key, chosen)
  assert.deepEqual(readPrintDraft(storage, key), chosen)
  values.set(key, '{bad json')
  assert.equal(readPrintDraft(storage, key), null)
  assert.deepEqual(normalizePrintDraft({ format: 'bad', paper: 'bad', finish: 'bad', quantity: 33 }), { ...DEFAULT_PRINT_DRAFT })
  assert.deepEqual(resetPrintDraft(storage, key), { ...DEFAULT_PRINT_DRAFT })
  assert.equal(values.has(key), false)
})

test('print specification export is a local sandbox artifact and explicitly records no transaction', () => {
  const draft = { ...DEFAULT_PRINT_DRAFT, format: 'horizontal-slim', quantity: 50 }
  const spec = createPrintSpecification('design-local-42', draft, '2026-10-23T12:00:00.000Z')
  assert.equal(spec.schema, 'fusecanva.print-sandbox-quote.v1')
  assert.equal(spec.documentId, 'design-local-42')
  assert.deepEqual(spec.configuration.format, { id: 'horizontal-slim', label: 'Horizontal – Fino', size: '90 × 48 mm' })
  assert.equal(spec.estimate.amount, 38.5)
  assert.deepEqual(spec.transaction, { orderPlaced: false, paymentCollected: false, externalProviderContacted: false })
  assert.match(spec.limitations.join(' '), /not an order/i)
  assert.deepEqual(JSON.parse(serializePrintSpecification('design-local-42', draft, '2026-10-23T12:00:00.000Z')), spec)
})
