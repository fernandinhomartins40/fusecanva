// Calculo de contraste conforme WCAG 2.2 (luminancia relativa sRGB).

export interface Rgb {
  r: number
  g: number
  b: number
}

/** Converte `#rgb` ou `#rrggbb` em componentes 0-255. */
export function parseHex(hex: string): Rgb {
  const raw = hex.trim().replace(/^#/, '')
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Cor hexadecimal invalida: ${hex}`)
  }
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  }
}

function channel(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Luminancia relativa (0 = preto, 1 = branco). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Razao de contraste entre duas cores, de 1 a 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Minimos WCAG AA: texto normal 4.5, texto grande 3, componentes de UI e foco 3 (1.4.11). */
export const WCAG_AA = {
  text: 4.5,
  largeText: 3,
  ui: 3,
} as const

export type ContrastLevel = keyof typeof WCAG_AA

export function meetsAA(fg: string, bg: string, level: ContrastLevel = 'text'): boolean {
  return contrastRatio(fg, bg) >= WCAG_AA[level]
}
