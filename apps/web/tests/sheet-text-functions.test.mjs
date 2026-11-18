import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('spreadsheet text formulas join ranges, transform Unicode and replace bounded matches', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet } = await vite.ssrLoadModule('/src/sheet.ts')
    const result = evaluateSheet([
      ['canva', '', 'SUITE', '=TEXTJOIN("-",TRUE,A1:C1)', '=TEXTO.JUNTAR("/";FALSO;A1:B1)', '=EXACT(A1,"Canva")', '=EXACT(A1,"canva")', '=PROPER("cANVA design-éCOLE")', '=SUBSTITUTE("banana","a","o",2)', '=REPLACE("abcdef",2,3,"XY")', '=FIND("V","Canva")', '=SEARCH("V","Canva")', '=VALUE("12.5")'],
      ['=TEXTJOIN(",",TRUE,A1:B1)', '=LIMPAR("a\u0001b")', '=LOCALIZAR("v","Canva")'],
    ])
    assert.deepEqual(result.values[0].slice(3), ['canva-SUITE', 'canva/', 'FALSE', 'TRUE', 'Canva Design-École', 'banona', 'aXYef', '#VALUE!', '4', '12.5'])
    assert.deepEqual(result.values[1].slice(0, 3), ['canva', 'ab', '4'])
    assert.deepEqual(result.errors, ['#VALUE!'])
  } finally { await vite.close() }
})

test('spreadsheet text functions report invalid search, instance and number input', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet } = await vite.ssrLoadModule('/src/sheet.ts')
    const result = evaluateSheet([['=SEARCH("z","Canva")', '=SUBSTITUTE("aaa","a","b",0)', '=VALUE("12,5")', '=TEXTJOIN("-",TRUE,1/0,"x")']])
    assert.deepEqual(result.values[0], ['#VALUE!', '#VALUE!', '#VALUE!', '#DIV/0!'])
    assert.ok(result.errors.includes('#DIV/0!'))
  } finally { await vite.close() }
})
