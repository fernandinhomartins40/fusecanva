import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('audited formula dependency edits recalculate through merged anchors and undo restores prior results', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet, setSheetCell } = await vite.ssrLoadModule('/src/sheet.ts')
    const baseline = [
      ['=4+0', '', '=8/2', '', '', '', ''],
      ['', '', '', '', '', '', ''],
      ['', '', '', '', '', '', ''],
      ['', '', '', '', '', '', ''],
      ['', '', '', '', '', '', ''],
      ['', '', '', '', '', '', ''],
      ['', '', '=A1+C1', '', '=C7*2', '=D8*2', ''],
      ['', '', '', '', '', '', ''],
    ]
    const merges = [{ row: 6, column: 2, colSpan: 2 }]
    const checkpoint = structuredClone(baseline)

    assert.deepEqual(
      [evaluateSheet(baseline, merges).values[0][0], evaluateSheet(baseline, merges).values[6][2], evaluateSheet(baseline, merges).values[6][4], evaluateSheet(baseline, merges).values[6][5]],
      ['4', '8', '16', '0'],
    )

    const edited = setSheetCell(baseline, 0, 0, '=4+2')
    const recalculated = evaluateSheet(edited, merges)
    assert.deepEqual([recalculated.values[0][0], recalculated.values[6][2], recalculated.values[6][4], recalculated.values[6][5]], ['6', '10', '20', '0'])

    const failed = evaluateSheet(setSheetCell(baseline, 0, 0, '=4+0/0'), merges)
    assert.equal(failed.values[0][0], '#DIV/0!')
    assert.equal(failed.values[6][2], '#DIV/0!')
    assert.equal(failed.values[6][4], '#DIV/0!')
    assert.equal(failed.values[6][5], '0')
    assert.ok(failed.errors.includes('#DIV/0!'))

    // The app's undo stack restores a prior document snapshot; evaluating that
    // restored content must discard the prior calculation cache and recover the chain.
    const restored = evaluateSheet(structuredClone(checkpoint), merges)
    assert.deepEqual([restored.values[0][0], restored.values[6][2], restored.values[6][4], restored.values[6][5]], ['4', '8', '16', '0'])
  } finally { await vite.close() }
})
