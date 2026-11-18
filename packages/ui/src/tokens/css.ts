// Gera as CSS custom properties a partir dos tokens TS (fonte unica de verdade).

import { colorRoles, themes, type ColorRole, type ThemeName } from './color.js'
import {
  durations,
  easings,
  fontFamilies,
  fontSizes,
  fontWeights,
  lineHeights,
  radii,
  shadows,
  space,
  zIndices,
} from './scale.js'

export const CSS_VAR_PREFIX = '--fuse'
export const THEME_ATTRIBUTE = 'data-fuse-theme'

function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

/** Nome da custom property de um papel de cor, ex.: `accentHover` -> `--fuse-color-accent-hover`. */
export function colorVar(role: ColorRole): string {
  return `${CSS_VAR_PREFIX}-color-${kebab(role)}`
}

/** Referencia `var(...)` pronta para uso em estilos inline. */
export function cssVar(name: string): string {
  return `var(${name.startsWith('--') ? name : `${CSS_VAR_PREFIX}-${name}`})`
}

function group(prefix: string, values: Record<string, string>): string[] {
  return Object.entries(values).map(([key, value]) => `  ${CSS_VAR_PREFIX}-${prefix}-${kebab(key)}: ${value};`)
}

function themeDeclarations(theme: ThemeName): string[] {
  const scheme = themes[theme]
  return [
    `  color-scheme: ${theme};`,
    ...colorRoles.map((role) => `  ${colorVar(role)}: ${scheme[role]};`),
    ...group('shadow', shadows[theme]),
  ]
}

/** Folha de estilo completa dos tokens: escalas fixas + tema claro, escuro e preferencia do sistema. */
export function buildTokensCss(): string {
  const base = [
    ...group('font', fontFamilies),
    ...group('font-size', fontSizes),
    ...group('font-weight', fontWeights),
    ...group('line-height', lineHeights),
    ...group('space', space),
    ...group('radius', radii),
    ...group('duration', durations),
    ...group('ease', easings),
    ...group('z', zIndices),
  ]
  const light = themeDeclarations('light')
  const dark = themeDeclarations('dark')
  const reducedMotion = Object.keys(durations).map((key) => `    ${CSS_VAR_PREFIX}-duration-${kebab(key)}: 0ms;`)
  return [
    '/* Gerado por @fuse/ui (src/tokens/css.ts). Nao edite a mao. */',
    `:root {`,
    ...base,
    `}`,
    `:root, [${THEME_ATTRIBUTE}="light"] {`,
    ...light,
    `}`,
    `[${THEME_ATTRIBUTE}="dark"] {`,
    ...dark,
    `}`,
    `@media (prefers-color-scheme: dark) {`,
    `  :root:not([${THEME_ATTRIBUTE}="light"]) {`,
    ...dark.map((line) => `  ${line}`),
    `  }`,
    `}`,
    `@media (prefers-reduced-motion: reduce) {`,
    `  :root {`,
    ...reducedMotion,
    `  }`,
    `}`,
    '',
  ].join('\n')
}
