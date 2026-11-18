import { readFile, writeFile } from 'node:fs/promises'

const root = new URL('../src/', import.meta.url)
const special = new Map([[0x20ac,0x80],[0x0081,0x81],[0x201a,0x82],[0x0192,0x83],[0x201e,0x84],[0x2026,0x85],[0x2020,0x86],[0x2021,0x87],[0x02c6,0x88],[0x2030,0x89],[0x0160,0x8a],[0x2039,0x8b],[0x0152,0x8c],[0x008d,0x8d],[0x017d,0x8e],[0x008f,0x8f],[0x0090,0x90],[0x2018,0x91],[0x2019,0x92],[0x201c,0x93],[0x201d,0x94],[0x2022,0x95],[0x2013,0x96],[0x2014,0x97],[0x02dc,0x98],[0x2122,0x99],[0x0161,0x9a],[0x203a,0x9b],[0x0153,0x9c],[0x009d,0x9d],[0x017e,0x9e],[0x0178,0x9f]])
const marker = /(?:Ã[\u0080-\u00ff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]|Â[\u0080-\u00ff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]|â€|â[†‡]|Æ’)/u
const decoder = new TextDecoder('utf-8', { fatal: true })

function undoOneLayer(token) {
  const bytes = []
  for (const character of token) {
    const code = character.codePointAt(0)
    const byte = code <= 0x7f || (code >= 0xa0 && code <= 0xff) ? code : special.get(code)
    if (byte === undefined) { if (process.env.NORMALIZE_DEBUG) console.log('unmapped', JSON.stringify(character), code.toString(16)); return null }
    bytes.push(byte)
  }
  try { return decoder.decode(Uint8Array.from(bytes)) } catch (error) { if (process.env.NORMALIZE_DEBUG) console.log('decode failed', JSON.stringify(bytes.map(value => value.toString(16))), error.message); return null }
}

function repair(text) {
  return text.replace(/[^ \t\r\n"'`<>={}]+/gu, token => {
    if (!marker.test(token)) return token
    if (token.startsWith('Shift+') && token.includes('\u0090/') && token.endsWith('â€ ’')) return 'Shift+←/→'
    let current = token
    for (let pass = 0; pass < 4 && marker.test(current); pass += 1) {
      const next = undoOneLayer(current)
      if (process.env.NORMALIZE_DEBUG && marker.test(token)) console.log('pass', pass, JSON.stringify(current), JSON.stringify(next))
      if (!next || next === current) break
      current = next
    }
    return current
  })
}

const files = ['App.tsx', 'excel.ts', 'export.ts']
for (const name of files) {
  const file = new URL(name, root)
  const original = await readFile(file, 'utf8')
  const next = repair(original)
  const before = original.match(/(?:Ã[\u0080-\u00ff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]|Â[\u0080-\u00ff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]|â€|â[†‡]|Æ’)/gu)?.length ?? 0
  const after = next.match(/(?:Ã[\u0080-\u00ff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]|Â[\u0080-\u00ff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]|â€|â[†‡]|Æ’)/gu)?.length ?? 0
  if (process.argv.includes('--write')) await writeFile(file, next, 'utf8')
  console.log(`${name}: suspect sequences ${before} -> ${after}; ${process.argv.includes('--write') ? 'written' : 'dry-run'}`)
  if (after) console.log('  remaining:', [...new Set(next.split(/[ \t\r\n]+/u).filter(token => marker.test(token)))].slice(0, 30).map(token => ({ token: JSON.stringify(token), codepoints: [...token].map(character => character.codePointAt(0).toString(16)) })))
}
