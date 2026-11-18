import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('SUMPRODUCT evaluates aligned ranges, scalar broadcasting and text/boolean coercion', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet } = await vite.ssrLoadModule('/src/sheet.ts')
    const result = evaluateSheet([
      ['2', '3', '=SUMPRODUCT(A1:B1,A2:B2)', '=SOMARPRODUTO(A1:A3,B1:B3)', '=SUMPRODUCT(A1:A3,2)'],
      ['4', '5', '', ''],
      ['6', '7', '', ''],
      ['texto', '8', '=SUMPRODUCT(A4:B4,A1:B1)', '=SUMPRODUCT(A1:A2,B1:B1)'],
    ])
    assert.deepEqual(result.values[0].slice(2), ['23', '68', '24'])
    assert.deepEqual(result.values[3].slice(2, 4), ['24', '#VALUE!'])
    assert.deepEqual(result.errors, ['#VALUE!'])
  } finally { await vite.close() }
})

test('SUMPRODUCT propagates cell errors and returns zero for nonnumeric text arrays', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet } = await vite.ssrLoadModule('/src/sheet.ts')
    const result = evaluateSheet([['text', '=SUMPRODUCT(A1:A1,3)', '=SUMPRODUCT(A2:A2,3)'], ['=1/0']])
    assert.equal(result.values[0][1], '0')
    assert.equal(result.values[0][2], '#DIV/0!')
    assert.ok(result.errors.includes('#DIV/0!'))
  } finally { await vite.close() }
})
