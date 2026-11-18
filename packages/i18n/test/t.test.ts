import { afterEach, describe, expect, it } from 'vitest'
import { createI18n, getI18n, resolveLocale, setLocale, t } from '../src/index.js'

afterEach(() => {
  setLocale('pt-BR')
})

describe('t()', () => {
  it('usa pt-BR por padrao', () => {
    expect(getI18n().locale).toBe('pt-BR')
    expect(t('common.save')).toBe('Salvar')
  })

  it('troca de idioma com setLocale', () => {
    setLocale('en')
    expect(t('common.save')).toBe('Save')
  })

  it('formata plural, select e numero', () => {
    expect(t('project.count', { count: 0 })).toBe('Nenhum projeto')
    expect(t('project.count', { count: 1 })).toBe('1 projeto')
    expect(t('project.count', { count: 3 })).toBe('3 projetos')
    expect(t('share.role', { role: 'viewer' })).toBe('Pode ver')
    expect(t('share.role', { role: 'x' })).toBe('Acesso personalizado')
    const en = createI18n('en')
    expect(en.t('editor.selection.count', { count: 2 })).toBe('2 objects selected')
    expect(en.t('editor.zoom.value', { percent: 1.25 })).toBe('125%')
    expect(en.t('export.progress', { done: 2, total: 5 })).toBe('Exporting page 2 of 5')
  })

  it('expoe formatadores do FormatJS por idioma', () => {
    expect(createI18n('pt-BR').intl.formatNumber(1234.5)).toBe('1.234,5')
    expect(createI18n('en').intl.formatNumber(1234.5)).toBe('1,234.5')
  })

  it('devolve a propria chave quando ela nao existe', () => {
    expect(t('nao.existe' as never)).toBe('nao.existe')
  })
})

describe('resolveLocale', () => {
  it('negocia a partir das preferencias', () => {
    expect(resolveLocale(['en-US', 'pt-BR'])).toBe('en')
    expect(resolveLocale(['pt-PT'])).toBe('pt-BR')
    expect(resolveLocale('PT-br')).toBe('pt-BR')
    expect(resolveLocale(['fr-FR', 'de'])).toBe('pt-BR')
    expect(resolveLocale(undefined)).toBe('pt-BR')
  })
})
