import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('Docs inline marks toggle selected ranges, preserve outside formatting, and track text edits', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const format = await vite.ssrLoadModule('/src/doc-format.ts')
    const bold = format.toggleDocInlineMark([], 2, 7, 'bold')
    assert.deepEqual(bold, [{ start: 2, end: 7, bold: true }])
    assert.deepEqual(format.getDocTextRuns('hello world', bold).map(({ text, bold: active }) => [text, active]), [['he', false], ['llo w', true], ['orld', false]])
    const mixed = format.toggleDocInlineMark([...bold, { start: 0, end: 2, italic: true }], 4, 6, 'italic')
    assert.deepEqual(mixed, [{ start: 0, end: 2, italic: true }, { start: 2, end: 4, bold: true }, { start: 4, end: 6, bold: true, italic: true }, { start: 6, end: 7, bold: true }])
    const toggledOff = format.toggleDocInlineMark(bold, 2, 7, 'bold')
    assert.deepEqual(toggledOff, [])
    assert.deepEqual(format.remapDocInlineMarks('hello world', 'heXllo world', bold), [{ start: 2, end: 8, bold: true }])
    assert.deepEqual(format.remapDocInlineMarks('hello world', 'hello!', [{ start: 0, end: 5, italic: true }]), [{ start: 0, end: 6, italic: true }])
    const replaced = format.replaceDocText('bold plain bold', [{ start: 0, end: 4, bold: true }], 'bold', 'strong')
    assert.equal(replaced.text, 'strong plain strong')
    assert.equal(replaced.count, 2)
    assert.deepEqual(replaced.marks, [{ start: 0, end: 6, bold: true }])

    const decorated = format.toggleDocInlineMark([], 1, 5, 'underline')
    const overlapping = format.toggleDocInlineMark(decorated, 3, 6, 'strike')
    assert.deepEqual(overlapping, [
      { start: 1, end: 3, underline: true },
      { start: 3, end: 5, underline: true, strike: true },
      { start: 5, end: 6, strike: true },
    ])
    assert.deepEqual(format.getDocTextRuns('abcdef', overlapping).map(({ text, underline, strike }) => [text, underline, strike]), [
      ['a', false, false], ['bc', true, false], ['de', true, true], ['f', false, true],
    ])
    assert.deepEqual(format.toggleDocInlineMark(overlapping, 3, 5, 'underline'), [
      { start: 1, end: 3, underline: true },
      { start: 3, end: 6, strike: true },
    ], 'toggling underline preserves the overlapping strike range')
    assert.deepEqual(format.remapDocInlineMarks('abcdef', 'abXYef', [
      { start: 1, end: 5, underline: true },
      { start: 3, end: 6, strike: true },
    ]), [
      { start: 1, end: 5, underline: true },
      { start: 4, end: 6, strike: true },
    ], 'editing keeps underline and strike on unaffected/inherited text')
    const replacedDecorated = format.replaceDocText('old plain', [{ start: 0, end: 3, underline: true, strike: true }], 'old', 'new')
    assert.deepEqual(replacedDecorated.marks, [{ start: 0, end: 3, underline: true, strike: true }], 'replace preserves both decorations on replacement text')
  } finally {
    await vite.close()
  }
})
