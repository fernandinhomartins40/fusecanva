import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('SUBTOTAL covers aggregate codes 1–11 and their 101–111 variants', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet } = await vite.ssrLoadModule('/src/sheet.ts')
    const result = evaluateSheet([
      ['2', '4', 'texto', '', 'TRUE'],
      ['=SUBTOTAL(1,A1:E1)', '=SUBTOTAL(2,A1:E1)', '=SUBTOTAL(3,A1:E1)', '=SUBTOTAL(4,A1:E1)', '=SUBTOTAL(5,A1:E1)'],
      ['=SUBTOTAL(6,A1:B1)', '=SUBTOTAL(7,A1:B1)', '=SUBTOTAL(8,A1:B1)', '=SUBTOTAL(9,A1:E1)', '=SUBTOTAL(10,A1:B1)'],
      ['=SUBTOTAL(11,A1:B1)', '=SUBTOTAL(101,A1:E1)', '=SUBTOTAL(102,A1:E1)', '=SUBTOTAL(103,A1:E1)', '=SUBTOTAL(109,A1:E1)'],
    ])
    assert.deepEqual(result.values[1], ['3', '2', '4', '4', '2'])
    assert.deepEqual(result.values[2], ['8', '1.4142135624', '1', '6', '2'])
    assert.deepEqual(result.values[3], ['1', '3', '2', '4', '6'])
  } finally { await vite.close() }
})

test('SUBTOTAL propagates referenced errors and rejects unsupported codes or missing ranges', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet } = await vite.ssrLoadModule('/src/sheet.ts')
    const result = evaluateSheet([
      ['=1/0', '2', '=SUBTOTAL(9,A1:B1)', '=SUBTOTAL(12,A1:B1)', '=SUBTOTAL(9)', '=SUBTOTAL(7,A2:A2)'],
      ['1', '1'],
    ])
    assert.deepEqual(result.values[0].slice(2), ['#DIV/0!', '#VALUE!', '#VALUE!', '#DIV/0!'])
  } finally { await vite.close() }
})
