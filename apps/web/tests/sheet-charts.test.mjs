import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('sheet chart range resolves calculated numeric values, labels and a stable plot domain', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { getSheetChartPoints, getSheetChartDomain } = await vite.ssrLoadModule('/src/sheet-charts.ts')
    const chart = { id: 'chart-1', type: 'line', title: 'Receita', range: { startRow: 0, startColumn: 0, endRow: 3, endColumn: 2 } }
    const values = [
      ['Mês', 'Receita', 'Custo'],
      ['Jan', '120', '80'],
      ['Fev', '150', '92'],
      ['Mar', '180', '110'],
    ]
    const points = getSheetChartPoints(chart, values)
    assert.equal(points.length, 6)
    assert.deepEqual(points[0], { label: 'Jan', value: 120, series: 'Receita', seriesIndex: 0, rowIndex: 0 })
    assert.deepEqual(points.at(-1), { label: 'Mar', value: 110, series: 'Custo', seriesIndex: 1, rowIndex: 2 })
    assert.deepEqual(getSheetChartDomain(points), { min: -14.4, max: 194.4 })
    const changedValues = values.map(row => [...row])
    changedValues[1][1] = '220'
    assert.equal(getSheetChartPoints(chart, changedValues)[0].value, 220, 'chart values resolve against the latest calculated cells')
    assert.deepEqual(getSheetChartDomain([]), { min: 0, max: 1 })
  } finally { await vite.close() }
})

test('sheet chart point parsing skips non-numeric cells and accepts Brazilian decimal values', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { getSheetChartPoints } = await vite.ssrLoadModule('/src/sheet-charts.ts')
    const chart = { id: 'chart-1', type: 'bar', title: '', range: { startRow: 0, startColumn: 0, endRow: 3, endColumn: 1 } }
    const points = getSheetChartPoints(chart, [['Item', 'Valor'], ['A', '1,5'], ['B', 'texto'], ['C', '2,75']])
    assert.deepEqual(points.map(point => [point.label, point.value]), [['A', 1.5], ['C', 2.75]])
  } finally { await vite.close() }
})
