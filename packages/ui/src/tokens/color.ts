// Paleta propria do Fuse Studio: "brasa" (acento quente) sobre neutros "grafite" levemente quentes.
// Os valores sao definidos aqui e verificados por teste automatizado (test/contrast.test.ts).

import type { ContrastLevel } from './contrast.js'

export const colorRoles = [
  'bg',
  'bgSubtle',
  'surface',
  'surfaceRaised',
  'surfaceSunken',
  'surfaceHover',
  'border',
  'borderStrong',
  'text',
  'textMuted',
  'textInverse',
  'accent',
  'accentHover',
  'accentActive',
  'accentSubtle',
  'accentText',
  'onAccent',
  'focusRing',
  'successSolid',
  'successText',
  'successSubtle',
  'onSuccess',
  'warningSolid',
  'warningText',
  'warningSubtle',
  'onWarning',
  'dangerSolid',
  'dangerText',
  'dangerSubtle',
  'onDanger',
  'infoSolid',
  'infoText',
  'infoSubtle',
  'onInfo',
  'overlay',
] as const

export type ColorRole = (typeof colorRoles)[number]
export type ColorScheme = Record<ColorRole, string>
export type ThemeName = 'light' | 'dark'

export const lightColors: ColorScheme = {
  bg: '#ffffff',
  bgSubtle: '#f6f5f3',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  surfaceSunken: '#efedea',
  surfaceHover: '#f0eeeb',
  border: '#dedad5',
  borderStrong: '#857e77',
  text: '#1c1a18',
  textMuted: '#5c5751',
  textInverse: '#f6f5f3',
  accent: '#c23c12',
  accentHover: '#a83410',
  accentActive: '#8e2c0e',
  accentSubtle: '#fcede6',
  accentText: '#a83410',
  onAccent: '#ffffff',
  focusRing: '#2457c5',
  successSolid: '#1e7a46',
  successText: '#17633a',
  successSubtle: '#e6f4ec',
  onSuccess: '#ffffff',
  warningSolid: '#f2b544',
  warningText: '#82470a',
  warningSubtle: '#fdf3e1',
  onWarning: '#1c1a18',
  dangerSolid: '#c0263a',
  dangerText: '#a61f31',
  dangerSubtle: '#fce9eb',
  onDanger: '#ffffff',
  infoSolid: '#2457c5',
  infoText: '#1f4ba8',
  infoSubtle: '#e8effc',
  onInfo: '#ffffff',
  overlay: '#1c1a18',
}

export const darkColors: ColorScheme = {
  bg: '#151413',
  bgSubtle: '#1c1b19',
  surface: '#201e1c',
  surfaceRaised: '#2a2725',
  surfaceSunken: '#111010',
  surfaceHover: '#302d2a',
  border: '#3a3633',
  borderStrong: '#7d766f',
  text: '#f3f1ee',
  textMuted: '#ada69e',
  textInverse: '#1c1a18',
  accent: '#f2703f',
  accentHover: '#f5875c',
  accentActive: '#e8622f',
  accentSubtle: '#3a1f14',
  accentText: '#f59a72',
  onAccent: '#1a0c06',
  focusRing: '#7fa6f5',
  successSolid: '#4cc487',
  successText: '#6fd19f',
  successSubtle: '#15291d',
  onSuccess: '#0d1f14',
  warningSolid: '#f2b544',
  warningText: '#f4c56a',
  warningSubtle: '#2e2412',
  onWarning: '#1c1a18',
  dangerSolid: '#f06b78',
  dangerText: '#f48a94',
  dangerSubtle: '#34171b',
  onDanger: '#1f0a0d',
  infoSolid: '#7fa6f5',
  infoText: '#94b5f7',
  infoSubtle: '#16213a',
  onInfo: '#0b1530',
  overlay: '#000000',
}

export const themes: Record<ThemeName, ColorScheme> = {
  light: lightColors,
  dark: darkColors,
}

/** Par primeiro plano / fundo que a UI realmente usa, com o minimo WCAG AA exigido. */
export interface ContrastPair {
  fg: ColorRole
  bg: ColorRole
  level: ContrastLevel
}

const textSurfaces: ColorRole[] = ['bg', 'bgSubtle', 'surface', 'surfaceRaised', 'surfaceSunken', 'surfaceHover']

/** Todos os pares obrigatorios. O teste de contraste falha se qualquer um ficar abaixo do minimo. */
export const contrastPairs: readonly ContrastPair[] = [
  ...textSurfaces.flatMap((bg): ContrastPair[] => [
    { fg: 'text', bg, level: 'text' },
    { fg: 'textMuted', bg, level: 'text' },
    { fg: 'accentText', bg, level: 'text' },
    { fg: 'borderStrong', bg, level: 'ui' },
    { fg: 'focusRing', bg, level: 'ui' },
  ]),
  { fg: 'text', bg: 'accentSubtle', level: 'text' },
  { fg: 'accentText', bg: 'accentSubtle', level: 'text' },
  { fg: 'onAccent', bg: 'accent', level: 'text' },
  { fg: 'onAccent', bg: 'accentHover', level: 'text' },
  { fg: 'onAccent', bg: 'accentActive', level: 'text' },
  { fg: 'accent', bg: 'bg', level: 'ui' },
  { fg: 'accent', bg: 'surface', level: 'ui' },
  { fg: 'textInverse', bg: 'text', level: 'text' },
  { fg: 'successText', bg: 'successSubtle', level: 'text' },
  { fg: 'successText', bg: 'surface', level: 'text' },
  { fg: 'onSuccess', bg: 'successSolid', level: 'text' },
  { fg: 'warningText', bg: 'warningSubtle', level: 'text' },
  { fg: 'warningText', bg: 'surface', level: 'text' },
  { fg: 'onWarning', bg: 'warningSolid', level: 'text' },
  { fg: 'dangerText', bg: 'dangerSubtle', level: 'text' },
  { fg: 'dangerText', bg: 'surface', level: 'text' },
  { fg: 'onDanger', bg: 'dangerSolid', level: 'text' },
  { fg: 'infoText', bg: 'infoSubtle', level: 'text' },
  { fg: 'infoText', bg: 'surface', level: 'text' },
  { fg: 'onInfo', bg: 'infoSolid', level: 'text' },
]
