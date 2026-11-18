import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('MAXIFS and MINIFS aggregate only numeric values matching every criterion', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet } = await vite.ssrLoadModule('/src/sheet.ts')
    const result = evaluateSheet([
      ['Fruit', '10', 'North'],
      ['Fruit', '25', 'South'],
      ['Fruit', '', 'North'],
      ['Tool', '5', 'North'],
      ['Tool', '17', 'South'],
      ['Fruit', '4', 'North'],
      [
        '=MAXIFS(B1:B6,A1:A6,"Fruit")',
        '=MAXIMOSES(B1:B6;A1:A6;"Fruit";C1:C6;"North")',
        '=MINIFS(B1:B6,A1:A6,"Fruit")',
        '=MINIMOSES(B1:B6;A1:A6;"Fruit";C1:C6;"North")',
        '=MAXIFS(B1:B6,A1:A6,"missing")',
        '=MINIFS(B1:B6,A1:A6,"missing")',
        '=MAXIFS(B1:B6,A1:A6)',
        '=MINIFS(B1:B6,A1:A6,"Fruit",C1:C5,"North")',
      ],
    ])
    assert.deepEqual(result.values[6], ['25', '10', '4', '4', '0', '0', '#VALUE!', '#VALUE!'])
  } finally { await vite.close() }
})
