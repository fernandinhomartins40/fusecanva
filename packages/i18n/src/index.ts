// @fuse/i18n - catalogos ICU MessageFormat (FormatJS) em pt-BR e en, com helper `t()` tipado.

import { createIntl, createIntlCache, type IntlShape } from '@formatjs/intl'
import { en } from './catalogs/en.js'
import { ptBR, type MessageKey } from './catalogs/pt-BR.js'

export type { MessageKey }
export { en, ptBR }

export const SUPPORTED_LOCALES = ['pt-BR', 'en'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'pt-BR'

export type Catalog = Record<MessageKey, string>

export const catalogs: Record<Locale, Catalog> = {
  'pt-BR': ptBR,
  en,
}

/** Valores aceitos em argumentos ICU. */
export type MessageValues = Record<string, string | number | boolean | Date | null | undefined>

export interface I18n {
  readonly locale: Locale
  /** Formata a mensagem da chave com os valores ICU. Chave ausente cai no catalogo padrao e depois na propria chave. */
  t: (key: MessageKey, values?: MessageValues) => string
  /** Acesso ao objeto FormatJS para numeros, datas, listas e tempo relativo. */
  readonly intl: IntlShape<string>
}

/** Escolhe o melhor idioma suportado a partir das preferencias (ex.: `navigator.languages`). */
export function resolveLocale(preferred: readonly string[] | string | undefined | null): Locale {
  const list = typeof preferred === 'string' ? [preferred] : (preferred ?? [])
  for (const tag of list) {
    const lower = tag.toLowerCase()
    const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === lower)
    if (exact) return exact
    const language = lower.split('-')[0]
    const partial = SUPPORTED_LOCALES.find((l) => l.toLowerCase().split('-')[0] === language)
    if (partial) return partial
  }
  return DEFAULT_LOCALE
}

const cache = createIntlCache()

export interface CreateI18nOptions {
  /** Recebe erros de formatacao/traducao ausente. Padrao: silencioso em producao. */
  onError?: (error: Error) => void
}

export function createI18n(locale: Locale, options: CreateI18nOptions = {}): I18n {
  const messages: Record<string, string> = { ...catalogs[DEFAULT_LOCALE], ...catalogs[locale] }
  const intl = createIntl<string>(
    {
      locale,
      defaultLocale: DEFAULT_LOCALE,
      messages,
      onError: (error) => options.onError?.(error),
    },
    cache,
  )
  const t = (key: MessageKey, values?: MessageValues): string => {
    if (!(key in messages)) return key
    return intl.formatMessage({ id: key }, values as Record<string, string | number | boolean | Date | null | undefined>)
  }
  return { locale, t, intl }
}

let current: I18n = createI18n(DEFAULT_LOCALE)

/** Troca o idioma da instancia global usada por `t()`. */
export function setLocale(locale: Locale): I18n {
  current = createI18n(locale)
  return current
}

export function getI18n(): I18n {
  return current
}

/** Helper global: `t('common.save')`, `t('project.count', { count: 3 })`. */
export function t(key: MessageKey, values?: MessageValues): string {
  return current.t(key, values)
}
