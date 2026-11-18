import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser'
import { describe, expect, it } from 'vitest'
import { catalogs, DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../src/index.js'

function argumentsOf(elements: MessageFormatElement[], out = new Set<string>()): Set<string> {
  for (const el of elements) {
    switch (el.type) {
      case TYPE.argument:
      case TYPE.number:
      case TYPE.date:
      case TYPE.time:
        out.add(`${el.value}:${TYPE[el.type]}`)
        break
      case TYPE.select:
      case TYPE.plural:
        out.add(`${el.value}:${TYPE[el.type]}`)
        for (const option of Object.values(el.options)) argumentsOf(option.value, out)
        break
      case TYPE.tag:
        out.add(`<${el.value}>`)
        argumentsOf(el.children, out)
        break
      default:
        break
    }
  }
  return out
}

const source = catalogs[DEFAULT_LOCALE]
const sourceKeys = Object.keys(source).sort()

describe.each(SUPPORTED_LOCALES)('catalogo %s', (locale) => {
  const catalog = catalogs[locale] as Record<string, string>

  it('nao tem chaves faltantes em relacao ao pt-BR', () => {
    const missing = sourceKeys.filter((key) => !(key in catalog))
    expect(missing).toEqual([])
  })

  it('nao tem chaves sobrando', () => {
    const extra = Object.keys(catalog).filter((key) => !(key in source))
    expect(extra).toEqual([])
  })

  it('nao tem mensagens vazias', () => {
    const empty = Object.entries(catalog).filter(([, msg]) => msg.trim() === '').map(([key]) => key)
    expect(empty).toEqual([])
  })

  it('toda mensagem e ICU valida e usa os mesmos argumentos do pt-BR', () => {
    for (const key of sourceKeys) {
      const message = catalog[key]
      expect(message, key).toBeTypeOf('string')
      const ast = parse(message as string)
      const expected = argumentsOf(parse(source[key as keyof typeof source]))
      expect([...argumentsOf(ast)].sort(), key).toEqual([...expected].sort())
    }
  })
})
