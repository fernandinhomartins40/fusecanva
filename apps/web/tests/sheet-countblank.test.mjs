import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('COUNTBLANK and CONTAR.VAZIO count empty cells and formulas returning empty text', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet } = await vite.ssrLoadModule('/src/sheet.ts')
    const result = evaluateSheet([
      ['', '', '', ''],
      ['0', '', '', ''],
      ['=IF(TRUE,"","filled")', '', '', ''],
      ['=1/0', '', '', ''],
      ['text', '', '', ''],
      ['', '', '',
        '=COUNTBLANK(A1:A5)',
        '=CONTAR.VAZIO(A1:A5)',
        '=COUNTBLANK(A1:A7)',
        '=COUNTBLANK(A1)',
        '=COUNTBLANK(A1:A5,B1)',
      ],
    ])
    assert.deepEqual(result.values[5].slice(3), ['2', '2', '4', '1', '#VALUE!'])
    assert.ok(result.errors.includes('#DIV/0!'), 'the source range error is reported independently')
  } finally { await vite.close() }
})
