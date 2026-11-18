import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LegacyDocument, LegacyMediaAsset } from '../src/index.js'

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')

export type NamedFixture = { name: string; document: LegacyDocument }

/** Todas as fixtures legadas: geradas a partir de apps/web/src/model.ts (legacy/) e escritas à mão (handmade/). */
export function loadLegacyFixtures(): NamedFixture[] {
  const fixtures: NamedFixture[] = []
  for (const folder of ['legacy', 'handmade']) {
    const dir = path.join(FIXTURES, folder)
    for (const file of readdirSync(dir).filter(name => name.endsWith('.json')).sort()) {
      fixtures.push({ name: `${folder}/${file}`, document: JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as LegacyDocument })
    }
  }
  return fixtures
}

export function loadFixture(relative: string): LegacyDocument {
  return JSON.parse(readFileSync(path.join(FIXTURES, relative), 'utf8')) as LegacyDocument
}

export function loadMediaAssets(): LegacyMediaAsset[] {
  return JSON.parse(readFileSync(path.join(FIXTURES, 'media-assets.json'), 'utf8')) as LegacyMediaAsset[]
}

/** Normaliza como JSON (o formato é JSON; undefined some). */
export const asJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
