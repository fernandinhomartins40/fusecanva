import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('MEDIAN and MODE ignore nonnumeric range cells and handle empty or tied data', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet } = await vite.ssrLoadModule('/src/sheet.ts')
    const result = evaluateSheet([
      ['1', '5', '5', '9', 'word', '', '2', '2', '1', '1'],
      ['=MEDIAN(A1:D1)', '=MEDIANA(A1:C1)', '=MEDIAN(A1:A1,B1:B1)', '=MEDIAN(E1:F1)', '=MODE(A1:D1)', '=MODA(A1:D1)', '=MODE.SNGL(A1:D1)', '=MODE(A1:B1)', '=MODE(E1:F1)', '=MODE(G1:J1)'],
    ])
    assert.deepEqual(result.values[1], ['5', '5', '3', '#NUM!', '5', '5', '5', '#N/A', '#N/A', '2'])
  } finally { await vite.close() }
})

test('statistical functions propagate errors from referenced cells', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet } = await vite.ssrLoadModule('/src/sheet.ts')
    const result = evaluateSheet([['=1/0', '2', '=MEDIAN(A1:B1)', '=MODE(A1:B1)']])
    assert.deepEqual(result.values[0], ['#DIV/0!', '2', '#DIV/0!', '#DIV/0!'])
  } finally { await vite.close() }
})

test('variance, standard deviation, quartile and percentile support sample/population and localized names', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet } = await vite.ssrLoadModule('/src/sheet.ts')
    const result = evaluateSheet([
      ['1', '5', '9', 'texto', ''],
      ['=VAR.S(A1:C1)', '=VAR.P(A1:C1)', '=STDEV.S(A1:C1)', '=STDEV.P(A1:C1)', '=VARIANCIAP(A1:C1)'],
      ['=QUARTILE(A1:C1,1)', '=QUARTILE.EXC(A1:C1,1)', '=PERCENTILE.INC(A1:C1,0.25)', '=PERCENTIL.EXC(A1:C1,0.25)', '=QUARTIL(A1:C1,2)'],
      ['=VAR.S(A1:A1)', '=VAR.P(A1:A1)', '=PERCENTILE.EXC(A1:C1,0)', '=QUARTILE(A1:C1,5)'],
    ])
    assert.deepEqual(result.values[1], ['16', '10.6666666667', '4', '3.2659863237', '10.6666666667'])
    assert.deepEqual(result.values[2], ['3', '1', '3', '1', '5'])
    assert.deepEqual(result.values[3], ['#DIV/0!', '0', '#NUM!', '#NUM!', ''])
  } finally { await vite.close() }
})
