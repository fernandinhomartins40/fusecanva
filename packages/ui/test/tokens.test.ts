// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildTokensCss, colorRoles, colorVar, fontLicenses, themes } from '../src/tokens/index.js'

const css = buildTokensCss()
const componentsCss = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8')

describe('tokens CSS', () => {
  it('declara todos os papeis de cor nos dois temas', () => {
    for (const role of colorRoles) {
      expect(css).toContain(`${colorVar(role)}: ${themes.light[role]};`)
      expect(css).toContain(`${colorVar(role)}: ${themes.dark[role]};`)
    }
  })

  it('tem tema por atributo, preferencia do sistema e movimento reduzido', () => {
    expect(css).toContain('[data-fuse-theme="dark"]')
    expect(css).toContain('@media (prefers-color-scheme: dark)')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('toda custom property usada pelos componentes existe nos tokens', () => {
    const declared = new Set([...css.matchAll(/(--fuse-[a-z0-9-]+):/g)].map((m) => m[1]))
    const used = new Set([...componentsCss.matchAll(/var\((--fuse-[a-z0-9-]+)\)/g)].map((m) => m[1]))
    const missing = [...used].filter((name) => !declared.has(name))
    expect(missing).toEqual([])
  })

  it('so referencia fontes com licenca OFL', () => {
    for (const license of Object.values(fontLicenses)) expect(license).toBe('OFL-1.1')
  })
})
