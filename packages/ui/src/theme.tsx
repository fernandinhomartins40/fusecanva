import { createContext, useContext, useEffect, useState, type ComponentProps } from 'react'
import { THEME_ATTRIBUTE } from './tokens/css.js'
import type { ThemeName } from './tokens/color.js'
import { cx } from './utils.js'

export type ThemePreference = ThemeName | 'system'

interface ThemeContextValue {
  preference: ThemePreference
  resolved: ThemeName
}

const ThemeContext = createContext<ThemeContextValue>({ preference: 'system', resolved: 'light' })

function systemTheme(): ThemeName {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Aplica o tema em um elemento (por padrao `<html>`). `system` remove o atributo e segue o SO. */
export function applyTheme(theme: ThemePreference, element: HTMLElement = document.documentElement): void {
  if (theme === 'system') element.removeAttribute(THEME_ATTRIBUTE)
  else element.setAttribute(THEME_ATTRIBUTE, theme)
}

export interface ThemeProviderProps extends ComponentProps<'div'> {
  theme?: ThemePreference
  /**
   * Aplica o tema tambem em `<html>`, para que portais (Dialog, Menu, Toast) herdem as cores.
   * Desligue apenas para pre-visualizacoes locais de tema. Padrao: true.
   */
  applyToDocument?: boolean
}

/** Envolve uma arvore com o tema escolhido. Requer `@fuse/ui/styles.css` carregado. */
export function ThemeProvider({ theme = 'system', applyToDocument = true, className, children, ...rest }: ThemeProviderProps) {
  const [system, setSystem] = useState<ThemeName>(systemTheme)

  useEffect(() => {
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystem(query.matches ? 'dark' : 'light')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [theme])

  useEffect(() => {
    if (!applyToDocument) return undefined
    applyTheme(theme)
    return () => applyTheme('system')
  }, [theme, applyToDocument])

  const resolved = theme === 'system' ? system : theme
  return (
    <ThemeContext.Provider value={{ preference: theme, resolved }}>
      <div {...{ [THEME_ATTRIBUTE]: resolved }} className={cx('fuse-root', className)} {...rest}>
        {children}
      </div>
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}
