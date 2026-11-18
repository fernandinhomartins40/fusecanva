// Tokens nao cromaticos: tipografia, espaco, raio, sombra, movimento e camadas.

/** Fontes com licenca SIL Open Font License (OFL 1.1). Os arquivos sao servidos pelo app/pacote de texto. */
export const fontFamilies = {
  sans: "'Inter', 'Inter Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  display: "'Fraunces', 'Inter', Georgia, serif",
  mono: "'JetBrains Mono', ui-monospace, 'Cascadia Code', Menlo, Consolas, monospace",
} as const

/** Licenca de cada familia de fonte referenciada nos tokens. */
export const fontLicenses = {
  Inter: 'OFL-1.1',
  Fraunces: 'OFL-1.1',
  'JetBrains Mono': 'OFL-1.1',
} as const

export const fontSizes = {
  xs: '0.75rem',
  sm: '0.8125rem',
  md: '0.875rem',
  lg: '1rem',
  xl: '1.25rem',
  '2xl': '1.5rem',
  '3xl': '2rem',
} as const

export const fontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const

export const lineHeights = {
  tight: '1.2',
  normal: '1.45',
  relaxed: '1.6',
} as const

export const space = {
  '0': '0',
  '0-5': '2px',
  '1': '4px',
  '1-5': '6px',
  '2': '8px',
  '3': '12px',
  '4': '16px',
  '5': '20px',
  '6': '24px',
  '8': '32px',
  '10': '40px',
  '12': '48px',
  '16': '64px',
} as const

export const radii = {
  none: '0',
  sm: '4px',
  md: '6px',
  lg: '10px',
  xl: '14px',
  full: '9999px',
} as const

export const shadows = {
  light: {
    sm: '0 1px 2px rgb(28 26 24 / 0.08)',
    md: '0 2px 6px rgb(28 26 24 / 0.08), 0 1px 2px rgb(28 26 24 / 0.06)',
    lg: '0 8px 24px rgb(28 26 24 / 0.12), 0 2px 6px rgb(28 26 24 / 0.06)',
    overlay: '0 16px 48px rgb(28 26 24 / 0.18), 0 4px 12px rgb(28 26 24 / 0.08)',
  },
  dark: {
    sm: '0 1px 2px rgb(0 0 0 / 0.4)',
    md: '0 2px 6px rgb(0 0 0 / 0.45), 0 1px 2px rgb(0 0 0 / 0.3)',
    lg: '0 8px 24px rgb(0 0 0 / 0.5), 0 2px 6px rgb(0 0 0 / 0.3)',
    overlay: '0 16px 48px rgb(0 0 0 / 0.6), 0 4px 12px rgb(0 0 0 / 0.35)',
  },
} as const

export type ShadowName = keyof (typeof shadows)['light']

export const durations = {
  instant: '0ms',
  fast: '120ms',
  base: '180ms',
  slow: '280ms',
} as const

export const easings = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  enter: 'cubic-bezier(0, 0, 0.2, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
  emphasized: 'cubic-bezier(0.3, 0, 0, 1.15)',
} as const

export const zIndices = {
  base: '0',
  sticky: '100',
  dropdown: '1000',
  overlay: '1100',
  modal: '1200',
  popover: '1300',
  toast: '1400',
  tooltip: '1500',
} as const
