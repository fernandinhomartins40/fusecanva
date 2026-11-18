// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  colorRoles,
  contrastPairs,
  contrastRatio,
  meetsAA,
  relativeLuminance,
  themes,
  WCAG_AA,
  type ThemeName,
} from '../src/tokens/index.js'

describe('contrastRatio', () => {
  it('reproduz valores de referencia da WCAG', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    // #767676 sobre branco e o cinza classico no limite de 4.5:1
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5)
  })

  it('e simetrico', () => {
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(contrastRatio('#abcdef', '#123456'), 10)
  })

  it('calcula luminancia relativa nos extremos', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10)
  })

  it('rejeita cores invalidas', () => {
    expect(() => contrastRatio('red', '#fff')).toThrow()
  })

  it('meetsAA usa os limites por nivel', () => {
    expect(meetsAA('#767676', '#ffffff', 'text')).toBe(true)
    expect(meetsAA('#949494', '#ffffff', 'text')).toBe(false)
    expect(meetsAA('#949494', '#ffffff', 'ui')).toBe(true)
  })
})

describe.each(Object.keys(themes) as ThemeName[])('tema %s', (theme) => {
  const scheme = themes[theme]

  it('define todos os papeis de cor com hex valido', () => {
    for (const role of colorRoles) {
      expect(scheme[role], role).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it.each(contrastPairs.map((p) => [`${p.fg} sobre ${p.bg} (${p.level})`, p] as const))(
    '%s atende WCAG AA',
    (_label, pair) => {
      const ratio = contrastRatio(scheme[pair.fg], scheme[pair.bg])
      expect(ratio, `${theme}: ${pair.fg} ${scheme[pair.fg]} / ${pair.bg} ${scheme[pair.bg]} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
        WCAG_AA[pair.level],
      )
    },
  )
})
