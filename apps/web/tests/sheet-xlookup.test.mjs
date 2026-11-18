import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('XLOOKUP and PROCX handle vertical/horizontal ranges, first/last search, defaults, shapes, and errors', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet } = await vite.ssrLoadModule('/src/sheet.ts')
    const result = evaluateSheet([
      ['apple', '10', '=XLOOKUP("apple",A1:A3,B1:B3)', '=XLOOKUP("apple",A1:A3,B1:B3,,0,-1)', '=PROCX("banana",A1:A3,B1:B3)', '=XLOOKUP("missing",A1:A3,B1:B3)', '=XLOOKUP("missing",A1:A3,B1:B3,"not found")'],
      ['banana', '20'],
      ['apple', '30'],
      ['=XLOOKUP("Q1",A5:C5,A6:C6)', '=XLOOKUP("Q1",A5:C5,A6:C6,,,-1)', '=XLOOKUP("Q2",A5:C5,A6:C6)'],
      ['Q1', 'Q2', 'Q1'],
      ['100', '200', '300'],
      ['=XLOOKUP("apple",A1:A3,B1:B2)', '=XLOOKUP("apple",A1:B2,B1:B2)', '=XLOOKUP("apple",A1:A3,B1:C3)', '=XLOOKUP("apple",A1:A3,B1:B3,"",0,2)'],
      ['=1/0', '5', '=XLOOKUP(5,A8:A9,B8:B9)'],
      ['1', '=1/0', '=XLOOKUP(1,A9:A9,B9:B9)'],
      ['dup', '11'],
      ['dup', '22', '=XLOOKUP("dup",A10:A11,B10:B11)', '=XLOOKUP("dup",A10:A11,B10:B11,,0,-1)'],
    ])

    assert.deepEqual(result.values[0].slice(2), ['10', '30', '20', '#N/A', 'not found'])
    assert.deepEqual(result.values[3].slice(0, 3), ['100', '300', '200'])
    assert.deepEqual(result.values[6].slice(0, 4), ['#VALUE!', '#VALUE!', '#VALUE!', '#VALUE!'])
    assert.equal(result.values[7][2], '#DIV/0!', 'an error encountered in the lookup range propagates')
    assert.equal(result.values[8][2], '#DIV/0!', 'an error in the selected return cell propagates')
    assert.deepEqual(result.values[10].slice(2, 4), ['11', '22'], 'search mode 1 returns the first match and -1 returns the last match')
    assert.ok(result.errors.includes('#N/A'))
    assert.ok(result.errors.includes('#VALUE!'))
    assert.ok(result.errors.includes('#DIV/0!'))
  } finally { await vite.close() }
})
