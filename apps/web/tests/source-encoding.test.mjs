import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const sourceRoot = path.resolve('src')

test('visible interface and export source text has no UTF-8 mojibake sequences', async () => {
  const files = ['BulkCreatePanel.tsx', 'App.tsx', 'excel.ts', 'export.ts', 'apps-catalog.mjs', 'PrintSandbox.tsx', 'print-sandbox.mjs']
  const corrupted = /(?:Ã[\u0080-\u00ff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]|Â[\u0080-\u00ff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]|â€|â[†‡]|Æ’)/u
  for (const file of files) {
    const source = await readFile(path.join(sourceRoot, file), 'utf8')
    assert.doesNotMatch(source, corrupted, `${file} should contain readable Portuguese accents and punctuation`)
  }
})
