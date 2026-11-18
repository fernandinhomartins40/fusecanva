import { describe, expect, it } from 'vitest'
import { detectSchemaVersion, FuseFormatError, migrate, MIGRATIONS } from '../src/index.js'
import { loadFixture } from './helpers.js'
import { makeFile } from './samples.js'

describe('migrate()', () => {
  it('detecta a versão (0 = legado, n = schemaVersion)', () => {
    expect(detectSchemaVersion(loadFixture('legacy/blank-design.json'))).toBe(0)
    expect(detectSchemaVersion(makeFile())).toBe(1)
    expect(Object.keys(MIGRATIONS)).toEqual(['0'])
  })

  it('arquivo v1 passa direto', () => {
    const file = makeFile()
    expect(migrate(file)).toEqual(file)
  })

  it('legado é migrado e validado', () => {
    expect(migrate(loadFixture('legacy/starter-editorial.json')).schemaVersion).toBe(1)
  })

  it.each([null, 1, 'x', {}, { format: 'fuse' }, { format: 'fuse', schemaVersion: 0 }, { format: 'fuse', schemaVersion: 1.5 }, { format: 'outro', schemaVersion: 1 }])(
    'rejeita conteúdo não reconhecido: %j', input => {
      expect(() => migrate(input)).toThrow(expect.objectContaining({ code: 'unrecognized' }))
    })

  it('rejeita versões futuras com mensagem clara', () => {
    try {
      migrate({ ...makeFile(), schemaVersion: 99 })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(FuseFormatError)
      expect((error as FuseFormatError).code).toBe('unsupported-version')
      expect((error as Error).message).toContain('versão 99')
    }
  })

  it('reporta documento inválido com caminho', () => {
    const file = makeFile()
    expect(() => migrate({ ...file, meta: { ...file.meta, title: 5 } })).toThrow(/meta\.title/)
    expect(() => migrate({ ...file, pages: 'x' })).toThrow(expect.objectContaining({ code: 'invalid' }))
  })
})
