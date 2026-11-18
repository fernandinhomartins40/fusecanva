// (De)serialização do pacote .fuse: zip com document.json + assets/<sha256> + thumbnail.png (opcional).
import JSZip from 'jszip'
import { FuseFileSchema, type AssetRef, type FuseFile } from './schema/file.js'
import { FuseFormatError, migrate, type MigrateOptions } from './migrate.js'

export const DOCUMENT_ENTRY = 'document.json'
export const THUMBNAIL_ENTRY = 'thumbnail.png'
export const ASSETS_DIR = 'assets/'
/** Esquema de URI para ativos empacotados: "fuse-asset:<sha256>". */
export const ASSET_URI_PREFIX = 'fuse-asset:'
/** Extensão de AssetRef que marca ativos extraídos de data: URLs durante o empacotamento. */
export const PACKAGE_EXTENSION = 'fuse.package'
export const FUSE_MIME_TYPE = 'application/vnd.fuse-studio.document+zip'

/** Data fixa para entradas do zip: pacotes idênticos para o mesmo conteúdo. */
const FIXED_DATE = new Date(Date.UTC(1980, 0, 1, 12, 0, 0))

export type PackOptions = {
  /** PNG da miniatura. */
  thumbnail?: Uint8Array
  /** Binários adicionais por sha256 (ex.: ativos já referenciados por AssetRef.sha256). */
  assets?: ReadonlyMap<string, Uint8Array>
  /** Extrai data: URLs base64 para assets/<sha256> (padrão: true). */
  externalizeDataUrls?: boolean
}

export type UnpackOptions = MigrateOptions & {
  /** Reconverte "fuse-asset:" que vieram de data: URLs de volta para data: URLs (padrão: false). */
  inlineDataUrls?: boolean
}

export type UnpackResult = {
  file: FuseFile
  /** Binários por sha256. */
  assets: Map<string, Uint8Array>
  thumbnail?: Uint8Array
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new FuseFormatError('package', 'Web Crypto (crypto.subtle) indisponível neste ambiente.')
  const digest = await subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  return btoa(binary)
}

const DATA_URL = /^data:([^,]*);base64,([A-Za-z0-9+/]*={0,2})$/

type Visitor = (value: string, key: string) => string | Promise<string>

async function mapSrcStrings(value: unknown, visit: Visitor): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map(item => mapSrcStrings(item, visit)))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      out[key] = key === 'src' && typeof item === 'string' ? await visit(item, key) : await mapSrcStrings(item, visit)
    }
    return out
  }
  return value
}

/** Empacota um FuseFile em bytes .fuse (zip). Valida o documento antes de gravar. */
export async function packFuse(file: FuseFile, options: PackOptions = {}): Promise<Uint8Array> {
  const parsed = FuseFileSchema.safeParse(file)
  if (!parsed.success) throw new FuseFormatError('invalid', 'Documento inválido; não é possível empacotar.', { cause: parsed.error })
  const binaries = new Map<string, Uint8Array>(options.assets ?? [])
  let document = file
  if (options.externalizeDataUrls ?? true) {
    const added: Record<string, AssetRef> = {}
    document = await mapSrcStrings(file, async value => {
      const match = DATA_URL.exec(value)
      if (!match) return value
      const payload = match[2] as string
      let bytes: Uint8Array
      try { bytes = base64ToBytes(payload) } catch { return value }
      // Só externaliza se a recodificação é idêntica (garante roundtrip exato).
      if (bytesToBase64(bytes) !== payload) return value
      const hash = await sha256Hex(bytes)
      binaries.set(hash, bytes)
      const mime = (match[1] as string).split(';')[0] || 'application/octet-stream'
      added[`sha256:${hash}`] ??= { sha256: hash, mime, bytes: bytes.byteLength, extensions: { [PACKAGE_EXTENSION]: { dataUrlPrefix: `data:${match[1]};base64` } } }
      return `${ASSET_URI_PREFIX}${hash}`
    }) as FuseFile
    document = { ...document, assets: { ...added, ...document.assets } }
  }
  const missing = await collectMissingAssets(document, binaries)
  if (missing.length) throw new FuseFormatError('package', `Binários ausentes para: ${missing.join(', ')}`)

  const zip = new JSZip()
  zip.file(DOCUMENT_ENTRY, JSON.stringify(document), { date: FIXED_DATE, compression: 'DEFLATE' })
  for (const hash of [...binaries.keys()].sort()) {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new FuseFormatError('package', `Chave de ativo inválida: ${hash}`)
    zip.file(`${ASSETS_DIR}${hash}`, binaries.get(hash) as Uint8Array, { date: FIXED_DATE, binary: true, compression: 'STORE' })
  }
  if (options.thumbnail) zip.file(THUMBNAIL_ENTRY, options.thumbnail, { date: FIXED_DATE, binary: true, compression: 'STORE' })
  return zip.generateAsync({ type: 'uint8array', platform: 'UNIX' })
}

async function collectMissingAssets(file: FuseFile, binaries: ReadonlyMap<string, Uint8Array>): Promise<string[]> {
  const missing = new Set<string>()
  await mapSrcStrings(file, value => {
    if (value.startsWith(ASSET_URI_PREFIX) && !binaries.has(value.slice(ASSET_URI_PREFIX.length))) missing.add(value)
    return value
  })
  return [...missing]
}

/** Lê bytes .fuse (zip). Aceita document.json em qualquer versão conhecida (migra). Verifica sha256 dos ativos. */
export async function unpackFuse(data: Uint8Array | ArrayBuffer, options: UnpackOptions = {}): Promise<UnpackResult> {
  let zip: JSZip
  try { zip = await JSZip.loadAsync(data) } catch (cause) { throw new FuseFormatError('package', 'Arquivo .fuse corrompido (zip ilegível).', { cause }) }
  const entry = zip.file(DOCUMENT_ENTRY)
  if (!entry) throw new FuseFormatError('package', `Pacote sem ${DOCUMENT_ENTRY}.`)
  let json: unknown
  try { json = JSON.parse(await entry.async('string')) } catch (cause) { throw new FuseFormatError('package', `${DOCUMENT_ENTRY} não é JSON válido.`, { cause }) }

  const assets = new Map<string, Uint8Array>()
  for (const name of Object.keys(zip.files)) {
    if (!name.startsWith(ASSETS_DIR) || name === ASSETS_DIR || zip.files[name]?.dir) continue
    const hash = name.slice(ASSETS_DIR.length)
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new FuseFormatError('package', `Nome de ativo inválido: ${name}`)
    const bytes = await (zip.file(name) as JSZip.JSZipObject).async('uint8array')
    if (await sha256Hex(bytes) !== hash) throw new FuseFormatError('package', `Ativo corrompido: ${name} (sha256 não confere).`)
    assets.set(hash, bytes)
  }

  let file = migrate(json, options)
  const missing = await collectMissingAssets(file, assets)
  if (missing.length) throw new FuseFormatError('package', `Ativos ausentes no pacote: ${missing.join(', ')}`)

  if (options.inlineDataUrls) {
    const inlined = new Set<string>()
    const prefixes = new Map<string, string>()
    for (const [id, asset] of Object.entries(file.assets)) {
      const packaged = asset.extensions?.[PACKAGE_EXTENSION] as { dataUrlPrefix?: unknown } | undefined
      if (asset.sha256 && typeof packaged?.dataUrlPrefix === 'string') { prefixes.set(asset.sha256, packaged.dataUrlPrefix); inlined.add(id) }
    }
    file = await mapSrcStrings(file, value => {
      if (!value.startsWith(ASSET_URI_PREFIX)) return value
      const hash = value.slice(ASSET_URI_PREFIX.length)
      const prefix = prefixes.get(hash)
      return prefix ? `${prefix},${bytesToBase64(assets.get(hash) as Uint8Array)}` : value
    }) as FuseFile
    file = { ...file, assets: Object.fromEntries(Object.entries(file.assets).filter(([id]) => !inlined.has(id))) }
  }

  const thumbnailEntry = zip.file(THUMBNAIL_ENTRY)
  const result: UnpackResult = { file, assets }
  if (thumbnailEntry) result.thumbnail = await thumbnailEntry.async('uint8array')
  return result
}
