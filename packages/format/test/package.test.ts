import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  ASSET_URI_PREFIX, base64ToBytes, bytesToBase64, fromLegacy, FuseFormatError, packFuse, PACKAGE_EXTENSION, sha256Hex, toLegacy,
  unpackFuse, type FuseFile,
} from '../src/index.js'
import { asJson, loadFixture, loadLegacyFixtures, loadMediaAssets, PNG_DATA_URL } from './helpers.js'
import { makeFile } from './samples.js'

const PNG_BYTES = base64ToBytes(PNG_DATA_URL.split(',')[1]!)

async function zipOf(entries: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(entries)) zip.file(name, content)
  return zip.generateAsync({ type: 'uint8array' })
}

describe('pacote .fuse (zip)', () => {
  it('base64 e sha256 utilitários', async () => {
    expect(bytesToBase64(PNG_BYTES)).toBe(PNG_DATA_URL.split(',')[1])
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('layout: document.json + assets/<sha256> + thumbnail.png', async () => {
    const file = fromLegacy(loadFixture('handmade/kitchen-sink.json'), { assets: loadMediaAssets() })
    const bytes = await packFuse(file, { thumbnail: PNG_BYTES })
    const zip = await JSZip.loadAsync(bytes)
    const hash = await sha256Hex(PNG_BYTES)
    expect(Object.keys(zip.files).sort()).toEqual(['assets/', `assets/${hash}`, 'document.json', 'thumbnail.png'].sort())
    const document = JSON.parse(await zip.file('document.json')!.async('string')) as FuseFile
    expect(JSON.stringify(document)).not.toContain(';base64,')
    expect(JSON.stringify(document)).toContain(`${ASSET_URI_PREFIX}${hash}`)
    expect(document.assets[`sha256:${hash}`]).toMatchObject({ sha256: hash, mime: 'image/png', bytes: PNG_BYTES.byteLength, extensions: { [PACKAGE_EXTENSION]: { dataUrlPrefix: 'data:image/png;base64' } } })
  })

  it('é determinístico (mesmo conteúdo, mesmos bytes)', async () => {
    const file = fromLegacy(loadFixture('handmade/kitchen-sink.json'))
    expect(await packFuse(file)).toEqual(await packFuse(file))
  })

  it.each(loadLegacyFixtures())('roundtrip pack -> unpack(inlineDataUrls) -> toLegacy: $name', async ({ document }) => {
    const file = fromLegacy(document)
    const { file: back, thumbnail, assets } = await unpackFuse(await packFuse(file), { inlineDataUrls: true })
    expect(thumbnail).toBeUndefined()
    expect(asJson(back)).toEqual(asJson(file))
    expect(asJson(toLegacy(back))).toEqual(asJson(document))
    expect(assets).toBeInstanceOf(Map)
  })

  it('roundtrip mantendo ativos externos (sem inline) e com miniatura', async () => {
    const file = fromLegacy(loadFixture('handmade/kitchen-sink.json'), { assets: loadMediaAssets() })
    const result = await unpackFuse(await packFuse(file, { thumbnail: PNG_BYTES }))
    expect(result.thumbnail).toEqual(PNG_BYTES)
    expect(result.assets.get(await sha256Hex(PNG_BYTES))).toEqual(PNG_BYTES)
    expect(JSON.stringify(result.file)).not.toContain(';base64,')
    // Reempacotar o resultado externalizado é estável.
    const again = await unpackFuse(await packFuse(result.file, { assets: result.assets }), { inlineDataUrls: true })
    expect(asJson(again.file)).toEqual(asJson(file))
  })

  it('externalizeDataUrls: false mantém data: URLs inline', async () => {
    const file = fromLegacy(loadFixture('handmade/kitchen-sink.json'))
    const zip = await JSZip.loadAsync(await packFuse(file, { externalizeDataUrls: false }))
    expect(Object.keys(zip.files)).toEqual(['document.json'])
  })

  it('data: URL sem base64 canônico permanece inline', async () => {
    const file = makeFile()
    const odd = { ...file, pages: [{ ...file.pages[0]!, children: [{ id: 'img', type: 'image' as const, x: 0, y: 0, width: 1, height: 1, rotation: 0, src: 'data:image/png;base64,QQ' }, { id: 'img2', type: 'image' as const, x: 0, y: 0, width: 1, height: 1, rotation: 0, src: 'data:image/png;base64,Q===' }] }] }
    const { file: back } = await unpackFuse(await packFuse(odd))
    expect(back).toEqual(odd)
  })

  it('aceita document.json legado dentro do zip (migra)', async () => {
    const legacy = loadFixture('legacy/starter-menu.json')
    const { file } = await unpackFuse(await zipOf({ 'document.json': JSON.stringify(legacy) }))
    expect(asJson(file)).toEqual(asJson(fromLegacy(legacy)))
  })

  it('aceita ArrayBuffer', async () => {
    const bytes = await packFuse(makeFile())
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    expect((await unpackFuse(buffer as ArrayBuffer)).file.id).toBe('file-1')
  })

  describe('erros', () => {
    const expectPackageError = async (promise: Promise<unknown>, pattern: RegExp) => {
      await expect(promise).rejects.toBeInstanceOf(FuseFormatError)
      await expect(promise).rejects.toThrow(pattern)
    }

    it('zip corrompido', async () => {
      await expectPackageError(unpackFuse(new TextEncoder().encode('não é zip')), /corrompido/)
    })
    it('sem document.json', async () => {
      await expectPackageError(unpackFuse(await zipOf({ 'outro.txt': 'x' })), /sem document\.json/)
    })
    it('document.json não-JSON', async () => {
      await expectPackageError(unpackFuse(await zipOf({ 'document.json': '{' })), /não é JSON/)
    })
    it('nome de ativo inválido', async () => {
      await expectPackageError(unpackFuse(await zipOf({ 'document.json': JSON.stringify(makeFile()), 'assets/abc': 'x' })), /Nome de ativo inválido/)
    })
    it('sha256 não confere', async () => {
      await expectPackageError(unpackFuse(await zipOf({ 'document.json': JSON.stringify(makeFile()), [`assets/${'0'.repeat(64)}`]: 'x' })), /sha256 não confere/)
    })
    it('ativo referenciado ausente', async () => {
      const file = makeFile()
      const withRef = { ...file, assets: { a: { mime: 'image/png', src: `${ASSET_URI_PREFIX}${'1'.repeat(64)}` } } }
      await expectPackageError(unpackFuse(await zipOf({ 'document.json': JSON.stringify(withRef) })), /Ativos ausentes/)
      await expectPackageError(packFuse(withRef), /Binários ausentes/)
    })
    it('documento inválido não é empacotado', async () => {
      await expectPackageError(packFuse({ ...makeFile(), id: '' }), /inválido/)
    })
    it('chave de ativo inválida em options.assets', async () => {
      await expectPackageError(packFuse(makeFile(), { assets: new Map([['xyz', new Uint8Array([1])]]) }), /Chave de ativo inválida/)
    })
  })

  it('falha com mensagem clara sem Web Crypto', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
    try {
      await expect(sha256Hex(new Uint8Array([1]))).rejects.toThrow(/Web Crypto/)
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original)
    }
  })
})
