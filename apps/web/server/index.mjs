import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { createServer as createHttpServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mergeConcurrentDocuments } from './document-merge.mjs'
import { createTextGenerator } from './ai-provider.mjs'
import { createImageGenerator } from './ai-image-provider.mjs'
import { deliverInvitationEmail, deliverPasswordResetEmail } from './email-provider.mjs'
import { createExternalProviderClients } from './external-providers.mjs'

const SESSION_COOKIE = 'fuse_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
const MAX_BODY_BYTES = 16 * 1024 * 1024
const MAX_DOC_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_DOC_IMAGE_TOTAL_BYTES = 8 * 1024 * 1024
const MAX_DOC_IMAGE_DIMENSION = 12_000
const MAX_DOC_IMAGE_PIXELS = 24_000_000
const ROLES = new Set(['viewer', 'commenter', 'editor'])

function docImageByteLength(image) {
  if (!image || typeof image.src !== 'string') return 0
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]*={0,2})$/.exec(image.src)
  if (!match || match[2].length % 4 !== 0) return 0
  const encoded = match[2]
  return Math.floor(encoded.length * 3 / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0)
}

function validDocImage(image) {
  if (!image || typeof image !== 'object' || Array.isArray(image) || Object.keys(image).some(key => !['src', 'alt', 'width', 'height'].includes(key))
    || typeof image.alt !== 'string' || image.alt.length > 2_000 || !Number.isFinite(image.width) || !Number.isFinite(image.height)
    || image.width <= 0 || image.height <= 0 || image.width > MAX_DOC_IMAGE_DIMENSION || image.height > MAX_DOC_IMAGE_DIMENSION || image.width * image.height > MAX_DOC_IMAGE_PIXELS) return false
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]*={0,2})$/.exec(image.src)
  if (!match || match[2].length % 4 !== 0) return false
  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length || bytes.length > MAX_DOC_IMAGE_BYTES || bytes.toString('base64') !== match[2]) return false
  if (match[1] === 'png') {
    if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47 || bytes.toString('ascii', 12, 16) !== 'IHDR') return false
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
    return width > 0 && height > 0 && width <= MAX_DOC_IMAGE_DIMENSION && height <= MAX_DOC_IMAGE_DIMENSION && width * height <= MAX_DOC_IMAGE_PIXELS
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue }
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset++]
    if (marker === 0xd8 || marker === 0xd9 || marker >= 0xd0 && marker <= 0xd7 || marker === 0x01) continue
    if (offset + 2 > bytes.length) return false
    const segmentLength = bytes.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return false
    if (frameMarkers.has(marker)) {
      if (segmentLength < 7) return false
      const height = bytes.readUInt16BE(offset + 3), width = bytes.readUInt16BE(offset + 5)
      return width > 0 && height > 0 && width <= MAX_DOC_IMAGE_DIMENSION && height <= MAX_DOC_IMAGE_DIMENSION && width * height <= MAX_DOC_IMAGE_PIXELS
    }
    offset += segmentLength
  }
  return false
}

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function isSafeSiteHref(value) {
  if (typeof value !== 'string' || value.length > 2048) return false
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 31 || code === 127) return false
  }
  const href = value.trim()
  if (href === '') return true
  if (/^#[A-Za-z0-9_-]{1,200}$/.test(href)) return true
  if (href.startsWith('/') && !href.startsWith('//')) return true
  if (href.startsWith('./') || href.startsWith('../')) return true
  try { return ['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(href).protocol) } catch { return false }
}

function isHttpsProviderUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
  } catch { return false }
}

function hasSafeSiteLinks(document) {
  if (!document || document.type !== 'site') return true
  return Array.isArray(document.pages) && document.pages.every(page => !page || page.elements === undefined || Array.isArray(page.elements)
    && page.elements.every(element => !element || element.type !== 'text' || element.href === undefined || isSafeSiteHref(element.href)))
}

function validDocInlineMarks(marks, text) {
  return Array.isArray(marks) && marks.length <= 5_000 && marks.every(mark => mark && Number.isInteger(mark.start) && Number.isInteger(mark.end)
    && mark.start >= 0 && mark.end > mark.start && typeof text === 'string' && mark.end <= text.length
    && (mark.bold === undefined || typeof mark.bold === 'boolean') && (mark.italic === undefined || typeof mark.italic === 'boolean')
    && (mark.underline === undefined || typeof mark.underline === 'boolean') && (mark.strike === undefined || typeof mark.strike === 'boolean')
    && (mark.bold || mark.italic || mark.underline || mark.strike))
}

function validDocumentInlineMarks(document) {
  if (!document || !Array.isArray(document.pages)) return true
  return document.pages.every(page => {
    if (!page || page.blocks === undefined) return true
    if (!Array.isArray(page.blocks)) return false
    return page.blocks.every(block => block && typeof block === 'object'
      && (block.marks === undefined || validDocInlineMarks(block.marks, block.text)))
  })
}

function hashPassword(password, salt = randomBytes(16)) {
  const digest = scryptSync(password, salt, 64)
  return `${salt.toString('hex')}:${digest.toString('hex')}`
}

function verifyPassword(password, stored) {
  const [saltHex, digestHex] = stored.split(':')
  if (!saltHex || !digestHex) return false
  const expected = Buffer.from(digestHex, 'hex')
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function readCookies(header = '') {
  return Object.fromEntries(header.split(';').map(pair => {
    const separator = pair.indexOf('=')
    if (separator < 0) return ['', '']
    const value = pair.slice(separator + 1).trim()
    try {
      return [pair.slice(0, separator).trim(), decodeURIComponent(value)]
    } catch {
      return ['', '']
    }
  }).filter(([key]) => key))
}

function createSchema(database) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
      joined_at TEXT NOT NULL,
      PRIMARY KEY (team_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS team_groups (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (team_id, id),
      UNIQUE (team_id, name)
    );
    CREATE TABLE IF NOT EXISTS team_group_members (
      team_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (team_id, group_id, user_id),
      FOREIGN KEY (team_id, group_id) REFERENCES team_groups(team_id, id) ON DELETE CASCADE,
      FOREIGN KEY (team_id, user_id) REFERENCES team_members(team_id, user_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS team_brand_designers (
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      assigned_at TEXT NOT NULL,
      PRIMARY KEY (team_id, user_id),
      FOREIGN KEY (team_id, user_id) REFERENCES team_members(team_id, user_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS team_policies (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      policy_key TEXT NOT NULL,
      policy_value TEXT NOT NULL,
      updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (team_id, policy_key)
    );
    CREATE TABLE IF NOT EXISTS team_media (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      src TEXT NOT NULL,
      object_key TEXT,
      fingerprint TEXT,
      library_visible INTEGER NOT NULL DEFAULT 1 CHECK(library_visible IN (0, 1)),
      created_at TEXT NOT NULL,
      PRIMARY KEY(team_id, asset_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS team_media_fingerprint_idx
      ON team_media(team_id, fingerprint) WHERE fingerprint IS NOT NULL;
    CREATE TABLE IF NOT EXISTS team_invitations (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
      token_hash TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      revoked_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS team_invitations_pending_email_idx
      ON team_invitations(team_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      data_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      access_suspended INTEGER NOT NULL DEFAULT 0 CHECK(access_suspended IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS site_publications (
      document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      url TEXT NOT NULL,
      deployment_id TEXT NOT NULL,
      published_at TEXT NOT NULL,
      published_revision INTEGER NOT NULL CHECK(published_revision > 0)
    );
    CREATE TABLE IF NOT EXISTS project_folders (
      id TEXT PRIMARY KEY,
      owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK((owner_id IS NOT NULL AND team_id IS NULL) OR (owner_id IS NULL AND team_id IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS project_folders_owner_idx ON project_folders(owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS project_folders_team_idx ON project_folders(team_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS project_folder_favorites (
      folder_id TEXT NOT NULL REFERENCES project_folders(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY(folder_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS document_media (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      src TEXT NOT NULL,
      object_key TEXT,
      fingerprint TEXT,
      library_visible INTEGER NOT NULL DEFAULT 1 CHECK(library_visible IN (0, 1)),
      created_at TEXT NOT NULL,
      PRIMARY KEY(document_id, asset_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS document_media_fingerprint_idx
      ON document_media(document_id, fingerprint) WHERE fingerprint IS NOT NULL;
    CREATE TABLE IF NOT EXISTS document_permissions (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('viewer', 'commenter', 'editor')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (document_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS document_invitations (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('viewer', 'commenter', 'editor')),
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      accepted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      revoked_at TEXT,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS document_invitations_pending_email_idx
      ON document_invitations(document_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS document_public_links (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS document_public_links_active_idx
      ON document_public_links(document_id) WHERE revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS document_versions (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      name TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      PRIMARY KEY (document_id, revision)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      page_id TEXT,
      element_id TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      read_at TEXT,
      UNIQUE(user_id, comment_id)
    );
    CREATE TABLE IF NOT EXISTS document_operations (
      operation_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      result_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
      document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
      actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_events_team_created_idx ON audit_events(team_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS audit_events_document_created_idx ON audit_events(document_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS documents_owner_updated_idx ON documents(owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS comments_document_created_idx ON comments(document_id, created_at);
    CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications(user_id, created_at DESC);
  `)
  database.exec(`
    INSERT OR IGNORE INTO document_versions (document_id, revision, name, data_json, created_at, created_by)
    SELECT id, revision, name, data_json, updated_at, owner_id FROM documents;
  `)
  let documentColumns = database.prepare('PRAGMA table_info(documents)').all().map(column => column.name)
  if (!documentColumns.includes('team_id')) database.exec('ALTER TABLE documents ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE CASCADE')
  documentColumns = database.prepare('PRAGMA table_info(documents)').all().map(column => column.name)
  const commentColumns = database.prepare('PRAGMA table_info(comments)').all().map(column => column.name)
  if (!documentColumns.includes('access_suspended')) database.exec('ALTER TABLE documents ADD COLUMN access_suspended INTEGER NOT NULL DEFAULT 0 CHECK(access_suspended IN (0, 1))')
  if (!commentColumns.includes('parent_id')) database.exec('ALTER TABLE comments ADD COLUMN parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE')
  if (!commentColumns.includes('resolved_at')) database.exec('ALTER TABLE comments ADD COLUMN resolved_at TEXT')
  if (!commentColumns.includes('resolved_by')) database.exec('ALTER TABLE comments ADD COLUMN resolved_by TEXT REFERENCES users(id)')
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  response.end(JSON.stringify(payload))
}

async function readJson(request) {
  const contentType = request.headers['content-type'] ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Envie o conteúdo como application/json.')
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'O conteúdo excede o limite de 16 MB.')
    chunks.push(chunk)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object expected')
    return value
  } catch {
    throw new HttpError(400, 'O corpo precisa ser um objeto JSON válido.')
  }
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email }
}

export function createAppServer({
  databasePath = process.env.STUDIO_DB_PATH ?? resolve('.data/studio.sqlite'),
  mediaObjectDir = process.env.STUDIO_MEDIA_OBJECT_DIR ?? (databasePath === ':memory:' ? null : resolve(dirname(resolve(databasePath)), 'media')),
  allowedOrigins = (process.env.APP_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173').split(',').map(value => value.trim()),
  secureCookies = process.env.NODE_ENV === 'production',
  textGenerator = createTextGenerator({ mode: process.env.STUDIO_AI_MODE, baseUrl: process.env.STUDIO_AI_BASE_URL, apiKey: process.env.STUDIO_AI_API_KEY, model: process.env.STUDIO_AI_MODEL }),
  imageGenerator = createImageGenerator({ mode: process.env.STUDIO_IMAGE_AI_MODE ?? 'sandbox', baseUrl: process.env.STUDIO_IMAGE_AI_BASE_URL, apiKey: process.env.STUDIO_IMAGE_AI_API_KEY, model: process.env.STUDIO_IMAGE_AI_MODEL }),
  invitationEmailSender = deliverInvitationEmail,
  passwordResetEmailSender = deliverPasswordResetEmail,
  sitePublisher: injectedSitePublisher,
  printCheckoutProvider: injectedPrintCheckoutProvider,
  externalProviderEnv = process.env,
  externalProviderFetch = globalThis.fetch,
  userTeamHeartbeatMs = 20_000,
} = {}) {
  const environmentProviders = createExternalProviderClients(externalProviderEnv, externalProviderFetch)
  const sitePublisher = injectedSitePublisher === undefined ? environmentProviders.sitePublisher : injectedSitePublisher
  const printCheckoutProvider = injectedPrintCheckoutProvider === undefined ? environmentProviders.printCheckoutProvider : injectedPrintCheckoutProvider
  const externalProviderStatus = {
    sitePublication: { configured: Boolean(sitePublisher), missing: sitePublisher ? [] : environmentProviders.status.sitePublication.missing },
    printCheckout: { configured: Boolean(printCheckoutProvider), missing: printCheckoutProvider ? [] : environmentProviders.status.printCheckout.missing },
  }
  if (databasePath !== ':memory:') mkdirSync(dirname(resolve(databasePath)), { recursive: true })
  const database = new DatabaseSync(databasePath)
  createSchema(database)
  for (const table of ['team_media', 'document_media']) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all()
    if (!columns.some(column => column.name === 'object_key')) database.exec(`ALTER TABLE ${table} ADD COLUMN object_key TEXT`)
  }
  const mediaRoot = mediaObjectDir ? resolve(mediaObjectDir) : null
  function storeMediaSource(src) {
    if (!mediaRoot) return { src, objectKey: null }
    const match = typeof src === 'string' && src.match(/^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/)
    if (!match) throw new HttpError(400, 'A mídia precisa ter uma origem base64 válida.')
    const bytes = Buffer.from(match[2], 'base64')
    const objectKey = createHash('sha256').update(bytes).digest('hex')
    mkdirSync(mediaRoot, { recursive: true })
    const objectPath = resolve(mediaRoot, `${objectKey}.blob`)
    if (!existsSync(objectPath)) {
      try { writeFileSync(objectPath, bytes, { flag: 'wx' }) }
      catch (error) { if (error.code !== 'EEXIST') throw error }
    }
    return { src: '', objectKey }
  }
  function readMediaSource(row) {
    if (!row.object_key) return row.src
    if (!/^[a-f0-9]{64}$/.test(row.object_key) || !mediaRoot) throw new HttpError(500, 'O arquivo desta mídia não está disponível.')
    const objectPath = resolve(mediaRoot, `${row.object_key}.blob`)
    if (!objectPath.startsWith(`${mediaRoot}${process.platform === 'win32' ? '\\' : '/'}`) || !existsSync(objectPath)) throw new HttpError(500, 'O arquivo desta mídia não está disponível.')
    return `data:${row.mime_type};base64,${readFileSync(objectPath).toString('base64')}`
  }
  function removeUnreferencedMediaObject(objectKey) {
    if (!mediaRoot || !objectKey || !/^[a-f0-9]{64}$/.test(objectKey)) return
    const referenced = database.prepare('SELECT (SELECT COUNT(*) FROM team_media WHERE object_key = ?) + (SELECT COUNT(*) FROM document_media WHERE object_key = ?) AS count').get(objectKey, objectKey).count
    if (referenced === 0) {
      const objectPath = resolve(mediaRoot, `${objectKey}.blob`)
      if (objectPath.startsWith(`${mediaRoot}${process.platform === 'win32' ? '\\' : '/'}`)) {
        try { unlinkSync(objectPath) } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
    }
  }
  if (mediaRoot) {
    mkdirSync(mediaRoot, { recursive: true })
    for (const [table, idColumn, scopeColumn] of [['team_media', 'asset_id', 'team_id'], ['document_media', 'asset_id', 'document_id']]) {
      const legacyRows = database.prepare(`SELECT ${scopeColumn} AS scope_id, ${idColumn} AS asset_id, src, mime_type FROM ${table} WHERE object_key IS NULL AND src LIKE 'data:%'`).all()
      for (const row of legacyRows) {
        const stored = storeMediaSource(row.src)
        database.prepare(`UPDATE ${table} SET src = ?, object_key = ? WHERE ${scopeColumn} = ? AND ${idColumn} = ? AND object_key IS NULL`).run(stored.src, stored.objectKey, row.scope_id, row.asset_id)
      }
    }
  }
  database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString())
  database.prepare('DELETE FROM password_reset_tokens WHERE expires_at <= ? OR used_at IS NOT NULL').run(new Date().toISOString())
  const allowed = new Set(allowedOrigins)
  const attempts = new Map()
  const passwordResetAttempts = new Map()
  const documentSubscribers = new Map()
  const documentEventHistory = new Map()
  const notificationSubscribers = new Map()
  const notificationEventHistory = new Map()
  const teamSubscribers = new Map()
  const teamEventHistory = new Map()
  const userTeamSubscribers = new Map()
  const userTeamEventHistory = new Map()
  const maxTeamEventHistory = 200
  const maxNotificationEventHistory = 100
  const activePresentations = new Map()
  const maxDocumentEventHistory = 200
  let closed = false

  async function sendInvitationEmailSafely(invitation) {
    try {
      const delivery = await invitationEmailSender(invitation)
      if (['sent', 'link-only', 'failed'].includes(delivery?.status)) return delivery
      return { status: 'failed', reason: 'provider-invalid-response' }
    } catch {
      return { status: 'failed', reason: 'provider-unavailable' }
    }
  }

  async function sendPasswordResetEmailSafely(reset) {
    try {
      const delivery = await passwordResetEmailSender(reset)
      if (['sent', 'link-only', 'failed'].includes(delivery?.status)) return delivery
      return { status: 'failed', reason: 'provider-invalid-response' }
    } catch {
      return { status: 'failed', reason: 'provider-unavailable' }
    }
  }

  function removeSubscriber(documentId, subscriber) {
    const subscribers = documentSubscribers.get(documentId)
    if (!subscribers) return
    const removed = subscribers.delete(subscriber)
    if (subscribers.size === 0) documentSubscribers.delete(documentId)
    clearInterval(subscriber.heartbeat)
    if (removed && ![...(subscribers ?? [])].some(current => current.userId === subscriber.userId)) clearPresentation(documentId, subscriber.userId)
    if (removed && subscribers.size > 0) publishPresence(documentId)
  }

  function sendEvent(subscriber, event, eventId) {
    if (!subscriber.response.destroyed && !subscriber.response.writableEnded) {
      subscriber.response.write(`${eventId ? `id: ${eventId}\n` : ''}data: ${JSON.stringify(event)}\n\n`)
    }
  }

  function publishDocument(documentId, event) {
    const history = documentEventHistory.get(documentId) ?? { nextId: 1, events: [] }
    const eventId = history.nextId++
    history.events.push({ id: eventId, event })
    if (history.events.length > maxDocumentEventHistory) history.events.splice(0, history.events.length - maxDocumentEventHistory)
    documentEventHistory.set(documentId, history)
    for (const subscriber of documentSubscribers.get(documentId) ?? []) sendEvent(subscriber, event, eventId)
  }

  function removeNotificationSubscriber(subscriber) {
    const subscribers = notificationSubscribers.get(subscriber.userId)
    if (!subscribers) return
    subscribers.delete(subscriber)
    if (subscribers.size === 0) notificationSubscribers.delete(subscriber.userId)
    clearInterval(subscriber.heartbeat)
  }

  function publishNotification(userId, notificationId) {
    const history = notificationEventHistory.get(userId) ?? { nextId: 1, events: [] }
    const event = { type: 'notification.created', notificationId }
    const eventId = history.nextId++
    history.events.push({ id: eventId, event })
    if (history.events.length > maxNotificationEventHistory) history.events.splice(0, history.events.length - maxNotificationEventHistory)
    notificationEventHistory.set(userId, history)
    for (const subscriber of notificationSubscribers.get(userId) ?? []) sendEvent(subscriber, event, eventId)
  }

  function removeTeamSubscriber(teamId, subscriber) {
    const subscribers = teamSubscribers.get(teamId)
    if (!subscribers) return
    subscribers.delete(subscriber)
    if (subscribers.size === 0) teamSubscribers.delete(teamId)
    clearInterval(subscriber.heartbeat)
  }

  function removeUserTeamSubscriber(subscriber) {
    const subscribers = userTeamSubscribers.get(subscriber.userId)
    if (!subscribers) return
    subscribers.delete(subscriber)
    if (subscribers.size === 0) userTeamSubscribers.delete(subscriber.userId)
    clearInterval(subscriber.heartbeat)
  }

  function publishUserTeam(userId, event) {
    const history = userTeamEventHistory.get(userId) ?? { nextId: 1, events: [] }
    const eventId = history.nextId++
    history.events.push({ id: eventId, event })
    if (history.events.length > maxTeamEventHistory) history.events.splice(0, history.events.length - maxTeamEventHistory)
    userTeamEventHistory.set(userId, history)
    for (const subscriber of userTeamSubscribers.get(userId) ?? []) sendEvent(subscriber, event, eventId)
  }

  function publishTeam(teamId) {
    const event = { type: 'team.updated' }
    const history = teamEventHistory.get(teamId) ?? { nextId: 1, events: [] }
    const eventId = history.nextId++
    history.events.push({ id: eventId, event })
    if (history.events.length > maxTeamEventHistory) history.events.splice(0, history.events.length - maxTeamEventHistory)
    teamEventHistory.set(teamId, history)
    for (const subscriber of teamSubscribers.get(teamId) ?? []) sendEvent(subscriber, event, eventId)
    for (const member of database.prepare('SELECT user_id FROM team_members WHERE team_id = ?').all(teamId)) publishUserTeam(member.user_id, { type: 'team.updated', teamId })
  }

  function revokeTeamSubscribers(teamId, userId) {
    publishUserTeam(userId, { type: 'access.revoked', teamId })
    for (const subscriber of [...(teamSubscribers.get(teamId) ?? [])]) {
      if (subscriber.userId !== userId) continue
      sendEvent(subscriber, { type: 'access.revoked' })
      removeTeamSubscriber(teamId, subscriber)
      subscriber.response.end()
    }
  }

  function subscribeUserTeams(request, response, user) {
    const headerEventId = request.headers['last-event-id']
    const lastEventId = typeof headerEventId === 'string' && /^\d{1,15}$/.test(headerEventId) ? Number(headerEventId) : null
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-content-type-options': 'nosniff',
    })
    response.write(`retry: 2000\ndata: ${JSON.stringify({ type: 'ready' })}\n\n`)
    const history = userTeamEventHistory.get(user.id)
    if (lastEventId !== null && history) {
      const membership = database.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?')
      for (const item of history.events) {
        if (item.id <= lastEventId) continue
        const isMember = Boolean(membership.get(item.event.teamId, user.id))
        if ((item.event.type === 'team.updated' && !isMember) || (item.event.type === 'access.revoked' && isMember)) continue
        sendEvent({ response }, item.event, item.id)
      }
    }
    const subscriber = { userId: user.id, response, request, heartbeat: null }
    const subscribers = userTeamSubscribers.get(user.id) ?? new Set()
    subscribers.add(subscriber)
    userTeamSubscribers.set(user.id, subscribers)
    subscriber.heartbeat = setInterval(() => {
      if (!currentUser(request)) {
        sendEvent(subscriber, { type: 'auth.expired' })
        removeUserTeamSubscriber(subscriber)
        response.end()
        return
      }
      if (!response.destroyed && !response.writableEnded) response.write(': keepalive\n\n')
    }, Number.isFinite(userTeamHeartbeatMs) ? Math.max(50, Math.min(60_000, userTeamHeartbeatMs)) : 20_000)
    response.on('close', () => removeUserTeamSubscriber(subscriber))
  }

  function subscribeTeam(request, response, teamId, user) {
    const headerEventId = request.headers['last-event-id']
    const lastEventId = typeof headerEventId === 'string' && /^\d{1,15}$/.test(headerEventId) ? Number(headerEventId) : null
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-content-type-options': 'nosniff',
    })
    response.write(`retry: 2000\ndata: ${JSON.stringify({ type: 'ready' })}\n\n`)
    const history = teamEventHistory.get(teamId)
    if (lastEventId !== null && history) {
      for (const item of history.events) if (item.id > lastEventId) sendEvent({ response }, item.event, item.id)
    }
    const subscriber = { userId: user.id, response, request, heartbeat: null }
    const subscribers = teamSubscribers.get(teamId) ?? new Set()
    subscribers.add(subscriber)
    teamSubscribers.set(teamId, subscribers)
    subscriber.heartbeat = setInterval(() => {
      if (!currentUser(request)) {
        sendEvent(subscriber, { type: 'auth.expired' })
        removeTeamSubscriber(teamId, subscriber)
        response.end()
        return
      }
      if (!database.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, user.id)) {
        sendEvent(subscriber, { type: 'access.revoked' })
        removeTeamSubscriber(teamId, subscriber)
        response.end()
        return
      }
      if (!response.destroyed && !response.writableEnded) response.write(': keepalive\n\n')
    }, 20_000)
    response.on('close', () => removeTeamSubscriber(teamId, subscriber))
  }

  function subscribeNotifications(request, response, user) {
    const headerEventId = request.headers['last-event-id']
    const lastEventId = typeof headerEventId === 'string' && /^\d{1,15}$/.test(headerEventId) ? Number(headerEventId) : null
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-content-type-options': 'nosniff',
    })
    response.write(`retry: 2000\ndata: ${JSON.stringify({ type: 'ready' })}\n\n`)
    const history = notificationEventHistory.get(user.id)
    if (lastEventId !== null && history) {
      for (const item of history.events) if (item.id > lastEventId) sendEvent({ response }, item.event, item.id)
    }
    const subscriber = { userId: user.id, response, request, heartbeat: null }
    const subscribers = notificationSubscribers.get(user.id) ?? new Set()
    subscribers.add(subscriber)
    notificationSubscribers.set(user.id, subscribers)
    subscriber.heartbeat = setInterval(() => {
      if (!currentUser(request)) {
        sendEvent(subscriber, { type: 'auth.expired' })
        removeNotificationSubscriber(subscriber)
        response.end()
        return
      }
      if (!response.destroyed && !response.writableEnded) response.write(': keepalive\n\n')
    }, 20_000)
    response.on('close', () => removeNotificationSubscriber(subscriber))
  }

  function recordAudit({ user, action, targetType, targetId = null, details = {}, teamId = null, documentId = null }) {
    const createdAt = new Date().toISOString()
    database.prepare('INSERT INTO audit_events (id, team_id, document_id, actor_id, actor_name, action, target_type, target_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), teamId, documentId, user?.id ?? null, user?.name ?? 'Sistema', action, targetType, targetId, JSON.stringify(details), createdAt)
  }

  function clearPresentation(documentId, userId) {
    const presentations = activePresentations.get(documentId)
    const presentation = presentations?.get(userId)
    if (!presentation) return
    presentations.delete(userId)
    if (presentations.size === 0) activePresentations.delete(documentId)
    publishDocument(documentId, { type: 'presentation.updated', userId, name: presentation.name, presenting: false, pageIndex: null })
  }

  function publishPresence(documentId) {
    const users = new Map()
    for (const subscriber of documentSubscribers.get(documentId) ?? []) {
      const current = users.get(subscriber.userId) ?? { id: subscriber.userId, name: subscriber.name, connections: 0 }
      current.connections += 1
      users.set(subscriber.userId, current)
    }
    publishDocument(documentId, { type: 'presence.updated', users: [...users.values()] })
  }

  function publishAccess(documentId, userId, role) {
    for (const subscriber of documentSubscribers.get(documentId) ?? []) {
      if (subscriber.userId === userId) sendEvent(subscriber, { type: 'access.changed', role })
    }
  }

  function revokeSubscriber(documentId, userId) {
    for (const subscriber of [...(documentSubscribers.get(documentId) ?? [])]) {
      if (subscriber.userId !== userId) continue
      sendEvent(subscriber, { type: 'access.revoked' })
      removeSubscriber(documentId, subscriber)
      subscriber.response.end()
    }
  }

  function revokeLostTeamDocumentAccess(teamId, userId) {
    const documents = database.prepare('SELECT id FROM documents WHERE team_id = ?').all(teamId)
    for (const document of documents) {
      try { publishAccess(document.id, userId, documentAccess(document.id, userId).role) }
      catch { revokeSubscriber(document.id, userId) }
    }
  }

  function expireUserSubscribers(userId) {
    for (const subscriber of [...(userTeamSubscribers.get(userId) ?? [])]) {
      sendEvent(subscriber, { type: 'auth.expired' })
      removeUserTeamSubscriber(subscriber)
      subscriber.response.end()
    }
    for (const subscriber of [...(notificationSubscribers.get(userId) ?? [])]) {
      sendEvent(subscriber, { type: 'auth.expired' })
      removeNotificationSubscriber(subscriber)
      subscriber.response.end()
    }
    for (const [documentId, subscribers] of documentSubscribers) {
      for (const subscriber of [...subscribers]) {
        if (subscriber.userId !== userId) continue
        sendEvent(subscriber, { type: 'auth.expired' })
        removeSubscriber(documentId, subscriber)
        subscriber.response.end()
      }
    }
    for (const [teamId, subscribers] of teamSubscribers) {
      for (const subscriber of [...subscribers]) {
        if (subscriber.userId !== userId) continue
        sendEvent(subscriber, { type: 'auth.expired' })
        removeTeamSubscriber(teamId, subscriber)
        subscriber.response.end()
      }
    }
  }

  function subscribeDocument(request, response, documentId, user) {
    const access = documentAccess(documentId, user.id)
    const headerEventId = request.headers['last-event-id']
    const lastEventId = typeof headerEventId === 'string' && /^\d{1,15}$/.test(headerEventId) ? Number(headerEventId) : null
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-content-type-options': 'nosniff',
    })
    response.write(`retry: 2000\ndata: ${JSON.stringify({ type: 'ready', revision: access.revision })}\n\n`)
    const history = documentEventHistory.get(documentId)
    if (lastEventId !== null && history) {
      for (const item of history.events) {
        if (item.id > lastEventId) sendEvent({ response }, item.event, item.id)
      }
    }
    const subscriber = { userId: user.id, name: user.name, response, request, heartbeat: null }
    const subscribers = documentSubscribers.get(documentId) ?? new Set()
    subscribers.add(subscriber)
    documentSubscribers.set(documentId, subscribers)
    publishPresence(documentId)
    for (const [userId, presentation] of activePresentations.get(documentId) ?? []) {
      sendEvent(subscriber, { type: 'presentation.updated', userId, name: presentation.name, presenting: true, pageIndex: presentation.pageIndex })
    }
    subscriber.heartbeat = setInterval(() => {
      const current = currentUser(request)
      if (!current) {
        sendEvent(subscriber, { type: 'auth.expired' })
        removeSubscriber(documentId, subscriber)
        response.end()
        return
      }
      try { documentAccess(documentId, current.id) } catch {
        sendEvent(subscriber, { type: 'access.revoked' })
        removeSubscriber(documentId, subscriber)
        response.end()
        return
      }
      if (!response.destroyed && !response.writableEnded) response.write(': keepalive\n\n')
    }, 20_000)
    response.on('close', () => removeSubscriber(documentId, subscriber))
  }

  function currentUser(request) {
    const token = readCookies(request.headers.cookie)[SESSION_COOKIE]
    if (!token) return null
    const row = database.prepare(`
      SELECT users.id, users.name, users.email
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `).get(hashToken(token), new Date().toISOString())
    return row ?? null
  }

  function requireUser(request) {
    const user = currentUser(request)
    if (!user) throw new HttpError(401, 'Entre na sua conta para continuar.')
    return user
  }

  function requireOrigin(request) {
    const origin = request.headers.origin
    if (!origin || !allowed.has(origin)) throw new HttpError(403, 'Origem não autorizada.')
  }

  function documentAccess(documentId, userId) {
    const row = database.prepare(`
      SELECT documents.id, documents.owner_id, documents.team_id, documents.name, documents.data_json, documents.revision, documents.access_suspended, documents.created_at, documents.updated_at,
             team_membership.team_role,
             CASE WHEN documents.owner_id = ? OR (documents.team_id IS NOT NULL AND team_membership.team_role = 'admin') THEN 'owner'
                  WHEN team_membership.team_role = 'member' THEN 'editor'
                  WHEN documents.team_id IS NOT NULL THEN document_permissions.role
                  ELSE document_permissions.role END AS role
      FROM documents LEFT JOIN document_permissions
        ON document_permissions.document_id = documents.id AND document_permissions.user_id = ?
      LEFT JOIN (SELECT team_id, user_id, role AS team_role FROM team_members) AS team_membership
        ON team_membership.team_id = documents.team_id AND team_membership.user_id = ?
      WHERE documents.id = ? AND (documents.owner_id = ? OR document_permissions.user_id = ? OR team_membership.user_id = ?)
    `).get(userId, userId, userId, documentId, userId, userId, userId)
    if (!row) throw new HttpError(404, 'Projeto não encontrado.')
    if (row.access_suspended && row.owner_id !== userId && row.team_role !== 'admin') throw new HttpError(404, 'Projeto não encontrado.')
    return row
  }

  function normalizeDocumentMediaReferences(documentId, data, hydrate) {
    const document = structuredClone(data)
    for (const page of document.pages ?? []) {
      for (const element of page.elements ?? []) {
        if (element?.type !== 'image' || typeof element.assetId !== 'string') continue
        const asset = database.prepare('SELECT src, object_key, mime_type FROM document_media WHERE document_id = ? AND asset_id = ?').get(documentId, element.assetId)
        if (!asset) continue
        const src = readMediaSource(asset)
        if (hydrate && (!element.src || element.src === src)) element.src = src
        else if (!hydrate && element.src === src) element.src = ''
      }
    }
    return document
  }

  function serializeDocument(row) {
    return {
      id: row.id,
      name: row.name,
      data: normalizeDocumentMediaReferences(row.id, JSON.parse(row.data_json), true),
      revision: row.revision,
      accessSuspended: Boolean(row.access_suspended),
      role: row.role,
      ownerId: row.owner_id,
      teamId: row.team_id ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  async function handle(request, response) {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const path = url.pathname
    const method = request.method ?? 'GET'
    if (path.startsWith('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) requireOrigin(request)

    if (method === 'GET' && path === '/api/health') return sendJson(response, 200, { status: 'ok' })

    if (method === 'GET' && path === '/api/providers/status') return sendJson(response, 200, externalProviderStatus)

    const sitePublicationMatch = path.match(/^\/api\/sites\/([^/]+)\/publication$/)
    if (sitePublicationMatch) {
      if (method !== 'GET') throw new HttpError(405, 'Método não permitido.')
      const user = requireUser(request)
      const documentId = decodeURIComponent(sitePublicationMatch[1])
      const access = documentAccess(documentId, user.id)
      if (access.role !== 'owner') throw new HttpError(403, 'Somente quem administra este site pode consultar sua publicação.')
      const data = JSON.parse(access.data_json)
      if (data.type !== 'site') throw new HttpError(400, 'O projeto não é um site.')
      const row = database.prepare(`SELECT slug, url, deployment_id AS deploymentId, published_at AS publishedAt,
        published_revision AS publishedRevision FROM site_publications WHERE document_id = ?`).get(documentId)
      const publication = row ?? null
      return sendJson(response, 200, {
        publication,
        currentRevision: access.revision,
        isOutdated: publication ? publication.publishedRevision !== access.revision : false,
      })
    }

    const sitePublishMatch = path.match(/^\/api\/sites\/([^/]+)\/publish$/)
    if (sitePublishMatch) {
      if (method !== 'POST') throw new HttpError(405, 'Método não permitido.')
      if (!sitePublisher) throw new HttpError(503, 'Publicação externa de Sites não está configurada.', { provider: 'sitePublication', configured: false, missing: externalProviderStatus.sitePublication.missing })
      const user = requireUser(request)
      const documentId = decodeURIComponent(sitePublishMatch[1])
      const access = documentAccess(documentId, user.id)
      if (access.role !== 'owner') throw new HttpError(403, 'Somente quem administra este site pode publicá-lo.')
      const data = JSON.parse(access.data_json)
      if (data.type !== 'site' || data.trashedAt) throw new HttpError(400, 'Somente um site ativo pode ser publicado.')
      const body = await readJson(request)
      if (Object.keys(body).some(key => key !== 'slug')) throw new HttpError(400, 'Envie somente o identificador do site.')
      const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : ''
      if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) throw new HttpError(400, 'Informe um identificador de site de 1 a 63 caracteres, usando letras, números ou hífens.')
      const site = {
        id: access.id,
        name: access.name,
        type: data.type,
        width: data.width,
        height: data.height,
        pages: (data.pages ?? []).filter(page => !page.hidden).map(page => {
          const visiblePage = structuredClone(page)
          delete visiblePage.presenterNotes
          return visiblePage
        }),
      }
      let publication
      try { publication = await sitePublisher.publish({ documentId, slug, site }) }
      catch { throw new HttpError(502, 'O provedor de publicação não concluiu a solicitação.') }
      if (!publication || typeof publication.deploymentId !== 'string' || !publication.deploymentId.trim() || !isHttpsProviderUrl(publication.url)) throw new HttpError(502, 'O provedor de publicação retornou uma resposta inválida.')
      const publishedAt = new Date().toISOString()
      database.prepare(`INSERT INTO site_publications (document_id, slug, url, deployment_id, published_at, published_revision)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(document_id) DO UPDATE SET slug = excluded.slug, url = excluded.url, deployment_id = excluded.deployment_id,
          published_at = excluded.published_at, published_revision = excluded.published_revision`)
        .run(documentId, slug, publication.url, publication.deploymentId, publishedAt, access.revision)
      return sendJson(response, 200, { publication: { slug, url: publication.url, deploymentId: publication.deploymentId, publishedAt, publishedRevision: access.revision } })
    }

    if (path === '/api/print/checkout') {
      if (method !== 'POST') throw new HttpError(405, 'Método não permitido.')
      if (!printCheckoutProvider) throw new HttpError(503, 'Checkout externo de impressão não está configurado.', { provider: 'printCheckout', configured: false, missing: externalProviderStatus.printCheckout.missing })
      const user = requireUser(request)
      const body = await readJson(request)
      if (Object.keys(body).some(key => !['documentId', 'options'].includes(key))) throw new HttpError(400, 'Envie somente o projeto e as opções de impressão; o pagamento será coletado pelo provedor.')
      const documentId = typeof body.documentId === 'string' ? body.documentId : ''
      const access = documentAccess(documentId, user.id)
      if (access.role !== 'owner') throw new HttpError(403, 'Somente quem administra o projeto pode iniciar o checkout de impressão.')
      const document = serializeDocument(access)
      if (document.data.type !== 'design' || document.data.trashedAt) throw new HttpError(400, 'O checkout de impressão aceita somente designs ativos.')
      const options = body.options
      const validOptions = options && typeof options === 'object' && !Array.isArray(options)
        && Object.keys(options).length === 4
        && ['vertical-standard', 'horizontal-standard', 'vertical-slim', 'horizontal-slim'].includes(options.format)
        && ['standard', 'premium'].includes(options.paper)
        && ['matte', 'gloss'].includes(options.finish)
        && [50, 100, 150, 200, 250, 500, 1000, 1500, 2000].includes(options.quantity)
      if (!validOptions) throw new HttpError(400, 'As opções de impressão não são válidas.')
      let checkout
      try { checkout = await printCheckoutProvider.createCheckout({ documentId, product: 'business-card', options, document }) }
      catch { throw new HttpError(502, 'O provedor de checkout não concluiu a solicitação.') }
      if (!checkout || typeof checkout.sessionId !== 'string' || !checkout.sessionId.trim() || !isHttpsProviderUrl(checkout.checkoutUrl)) throw new HttpError(502, 'O provedor de checkout retornou uma resposta inválida.')
      return sendJson(response, 200, { checkout: { checkoutUrl: checkout.checkoutUrl, sessionId: checkout.sessionId } })
    }

    if (path === '/api/notifications/events') {
      if (method !== 'GET') throw new HttpError(405, 'Método não permitido.')
      return subscribeNotifications(request, response, requireUser(request))
    }

    const publicShareMatch = path.match(/^\/api\/public-shares\/([A-Za-z0-9_-]{32,128})$/)
    if (publicShareMatch && method === 'GET') {
      const tokenHash = hashToken(publicShareMatch[1])
      const shared = database.prepare(`
        SELECT documents.id, documents.name, documents.data_json, documents.access_suspended
        FROM document_public_links JOIN documents ON documents.id = document_public_links.document_id
        WHERE document_public_links.token_hash = ? AND document_public_links.revoked_at IS NULL
      `).get(tokenHash)
      if (!shared || shared.access_suspended) throw new HttpError(404, 'Este link de compartilhamento não está disponível.')
      const data = JSON.parse(shared.data_json)
      if (data.trashedAt) throw new HttpError(404, 'Este link de compartilhamento não está disponível.')
      if (data.type === 'site') data.pages = (data.pages ?? []).filter(page => !page.hidden)
      for (const page of data.pages ?? []) delete page.presenterNotes
      const referencedIds = [...new Set((data.pages ?? []).flatMap(page => (page.timelineClips ?? []).map(clip => clip.assetId).filter(Boolean)))].slice(0, 500)
      const timelineMedia = {}
      if (referencedIds.length) {
        const placeholders = referencedIds.map(() => '?').join(', ')
        const rows = database.prepare(`SELECT asset_id, name, mime_type, width, height, src, object_key FROM document_media WHERE document_id = ? AND asset_id IN (${placeholders})`).all(shared.id, ...referencedIds)
        for (const row of rows) timelineMedia[row.asset_id] = { name: row.name, mimeType: row.mime_type, width: row.width, height: row.height, src: readMediaSource(row) }
      }
      return sendJson(response, 200, { name: shared.name, document: normalizeDocumentMediaReferences(shared.id, data, true), timelineMedia })
    }
    if (publicShareMatch) throw new HttpError(405, 'Método não permitido.')

    const notificationMatch = path.match(/^\/api\/notifications(?:\/([^/]+))?$/)
    if (notificationMatch) {
      const user = requireUser(request)
      const notificationId = notificationMatch[1] ? decodeURIComponent(notificationMatch[1]) : ''
      if (!notificationId && method === 'GET') {
        const notifications = database.prepare(`
          SELECT n.id, n.document_id AS documentId, d.name AS documentName,
                 n.comment_id AS commentId, c.content AS commentContent,
                 n.actor_id AS actorId, u.name AS actorName,
                 n.created_at AS createdAt, n.read_at AS readAt
          FROM notifications n
          JOIN documents d ON d.id = n.document_id
          JOIN comments c ON c.id = n.comment_id
          JOIN users u ON u.id = n.actor_id
          WHERE n.user_id = ?
            AND (
              d.owner_id = ?
              OR EXISTS (
                SELECT 1 FROM document_permissions p
                WHERE p.document_id = d.id AND p.user_id = ? AND d.access_suspended = 0
              )
              OR EXISTS (
                SELECT 1 FROM team_members tm
                WHERE tm.team_id = d.team_id AND tm.user_id = ?
                  AND (d.access_suspended = 0 OR tm.role = 'admin')
              )
            )
          ORDER BY n.created_at DESC LIMIT 100
        `).all(user.id, user.id, user.id, user.id)
        return sendJson(response, 200, { notifications, unreadCount: notifications.filter(item => !item.readAt).length })
      }
      if (notificationId && method === 'PATCH') {
        const body = await readJson(request)
        if (typeof body.read !== 'boolean') throw new HttpError(400, 'Informe se a notificação foi lida.')
        const item = database.prepare('SELECT id, document_id AS documentId FROM notifications WHERE id = ? AND user_id = ?').get(notificationId, user.id)
        if (!item) throw new HttpError(404, 'Notificação não encontrada.')
        documentAccess(item.documentId, user.id)
        const readAt = body.read ? new Date().toISOString() : null
        database.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?').run(readAt, notificationId, user.id)
        return sendJson(response, 200, { notification: { id: notificationId, readAt } })
      }
      throw new HttpError(405, 'Método não permitido.')
    }

    if (method === 'POST' && path === '/api/ai/text') {
      const user = requireUser(request)
      const body = await readJson(request)
      const documentId = typeof body.documentId === 'string' ? body.documentId : ''
      const access = documentAccess(documentId, user.id)
      if (!['owner', 'editor'].includes(access.role)) throw new HttpError(403, 'Seu acesso permite visualizar ou comentar, mas não gerar conteúdo para este projeto.')
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
      if (prompt.length < 3 || prompt.length > 2000) throw new HttpError(400, 'Descreva o texto desejado em 3 a 2.000 caracteres.')
      try {
        const text = await textGenerator.generate(prompt)
        return sendJson(response, 200, { text, mode: textGenerator.mode })
      } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : 502
        return sendJson(response, status, { error: error instanceof Error ? error.message : 'Falha no provedor de IA.' })
      }
    }

    if (method === 'POST' && path === '/api/ai/image') {
      const user = requireUser(request)
      const body = await readJson(request)
      const documentId = typeof body.documentId === 'string' ? body.documentId : ''
      const access = documentAccess(documentId, user.id)
      if (!['owner', 'editor'].includes(access.role)) throw new HttpError(403, 'Seu acesso permite visualizar ou comentar, mas não gerar conteúdo para este projeto.')
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
      if (prompt.length < 3 || prompt.length > 2000) throw new HttpError(400, 'Descreva a imagem em 3 a 2.000 caracteres.')
      try {
        const image = await imageGenerator.generate(prompt)
        return sendJson(response, 200, image)
      } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : 502
        return sendJson(response, status, { error: error instanceof Error ? error.message : 'Falha no provedor de imagens.' })
      }
    }

    if (method === 'POST' && path === '/api/auth/register') {
      const body = await readJson(request)
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      const password = typeof body.password === 'string' ? body.password : ''
      if (name.length < 1 || name.length > 80) throw new HttpError(400, 'Informe um nome com até 80 caracteres.')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new HttpError(400, 'Informe um e-mail válido.')
      if (password.length < 10 || password.length > 128) throw new HttpError(400, 'A senha precisa ter entre 10 e 128 caracteres.')
      const id = randomUUID()
      const createdAt = new Date().toISOString()
      try {
        database.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(id, name, email, hashPassword(password), createdAt)
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'Já existe uma conta com este e-mail.')
        throw error
      }
      return sendJson(response, 201, { user: { id, name, email } })
    }

    if (method === 'POST' && path === '/api/auth/login') {
      const body = await readJson(request)
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      const password = typeof body.password === 'string' ? body.password : ''
      const now = Date.now()
      const client = request.socket.remoteAddress ?? 'unknown'
      const recent = (attempts.get(client) ?? []).filter(timestamp => now - timestamp < 15 * 60 * 1000)
      if (recent.length >= 20) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.')
      recent.push(now)
      attempts.set(client, recent)
      const user = database.prepare('SELECT id, name, email, password_hash FROM users WHERE email = ?').get(email)
      if (!user || !verifyPassword(password, user.password_hash)) throw new HttpError(401, 'E-mail ou senha incorretos.')
      const token = randomBytes(32).toString('base64url')
      const expiresAt = new Date(now + SESSION_TTL_SECONDS * 1000).toISOString()
      database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
        .run(hashToken(token), user.id, expiresAt, new Date(now).toISOString())
      const secure = secureCookies ? '; Secure' : ''
      return sendJson(response, 200, { user: publicUser(user) }, {
        'set-cookie': `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`,
      })
    }

    if (method === 'POST' && path === '/api/auth/password-reset/request') {
      const body = await readJson(request)
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new HttpError(400, 'Informe um e-mail válido.')
      const client = request.socket.remoteAddress ?? 'unknown'
      const recent = (passwordResetAttempts.get(client) ?? []).filter(timestamp => Date.now() - timestamp < 15 * 60 * 1000)
      if (recent.length < 5) {
        recent.push(Date.now())
        passwordResetAttempts.set(client, recent)
      } else {
        return sendJson(response, 202, { message: 'Se a conta existir, enviaremos as instruções para redefinir a senha.' })
      }
      const user = database.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email)
      if (user) {
        const now = Date.now()
        const createdAt = new Date(now).toISOString()
        const expiresAt = new Date(now + 30 * 60 * 1000).toISOString()
        const token = randomBytes(32).toString('base64url')
        database.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(user.id)
        database.prepare('INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
          .run(hashToken(token), user.id, expiresAt, createdAt)
        void sendPasswordResetEmailSafely({ email: user.email, name: user.name, token, expiresAt })
      }
      // Keep the response identical for known and unknown accounts.
      return sendJson(response, 202, { message: 'Se a conta existir, enviaremos as instruções para redefinir a senha.' })
    }

    if (method === 'POST' && path === '/api/auth/password-reset/complete') {
      const body = await readJson(request)
      const token = typeof body.token === 'string' ? body.token : ''
      const password = typeof body.password === 'string' ? body.password : ''
      if (password.length < 10 || password.length > 128) throw new HttpError(400, 'A senha precisa ter entre 10 e 128 caracteres.')
      const now = new Date().toISOString()
      const tokenHash = hashToken(token)
      database.exec('BEGIN IMMEDIATE')
      try {
        const reset = database.prepare('SELECT user_id AS userId FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').get(tokenHash, now)
        if (!reset) {
          database.exec('ROLLBACK')
          throw new HttpError(400, 'O link de redefinição é inválido, expirou ou já foi usado.')
        }
        const claimed = database.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').run(now, tokenHash, now)
        if (claimed.changes !== 1) {
          database.exec('ROLLBACK')
          throw new HttpError(400, 'O link de redefinição é inválido, expirou ou já foi usado.')
        }
        database.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), reset.userId)
        database.prepare('DELETE FROM sessions WHERE user_id = ?').run(reset.userId)
        database.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? AND token_hash <> ?').run(reset.userId, tokenHash)
        database.exec('COMMIT')
        expireUserSubscribers(reset.userId)
      } catch (error) {
        try { database.exec('ROLLBACK') } catch {}
        throw error
      }
      return sendJson(response, 200, { ok: true }, { 'set-cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` })
    }

    if (method === 'POST' && path === '/api/auth/logout') {
      const token = readCookies(request.headers.cookie)[SESSION_COOKIE]
      const user = currentUser(request)
      if (token) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
      if (user) expireUserSubscribers(user.id)
      return sendJson(response, 200, { ok: true }, { 'set-cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` })
    }

    if (method === 'GET' && path === '/api/auth/me') {
      const user = currentUser(request)
      if (!user) throw new HttpError(401, 'Entre na sua conta para continuar.')
      return sendJson(response, 200, { user: publicUser(user) })
    }

    if (path === '/api/teams' && method === 'GET') {
      const user = requireUser(request)
      const teams = database.prepare(`
        SELECT teams.id, teams.name, teams.created_at AS createdAt, team_members.role,
               (SELECT COUNT(*) FROM team_members AS members WHERE members.team_id = teams.id) AS memberCount
        FROM team_members JOIN teams ON teams.id = team_members.team_id
        WHERE team_members.user_id = ? ORDER BY teams.created_at DESC
      `).all(user.id)
      return sendJson(response, 200, { teams })
    }

    if (path === '/api/teams' && method === 'POST') {
      const user = requireUser(request)
      const body = await readJson(request)
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (name.length < 2 || name.length > 100) throw new HttpError(400, 'O nome da equipe precisa ter entre 2 e 100 caracteres.')
      const id = randomUUID()
      const createdAt = new Date().toISOString()
      database.exec('BEGIN IMMEDIATE')
      try {
        if (database.prepare('SELECT 1 FROM teams WHERE created_by = ? AND lower(name) = lower(?)').get(user.id, name)) throw new HttpError(409, 'Você já tem uma equipe com esse nome.')
        database.prepare('INSERT INTO teams (id, name, created_by, created_at) VALUES (?, ?, ?, ?)').run(id, name, user.id, createdAt)
        database.prepare('INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, \'admin\', ?)').run(id, user.id, createdAt)
        recordAudit({ user, action: 'team.created', targetType: 'team', targetId: id, details: { name }, teamId: id })
        database.exec('COMMIT')
      } catch (error) { try { database.exec('ROLLBACK') } catch {}; throw error }
      publishTeam(id)
      return sendJson(response, 201, { team: { id, name, role: 'admin', memberCount: 1, createdAt } })
    }

    if (path === '/api/team-events' && method === 'GET') {
      const user = requireUser(request)
      subscribeUserTeams(request, response, user)
      return
    }

    const teamEventsMatch = path.match(/^\/api\/teams\/([^/]+)\/events$/)
    if (teamEventsMatch && method === 'GET') {
      const teamId = decodeURIComponent(teamEventsMatch[1])
      const user = requireUser(request)
      if (!database.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, user.id)) throw new HttpError(404, 'Equipe não encontrada.')
      subscribeTeam(request, response, teamId, user)
      return
    }

    const teamGroupsMatch = path.match(/^\/api\/teams\/([^/]+)\/groups(?:\/([^/]+)(?:\/(members))?)?$/)
    if (teamGroupsMatch) {
      const teamId = decodeURIComponent(teamGroupsMatch[1])
      const groupId = teamGroupsMatch[2] ? decodeURIComponent(teamGroupsMatch[2]) : ''
      const isMembersPath = teamGroupsMatch[3] === 'members'
      const user = requireUser(request)
      const membership = database.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, user.id)
      if (!membership) throw new HttpError(404, 'Equipe não encontrada.')
      const requireAdmin = () => { if (membership.role !== 'admin') throw new HttpError(403, 'Somente administradores gerenciam grupos da equipe.') }
      const selectMembers = id => database.prepare(`SELECT users.id, users.name, users.email, team_members.role, team_members.joined_at AS joinedAt,
        EXISTS(SELECT 1 FROM team_brand_designers designers WHERE designers.team_id = team_members.team_id AND designers.user_id = team_members.user_id) AS brandDesigner
        FROM team_group_members group_members
        JOIN team_members ON team_members.team_id = group_members.team_id AND team_members.user_id = group_members.user_id
        JOIN users ON users.id = team_members.user_id
        WHERE group_members.team_id = ? AND group_members.group_id = ?
        ORDER BY CASE team_members.role WHEN 'admin' THEN 0 ELSE 1 END, users.name`).all(teamId, id).map(member => ({ ...member, brandDesigner: Boolean(member.brandDesigner) }))
      const selectGroup = id => {
        const group = database.prepare('SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM team_groups WHERE team_id = ? AND id = ?').get(teamId, id)
        return group ? { ...group, members: selectMembers(id) } : null
      }

      if (!groupId && !isMembersPath && method === 'GET') {
        const groups = database.prepare('SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM team_groups WHERE team_id = ? ORDER BY name COLLATE NOCASE, created_at').all(teamId)
          .map(group => ({ ...group, members: selectMembers(group.id) }))
        return sendJson(response, 200, { groups })
      }
      if (!groupId && !isMembersPath && method === 'POST') {
        requireAdmin()
        const body = await readJson(request)
        if (Object.keys(body).some(key => key !== 'name')) throw new HttpError(400, 'Informe somente o nome do grupo.')
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        if (!name || name.length > 80) throw new HttpError(400, 'O nome do grupo precisa ter entre 1 e 80 caracteres.')
        if (database.prepare('SELECT 1 FROM team_groups WHERE team_id = ? AND lower(name) = lower(?)').get(teamId, name)) throw new HttpError(409, 'Já existe um grupo com esse nome nesta equipe.')
        const id = randomUUID()
        const now = new Date().toISOString()
        database.exec('BEGIN IMMEDIATE')
        try {
          database.prepare('INSERT INTO team_groups (team_id, id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(teamId, id, name, user.id, now, now)
          recordAudit({ user, action: 'team.group.created', targetType: 'team-group', targetId: id, details: { name }, teamId })
          database.exec('COMMIT')
        } catch (error) { try { database.exec('ROLLBACK') } catch {}; throw error }
        publishTeam(teamId)
        return sendJson(response, 201, { group: selectGroup(id) })
      }
      if (groupId && !isMembersPath && method === 'PATCH') {
        requireAdmin()
        const body = await readJson(request)
        if (Object.keys(body).some(key => key !== 'name')) throw new HttpError(400, 'Informe somente o nome do grupo.')
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        if (!name || name.length > 80) throw new HttpError(400, 'O nome do grupo precisa ter entre 1 e 80 caracteres.')
        if (!database.prepare('SELECT 1 FROM team_groups WHERE team_id = ? AND id = ?').get(teamId, groupId)) throw new HttpError(404, 'Grupo não encontrado.')
        if (database.prepare('SELECT 1 FROM team_groups WHERE team_id = ? AND lower(name) = lower(?) AND id <> ?').get(teamId, name, groupId)) throw new HttpError(409, 'Já existe um grupo com esse nome nesta equipe.')
        const now = new Date().toISOString()
        database.exec('BEGIN IMMEDIATE')
        try {
          database.prepare('UPDATE team_groups SET name = ?, updated_at = ? WHERE team_id = ? AND id = ?').run(name, now, teamId, groupId)
          recordAudit({ user, action: 'team.group.renamed', targetType: 'team-group', targetId: groupId, details: { name }, teamId })
          database.exec('COMMIT')
        } catch (error) { try { database.exec('ROLLBACK') } catch {}; throw error }
        publishTeam(teamId)
        return sendJson(response, 200, { group: selectGroup(groupId) })
      }
      if (groupId && !isMembersPath && method === 'DELETE') {
        requireAdmin()
        const group = database.prepare('SELECT name FROM team_groups WHERE team_id = ? AND id = ?').get(teamId, groupId)
        if (!group) throw new HttpError(404, 'Grupo não encontrado.')
        database.exec('BEGIN IMMEDIATE')
        try {
          database.prepare('DELETE FROM team_groups WHERE team_id = ? AND id = ?').run(teamId, groupId)
          recordAudit({ user, action: 'team.group.deleted', targetType: 'team-group', targetId: groupId, details: { name: group.name }, teamId })
          database.exec('COMMIT')
        } catch (error) { try { database.exec('ROLLBACK') } catch {}; throw error }
        publishTeam(teamId)
        return sendJson(response, 200, { ok: true })
      }
      if (groupId && isMembersPath && method === 'PUT') {
        requireAdmin()
        const body = await readJson(request)
        const userIds = body.userIds
        if (Object.keys(body).some(key => key !== 'userIds') || !Array.isArray(userIds) || userIds.length > 2_000
          || !userIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 128)
          || new Set(userIds).size !== userIds.length) throw new HttpError(400, 'Informe uma lista válida de integrantes para o grupo.')
        if (!database.prepare('SELECT 1 FROM team_groups WHERE team_id = ? AND id = ?').get(teamId, groupId)) throw new HttpError(404, 'Grupo não encontrado.')
        const existingIds = database.prepare('SELECT user_id AS userId FROM team_group_members WHERE team_id = ? AND group_id = ? ORDER BY user_id').all(teamId, groupId).map(row => row.userId)
        const validIds = new Set(database.prepare('SELECT user_id AS userId FROM team_members WHERE team_id = ?').all(teamId).map(row => row.userId))
        if (userIds.some(id => !validIds.has(id))) throw new HttpError(400, 'Todos os integrantes precisam pertencer a esta equipe.')
        const previous = new Set(existingIds), next = new Set(userIds)
        const added = userIds.filter(id => !previous.has(id)), removed = existingIds.filter(id => !next.has(id))
        const now = new Date().toISOString()
        database.exec('BEGIN IMMEDIATE')
        try {
          database.prepare('DELETE FROM team_group_members WHERE team_id = ? AND group_id = ?').run(teamId, groupId)
          const insert = database.prepare('INSERT INTO team_group_members (team_id, group_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?, ?)')
          for (const id of userIds) insert.run(teamId, groupId, id, user.id, now)
          if (added.length || removed.length) {
            database.prepare('UPDATE team_groups SET updated_at = ? WHERE team_id = ? AND id = ?').run(now, teamId, groupId)
            recordAudit({ user, action: 'team.group.members_changed', targetType: 'team-group', targetId: groupId, details: { added, removed }, teamId })
          }
          database.exec('COMMIT')
        } catch (error) { try { database.exec('ROLLBACK') } catch {}; throw error }
        if (added.length || removed.length) publishTeam(teamId)
        return sendJson(response, 200, { group: selectGroup(groupId) })
      }
      throw new HttpError(405, 'Operação de grupo não suportada.')
    }

    const teamMatch = path.match(/^\/api\/teams\/([^/]+)(?:\/(members|invitations(?:\/([^/]+))?|documents|audit|media(?:\/([^/]+))?|policies))?$/)
    if (teamMatch) {
      const teamId = decodeURIComponent(teamMatch[1])
      const matchedSubresource = teamMatch[2] ?? ''
      const subresource = matchedSubresource.startsWith('invitations/') ? 'invitations' : matchedSubresource.startsWith('media/') ? 'media' : matchedSubresource
      const invitationId = teamMatch[3] ?? ''
      const teamMediaId = teamMatch[4] ? decodeURIComponent(teamMatch[4]) : ''
      const user = requireUser(request)
      const membership = database.prepare(`SELECT team_members.role,
        EXISTS(SELECT 1 FROM team_brand_designers designers WHERE designers.team_id = team_members.team_id AND designers.user_id = team_members.user_id) AS brandDesigner
        FROM team_members WHERE team_id = ? AND user_id = ?`).get(teamId, user.id)
      if (!membership && subresource === 'invitations' && !invitationId && method === 'POST') throw new HttpError(403, 'Somente integrantes administradores podem convidar pessoas.')
      if (!membership) throw new HttpError(404, 'Equipe não encontrada.')
      if (!subresource && method === 'PATCH') {
        if (membership.role !== 'admin') throw new HttpError(403, 'Somente administradores podem alterar o perfil da equipe.')
        const body = await readJson(request)
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'name')) throw new HttpError(400, 'Informe somente o nome da equipe.')
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        if (name.length < 2 || name.length > 100) throw new HttpError(400, 'O nome da equipe precisa ter entre 2 e 100 caracteres.')
        database.exec('BEGIN IMMEDIATE')
        try {
          const existing = database.prepare('SELECT id, name, created_at AS createdAt, created_by AS createdBy FROM teams WHERE id = ?').get(teamId)
          if (!existing) throw new HttpError(404, 'Equipe não encontrada.')
          if (database.prepare('SELECT 1 FROM teams WHERE created_by = ? AND lower(name) = lower(?) AND id <> ?').get(existing.createdBy, name, teamId)) throw new HttpError(409, 'Você já tem uma equipe com esse nome.')
          if (existing.name !== name) {
            database.prepare('UPDATE teams SET name = ? WHERE id = ?').run(name, teamId)
            recordAudit({ user, action: 'team.profile.updated', targetType: 'team', targetId: teamId, details: { previousName: existing.name, name }, teamId })
          }
          const team = database.prepare(`SELECT teams.id, teams.name, teams.created_at AS createdAt,
            (SELECT COUNT(*) FROM team_members WHERE team_id = teams.id) AS memberCount
            FROM teams WHERE teams.id = ?`).get(teamId)
          database.exec('COMMIT')
          if (existing.name !== name) publishTeam(teamId)
          return sendJson(response, 200, { team: { ...team, role: membership.role } })
        } catch (error) { try { database.exec('ROLLBACK') } catch {}; throw error }
      }
      if (subresource === 'policies' && method === 'GET') {
        const policies = Object.fromEntries(database.prepare('SELECT policy_key, policy_value FROM team_policies WHERE team_id = ?').all(teamId).map(row => [row.policy_key, row.policy_value]))
        return sendJson(response, 200, { policies })
      }
      if (subresource === 'policies' && method === 'PUT') {
        if (membership.role !== 'admin') throw new HttpError(403, 'Somente administradores alteram as políticas da equipe.')
        const body = await readJson(request)
        const policies = body.policies
        const allowedPolicyKeys = ['uploadScope', 'transferOwnership', 'enabledIntegrations']
        const hasValidShape = policies && typeof policies === 'object' && !Array.isArray(policies)
          && Object.keys(policies).length > 0 && Object.keys(policies).every(key => allowedPolicyKeys.includes(key))
        const validUploadScope = !Object.hasOwn(policies ?? {}, 'uploadScope')
          || ['Todo mundo', 'Admins e designers de marca da equipe'].includes(policies.uploadScope)
        const validTransferOwnership = !Object.hasOwn(policies ?? {}, 'transferOwnership')
          || ['true', 'false'].includes(policies.transferOwnership)
        const hasEnabledIntegrations = Object.hasOwn(policies ?? {}, 'enabledIntegrations')
        const integrationIds = hasEnabledIntegrations && typeof policies.enabledIntegrations === 'string' && policies.enabledIntegrations.length <= 512
          ? (() => { try { return JSON.parse(policies.enabledIntegrations) } catch { return null } })()
          : undefined
        const allowedIntegrationIds = new Set(['drive', 'slack', 'notion', 'calendar', 'figma', 'dropbox', 'teams', 'asana'])
        const validEnabledIntegrations = !hasEnabledIntegrations || (Array.isArray(integrationIds)
          && integrationIds.length <= allowedIntegrationIds.size
          && integrationIds.every(id => typeof id === 'string' && allowedIntegrationIds.has(id))
          && new Set(integrationIds).size === integrationIds.length)
        if (!hasValidShape || !validUploadScope || !validTransferOwnership || !validEnabledIntegrations) {
          throw new HttpError(400, 'Política de equipe inválida.')
        }
        const updatedAt = new Date().toISOString()
        const upsertPolicy = database.prepare(`INSERT INTO team_policies (team_id, policy_key, policy_value, updated_by, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(team_id, policy_key) DO UPDATE SET policy_value = excluded.policy_value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        for (const [policyKey, policyValue] of Object.entries(policies)) {
          upsertPolicy.run(teamId, policyKey, policyValue, user.id, updatedAt)
          recordAudit({ user, action: 'team.policy.updated', targetType: 'team-policy', targetId: policyKey, details: { value: policyValue }, teamId })
        }
        return sendJson(response, 200, { policies, updatedAt })
      }
      if (subresource === 'media' && method === 'GET') {
        const rows = database.prepare('SELECT asset_id, name, mime_type, width, height, src, object_key, fingerprint, library_visible, created_at FROM team_media WHERE team_id = ? AND library_visible = 1 ORDER BY created_at DESC').all(teamId)
        return sendJson(response, 200, { assets: rows.map(row => ({ id: row.asset_id, name: row.name, mimeType: row.mime_type, width: row.width, height: row.height, src: readMediaSource(row), fingerprint: row.fingerprint ?? undefined, libraryVisible: row.library_visible, createdAt: row.created_at, scope: 'team' })) })
      }
      if (subresource === 'media' && method === 'POST') {
        const uploadScope = database.prepare("SELECT policy_value FROM team_policies WHERE team_id = ? AND policy_key = 'uploadScope'").get(teamId)?.policy_value ?? 'Todo mundo'
        if (uploadScope === 'Admins e designers de marca da equipe' && membership.role !== 'admin' && !membership.brandDesigner) throw new HttpError(403, 'A política desta equipe permite upload somente a admins e designers de marca.')
        const body = await readJson(request)
        const asset = body.asset
        const validAsset = asset && typeof asset === 'object' && !Array.isArray(asset)
          && typeof asset.id === 'string' && asset.id.length > 0 && asset.id.length <= 100
          && typeof asset.name === 'string' && asset.name.trim().length > 0 && asset.name.length <= 256
          && typeof asset.mimeType === 'string' && /^(?:image\/[a-z0-9][a-z0-9.+-]*|video\/(?:mp4|webm|quicktime)|audio\/(?:mpeg|mp4|ogg|wav|webm|flac|aac))$/i.test(asset.mimeType)
          && Number.isInteger(asset.width) && asset.width > 0 && Number.isInteger(asset.height) && asset.height > 0 && (asset.mimeType.startsWith('audio/') ? asset.width === 1 && asset.height === 1 : asset.width * asset.height <= 32_000_000)
          && typeof asset.src === 'string' && asset.src.length <= 14_000_000 && asset.src.startsWith(`data:${asset.mimeType};base64,`)
          && (asset.fingerprint === undefined || typeof asset.fingerprint === 'string' && /^[a-f0-9]{64}$/i.test(asset.fingerprint))
          && (asset.createdAt === undefined || typeof asset.createdAt === 'string' && asset.createdAt.length <= 40)
        if (!validAsset) throw new HttpError(400, 'Mídia inválida ou acima dos limites suportados.')
        const duplicate = asset.fingerprint ? database.prepare('SELECT asset_id, name, mime_type, width, height, src, object_key, fingerprint, created_at FROM team_media WHERE team_id = ? AND fingerprint = ?').get(teamId, asset.fingerprint) : null
        if (duplicate) {
          database.prepare('UPDATE team_media SET library_visible = 1 WHERE team_id = ? AND asset_id = ?').run(teamId, duplicate.asset_id)
          return sendJson(response, 200, { asset: { id: duplicate.asset_id, name: duplicate.name, mimeType: duplicate.mime_type, width: duplicate.width, height: duplicate.height, src: readMediaSource(duplicate), fingerprint: duplicate.fingerprint ?? undefined, libraryVisible: 1, createdAt: duplicate.created_at, scope: 'team' } })
        }
        const createdAt = asset.createdAt || new Date().toISOString()
        const stored = storeMediaSource(asset.src)
        try {
          database.prepare('INSERT INTO team_media (team_id, asset_id, created_by, name, mime_type, width, height, src, object_key, fingerprint, library_visible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)')
            .run(teamId, asset.id, user.id, asset.name.trim(), asset.mimeType, asset.width, asset.height, stored.src, stored.objectKey, asset.fingerprint ?? null, createdAt)
        } catch (error) {
          if (String(error?.message ?? '').includes('UNIQUE')) throw new HttpError(409, 'Esta mídia já existe na biblioteca da equipe.')
          throw error
        }
        recordAudit({ user, action: 'team.media.uploaded', targetType: 'media', targetId: asset.id, details: { name: asset.name.trim() }, teamId })
        return sendJson(response, 201, { asset: { ...asset, name: asset.name.trim(), libraryVisible: 1, createdAt, scope: 'team' } })
      }
      if (subresource === 'media' && teamMediaId && method === 'DELETE') {
        if (membership.role !== 'admin') throw new HttpError(403, 'Somente administradores podem remover mídias da biblioteca da equipe.')
        const changed = database.prepare('UPDATE team_media SET library_visible = 0 WHERE team_id = ? AND asset_id = ? AND library_visible = 1').run(teamId, teamMediaId)
        if (!changed.changes) throw new HttpError(404, 'Mídia não encontrada.')
        recordAudit({ user, action: 'team.media.hidden', targetType: 'media', targetId: teamMediaId, teamId })
        return sendJson(response, 200, { ok: true })
      }
      if (!subresource && method === 'GET') {
        const team = database.prepare('SELECT id, name, created_at AS createdAt FROM teams WHERE id = ?').get(teamId)
        const members = database.prepare(`SELECT users.id, users.name, users.email, team_members.role, team_members.joined_at AS joinedAt,
          EXISTS(SELECT 1 FROM team_brand_designers designers WHERE designers.team_id = team_members.team_id AND designers.user_id = team_members.user_id) AS brandDesigner
          FROM team_members JOIN users ON users.id = team_members.user_id WHERE team_members.team_id = ?
          ORDER BY CASE team_members.role WHEN 'admin' THEN 0 ELSE 1 END, users.name`).all(teamId).map(member => ({ ...member, brandDesigner: Boolean(member.brandDesigner) }))
        return sendJson(response, 200, { team: { ...team, role: membership.role }, members })
      }
      if (subresource === 'documents' && method === 'GET') {
        const rows = database.prepare(`SELECT documents.id, documents.owner_id, documents.team_id, documents.name, documents.data_json, documents.revision, documents.created_at, documents.updated_at, CASE WHEN ? = 'admin' THEN 'owner' ELSE 'editor' END AS role FROM documents WHERE documents.team_id = ? ORDER BY documents.updated_at DESC`).all(membership.role, teamId)
        return sendJson(response, 200, { documents: rows.map(serializeDocument) })
      }
      if (subresource === 'audit' && method === 'GET') {
        if (membership.role !== 'admin') throw new HttpError(403, 'Somente administradores podem consultar a auditoria da equipe.')
        const url = new URL(request.url ?? '/', 'http://localhost')
        const limit = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50))
        const beforeRaw = url.searchParams.get('before')
        let beforeCreatedAt = null
        let beforeId = null
        if (beforeRaw) {
          try {
            const decoded = JSON.parse(Buffer.from(beforeRaw, 'base64url').toString('utf8'))
            if (typeof decoded.createdAt === 'string' && typeof decoded.id === 'string') {
              beforeCreatedAt = decoded.createdAt
              beforeId = decoded.id
            }
          } catch {}
          if (!beforeId) throw new HttpError(400, 'Cursor de auditoria inválido.')
        }
        const events = database.prepare(`
          SELECT id, actor_id AS actorId, actor_name AS actorName, action, target_type AS targetType,
                 target_id AS targetId, details_json AS detailsJson, created_at AS createdAt, document_id AS documentId
          FROM audit_events
          WHERE team_id = ? AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?))
          ORDER BY created_at DESC, id DESC LIMIT ?
        `).all(teamId, beforeCreatedAt, beforeCreatedAt, beforeCreatedAt, beforeId, limit).map(event => {
          const { detailsJson, ...safe } = event
          return { ...safe, details: JSON.parse(detailsJson) }
        })
        const last = events.at(-1)
        const nextBefore = events.length === limit && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString('base64url') : null
        return sendJson(response, 200, { events, nextBefore })
      }
      if (subresource === 'members' && method === 'PATCH') {
        if (membership.role !== 'admin') throw new HttpError(403, 'Somente administradores gerenciam integrantes.')
        const body = await readJson(request)
        const targetId = typeof body.userId === 'string' ? body.userId : ''
        if (Object.hasOwn(body, 'brandDesigner')) {
          if (Object.keys(body).some(key => !['userId', 'brandDesigner'].includes(key)) || typeof body.brandDesigner !== 'boolean') throw new HttpError(400, 'Informe uma designação de marca válida.')
          if (!database.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, targetId)) throw new HttpError(404, 'Integrante não encontrado.')
          if (body.brandDesigner) database.prepare(`INSERT INTO team_brand_designers (team_id, user_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(team_id, user_id) DO UPDATE SET assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at`).run(teamId, targetId, user.id, new Date().toISOString())
          else database.prepare('DELETE FROM team_brand_designers WHERE team_id = ? AND user_id = ?').run(teamId, targetId)
          const target = database.prepare('SELECT email FROM users WHERE id = ?').get(targetId)
          recordAudit({ user, action: 'team.member.brand_designer_changed', targetType: 'user', targetId, details: { email: target?.email, brandDesigner: body.brandDesigner }, teamId })
          publishTeam(teamId)
          return sendJson(response, 200, { ok: true, brandDesigner: body.brandDesigner })
        }
        const role = body.role
        if (!['admin', 'member'].includes(role)) throw new HttpError(400, 'Escolha administrador ou integrante.')
        if (targetId === user.id && role !== 'admin') throw new HttpError(400, 'Transfira a administração para outra pessoa antes de remover seu papel.')
        const changed = database.prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?').run(role, teamId, targetId)
        if (!changed.changes) throw new HttpError(404, 'Integrante não encontrado.')
        for (const document of database.prepare('SELECT id FROM documents WHERE team_id = ?').all(teamId)) {
          try { publishAccess(document.id, targetId, documentAccess(document.id, targetId).role) }
          catch { revokeSubscriber(document.id, targetId) }
        }
        const target = database.prepare('SELECT email FROM users WHERE id = ?').get(targetId)
        recordAudit({ user, action: 'team.member.role_changed', targetType: 'user', targetId, details: { email: target?.email, role }, teamId })
        publishTeam(teamId)
        return sendJson(response, 200, { ok: true })
      }
      if (subresource === 'members' && method === 'DELETE') {
        const targetId = new URL(request.url ?? '/', 'http://localhost').searchParams.get('userId') ?? ''
        if (targetId === user.id) {
          const memberCount = database.prepare('SELECT COUNT(*) AS count FROM team_members WHERE team_id = ?').get(teamId).count
          const adminCount = database.prepare("SELECT COUNT(*) AS count FROM team_members WHERE team_id = ? AND role = 'admin'").get(teamId).count
          if (membership.role === 'admin' && (memberCount < 2 || adminCount < 2)) throw new HttpError(409, 'Promova outra pessoa como administradora antes de sair da equipe.')
          database.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(teamId, user.id)
          revokeLostTeamDocumentAccess(teamId, user.id)
          recordAudit({ user, action: 'team.member.left', targetType: 'user', targetId: user.id, details: {}, teamId })
          publishTeam(teamId)
          revokeTeamSubscribers(teamId, user.id)
          return sendJson(response, 200, { ok: true })
        }
        if (membership.role !== 'admin') throw new HttpError(403, 'Somente administradores removem outras pessoas.')
        const changed = database.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(teamId, targetId)
        if (!changed.changes) throw new HttpError(404, 'Integrante não encontrado.')
        revokeLostTeamDocumentAccess(teamId, targetId)
        const target = database.prepare('SELECT email FROM users WHERE id = ?').get(targetId)
        recordAudit({ user, action: 'team.member.removed', targetType: 'user', targetId, details: { email: target?.email }, teamId })
        publishTeam(teamId)
        revokeTeamSubscribers(teamId, targetId)
        return sendJson(response, 200, { ok: true })
      }
      if (subresource === 'invitations' && !invitationId && method === 'GET') {
        if (membership.role !== 'admin') throw new HttpError(403, 'Somente administradores gerenciam convites.')
        const invitations = database.prepare('SELECT id, email, role, created_at AS createdAt, expires_at AS expiresAt, accepted_at AS acceptedAt, revoked_at AS revokedAt FROM team_invitations WHERE team_id = ? ORDER BY created_at DESC').all(teamId)
        return sendJson(response, 200, { invitations })
      }
      if (subresource === 'invitations' && !invitationId && method === 'POST') {
        if (membership.role !== 'admin') throw new HttpError(403, 'Somente administradores convidam integrantes.')
        const body = await readJson(request)
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
        const role = body.role ?? 'member'
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new HttpError(400, 'Informe um e-mail válido.')
        if (!['admin', 'member'].includes(role)) throw new HttpError(400, 'Escolha administrador ou integrante.')
        if (database.prepare('SELECT 1 FROM team_members JOIN users ON users.id = team_members.user_id WHERE team_members.team_id = ? AND users.email = ?').get(teamId, email)) throw new HttpError(409, 'Esta pessoa já integra a equipe.')
        const now = new Date()
        const createdAt = now.toISOString()
        const expiresAt = new Date(now.getTime() + 7 * 86400000).toISOString()
        database.prepare('UPDATE team_invitations SET revoked_at = ? WHERE team_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= ?').run(createdAt, teamId, email, createdAt)
        const id = randomUUID()
        const token = randomBytes(32).toString('base64url')
        database.prepare('INSERT INTO team_invitations (id, team_id, email, role, token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, teamId, email, role, hashToken(token), user.id, createdAt, expiresAt)
        recordAudit({ user, action: 'team.invitation.created', targetType: 'invitation', targetId: id, details: { email, role, expiresAt }, teamId })
        const team = database.prepare('SELECT name FROM teams WHERE id = ?').get(teamId)
        const delivery = await sendInvitationEmailSafely({ kind: 'team', email, token, targetName: team.name, inviterName: user.name, roleLabel: role === 'admin' ? 'administrador' : 'integrante' })
        return sendJson(response, 201, { invitation: { id, email, role, token, createdAt, expiresAt, delivery } })
      }
      if (subresource === 'invitations' && invitationId && method === 'DELETE') {
        if (membership.role !== 'admin') throw new HttpError(403, 'Somente administradores revogam convites.')
        const changed = database.prepare('UPDATE team_invitations SET revoked_at = ? WHERE id = ? AND team_id = ? AND accepted_at IS NULL AND revoked_at IS NULL').run(new Date().toISOString(), invitationId, teamId)
        if (!changed.changes) throw new HttpError(404, 'Convite pendente não encontrado.')
        recordAudit({ user, action: 'team.invitation.revoked', targetType: 'invitation', targetId: invitationId, teamId })
        return sendJson(response, 200, { ok: true })
      }
    }

    const teamInviteMatch = path.match(/^\/api\/team-invitations\/([^/]+)$/)
    if (teamInviteMatch) {
      const user = requireUser(request)
      const tokenHash = hashToken(teamInviteMatch[1])
      const invitation = database.prepare('SELECT team_invitations.*, teams.name AS team_name, users.name AS inviter_name FROM team_invitations JOIN teams ON teams.id = team_invitations.team_id JOIN users ON users.id = team_invitations.created_by WHERE token_hash = ?').get(tokenHash)
      if (!invitation || invitation.revoked_at || invitation.accepted_at) throw new HttpError(404, 'Convite indisponível.')
      if (Date.parse(invitation.expires_at) <= Date.now()) throw new HttpError(410, 'Este convite expirou.')
      if (user.email !== invitation.email) throw new HttpError(403, 'Entre com a conta convidada para continuar.')
      if (method === 'GET') return sendJson(response, 200, { invitation: { id: invitation.id, teamId: invitation.team_id, teamName: invitation.team_name, inviterName: invitation.inviter_name, email: invitation.email, role: invitation.role, expiresAt: invitation.expires_at } })
      if (method === 'POST') {
        database.exec('BEGIN IMMEDIATE')
        try {
          const current = database.prepare('SELECT team_id, email, role, expires_at, accepted_at, revoked_at FROM team_invitations WHERE token_hash = ?').get(tokenHash)
          if (!current || current.accepted_at || current.revoked_at || Date.parse(current.expires_at) <= Date.now()) throw new HttpError(409, 'Este convite já foi usado, revogado ou expirou.')
          if (current.email !== user.email) throw new HttpError(403, 'Entre com a conta convidada para continuar.')
          const now = new Date().toISOString()
          database.prepare('INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(current.team_id, user.id, current.role, now)
          database.prepare('UPDATE team_invitations SET accepted_at = ? WHERE token_hash = ?').run(now, tokenHash)
          recordAudit({ user, action: 'team.invitation.accepted', targetType: 'user', targetId: user.id, details: { role: current.role }, teamId: current.team_id })
          database.exec('COMMIT')
          publishTeam(current.team_id)
          return sendJson(response, 200, { ok: true, teamId: current.team_id })
        } catch (error) { try { database.exec('ROLLBACK') } catch {}; throw error }
      }
    }

    const invitationMatch = path.match(/^\/api\/invitations\/([^/]+)$/)
    if (invitationMatch) {
      const user = requireUser(request)
      const tokenHash = hashToken(decodeURIComponent(invitationMatch[1]))
      const invitation = database.prepare(`
        SELECT document_invitations.id, document_invitations.document_id AS documentId, document_invitations.email,
               document_invitations.role, document_invitations.created_at AS createdAt, document_invitations.expires_at AS expiresAt,
               document_invitations.accepted_at AS acceptedAt, document_invitations.revoked_at AS revokedAt,
               documents.name AS documentName, documents.access_suspended AS accessSuspended, owner.name AS ownerName
        FROM document_invitations JOIN documents ON documents.id = document_invitations.document_id
        JOIN users AS owner ON owner.id = document_invitations.created_by
        WHERE document_invitations.token_hash = ?
      `).get(tokenHash)
      if (!invitation || invitation.revokedAt || invitation.acceptedAt) throw new HttpError(404, 'Este convite não está mais disponível.')
      if (invitation.accessSuspended) throw new HttpError(404, 'Este convite não está mais disponível.')
      if (Date.parse(invitation.expiresAt) <= Date.now()) throw new HttpError(410, 'Este convite expirou. Peça ao proprietário para enviar outro.')
      if (user.email !== invitation.email) throw new HttpError(403, 'Entre com a conta convidada para continuar.')
      if (method === 'GET') return sendJson(response, 200, { invitation: { id: invitation.id, email: invitation.email, role: invitation.role, createdAt: invitation.createdAt, expiresAt: invitation.expiresAt, documentName: invitation.documentName, ownerName: invitation.ownerName } })
      if (method === 'POST') {
        const now = new Date().toISOString()
        database.exec('BEGIN IMMEDIATE')
        try {
          const current = database.prepare('SELECT document_invitations.id, document_invitations.document_id, document_invitations.email, document_invitations.role, document_invitations.expires_at, document_invitations.accepted_at, document_invitations.revoked_at, documents.access_suspended FROM document_invitations JOIN documents ON documents.id = document_invitations.document_id WHERE document_invitations.token_hash = ?').get(tokenHash)
          if (!current || current.revoked_at || current.accepted_at || Date.parse(current.expires_at) <= Date.now()) throw new HttpError(409, 'Este convite já foi usado, revogado ou expirou.')
          if (current.access_suspended) throw new HttpError(404, 'Este convite não está mais disponível.')
          if (current.email !== user.email) throw new HttpError(403, 'Entre com a conta convidada para continuar.')
          database.prepare('INSERT INTO document_permissions (document_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(current.document_id, user.id, current.role, now)
          database.prepare('UPDATE document_invitations SET accepted_at = ?, accepted_by = ? WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL').run(now, user.id, current.id)
          const documentTeam = database.prepare('SELECT team_id FROM documents WHERE id = ?').get(current.document_id)
          if (documentTeam?.team_id) recordAudit({ user, action: 'document.invitation.accepted', targetType: 'user', targetId: user.id, details: { role: current.role }, teamId: documentTeam.team_id, documentId: current.document_id })
          database.exec('COMMIT')
          const effectiveRole = documentAccess(current.document_id, user.id).role
          publishAccess(current.document_id, user.id, effectiveRole)
          publishDocument(current.document_id, { type: 'invitations.updated' })
          return sendJson(response, 200, { ok: true, documentId: current.document_id, role: effectiveRole })
        } catch (error) {
          try { database.exec('ROLLBACK') } catch {}
          throw error
        }
      }
      throw new HttpError(405, 'Método não permitido.')
    }

    if (path === '/api/project-folders' && method === 'GET') {
      const user = requireUser(request)
      const teamId = new URL(request.url, 'http://localhost').searchParams.get('teamId')
      if (teamId) {
        const membership = database.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, user.id)
        if (!membership) throw new HttpError(404, 'Equipe não encontrada.')
      }
      const rows = teamId
        ? database.prepare('SELECT f.id, f.name, f.created_at AS createdAt, f.updated_at AS updatedAt, EXISTS(SELECT 1 FROM project_folder_favorites x WHERE x.folder_id=f.id AND x.user_id=?) AS favorite, f.team_id AS teamId FROM project_folders f WHERE f.team_id=? ORDER BY favorite DESC, f.name COLLATE NOCASE').all(user.id, teamId)
        : database.prepare('SELECT f.id, f.name, f.created_at AS createdAt, f.updated_at AS updatedAt, EXISTS(SELECT 1 FROM project_folder_favorites x WHERE x.folder_id=f.id AND x.user_id=?) AS favorite, f.team_id AS teamId FROM project_folders f WHERE f.owner_id=? OR f.team_id IN (SELECT team_id FROM team_members WHERE user_id=?) ORDER BY favorite DESC, f.name COLLATE NOCASE').all(user.id, user.id, user.id)
      return sendJson(response, 200, { folders: rows.map(row => ({ ...row, favorite: Boolean(row.favorite) })) })
    }

    if (path === '/api/project-folders' && method === 'POST') {
      const user = requireUser(request)
      const body = await readJson(request)
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name || name.length > 100) throw new HttpError(400, 'Informe um nome de pasta com até 100 caracteres.')
      const teamId = typeof body.teamId === 'string' ? body.teamId : null
      if (teamId && !database.prepare('SELECT 1 FROM team_members WHERE team_id=? AND user_id=?').get(teamId, user.id)) throw new HttpError(404, 'Equipe não encontrada.')
      const id = randomUUID()
      const now = new Date().toISOString()
      database.prepare('INSERT INTO project_folders (id, owner_id, team_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, teamId ? null : user.id, teamId, name, now, now)
      return sendJson(response, 201, { folder: { id, name, createdAt: now, updatedAt: now, favorite: false, teamId } })
    }

    const folderMatch = path.match(/^\/api\/project-folders\/([^/]+)$/)
    if (folderMatch) {
      const user = requireUser(request)
      const folderId = decodeURIComponent(folderMatch[1])
      const folder = database.prepare('SELECT * FROM project_folders WHERE id=?').get(folderId)
      if (!folder) throw new HttpError(404, 'Pasta não encontrada.')
      const membership = folder.team_id ? database.prepare('SELECT role FROM team_members WHERE team_id=? AND user_id=?').get(folder.team_id, user.id) : null
      const canManage = folder.owner_id === user.id || Boolean(membership)
      if (method === 'GET' && canManage) {
        const favorite = Boolean(database.prepare('SELECT 1 FROM project_folder_favorites WHERE folder_id=? AND user_id=?').get(folderId, user.id))
        return sendJson(response, 200, { folder: { id: folderId, name: folder.name, createdAt: folder.created_at, updatedAt: folder.updated_at, favorite, teamId: folder.team_id } })
      }
      if (!canManage) throw new HttpError(404, 'Pasta não encontrada.')
      if (method === 'PATCH') {
        const body = await readJson(request)
        const now = new Date().toISOString()
        if (typeof body.favorite === 'boolean') {
          if (body.favorite) database.prepare('INSERT OR IGNORE INTO project_folder_favorites (folder_id,user_id) VALUES (?,?)').run(folderId, user.id)
          else database.prepare('DELETE FROM project_folder_favorites WHERE folder_id=? AND user_id=?').run(folderId, user.id)
        }
        let name = folder.name
        if (body.name !== undefined) {
          name = typeof body.name === 'string' ? body.name.trim() : ''
          if (!name || name.length > 100) throw new HttpError(400, 'Informe um nome de pasta com até 100 caracteres.')
          database.prepare('UPDATE project_folders SET name=?, updated_at=? WHERE id=?').run(name, now, folderId)
        }
        return sendJson(response, 200, { folder: { id: folderId, name, createdAt: folder.created_at, updatedAt: body.name === undefined ? folder.updated_at : now, favorite: Boolean(database.prepare('SELECT 1 FROM project_folder_favorites WHERE folder_id=? AND user_id=?').get(folderId, user.id)), teamId: folder.team_id } })
      }
      if (method === 'DELETE') {
        const documents = folder.team_id
          ? database.prepare('SELECT id, data_json FROM documents WHERE team_id=?').all(folder.team_id)
          : database.prepare('SELECT id, data_json FROM documents WHERE owner_id=? AND team_id IS NULL').all(folder.owner_id)
        if (documents.some(item => { try { return JSON.parse(item.data_json).folderId === folderId } catch { return false } })) throw new HttpError(409, 'Mova os projetos para fora antes de excluir a pasta.')
        database.prepare('DELETE FROM project_folders WHERE id=?').run(folderId)
        return sendJson(response, 200, { ok: true })
      }
      throw new HttpError(405, 'Método não permitido.')
    }

    const folderMoveMatch = path.match(/^\/api\/documents\/([^/]+)\/folder$/)
    if (folderMoveMatch && method === 'PATCH') {
      const user = requireUser(request)
      const documentId = decodeURIComponent(folderMoveMatch[1])
      const access = documentAccess(documentId, user.id)
      if (access.team_id && !database.prepare('SELECT 1 FROM team_members WHERE team_id=? AND user_id=?').get(access.team_id, user.id)) throw new HttpError(404, 'Pasta não encontrada neste local.')
      if (!['owner', 'editor'].includes(access.role)) throw new HttpError(403, 'Seu acesso permite visualizar ou comentar, mas não mover este projeto.')
      if (!access.team_id && access.owner_id !== user.id) throw new HttpError(403, 'Somente quem possui o projeto pode organizá-lo em uma pasta pessoal.')
      const body = await readJson(request)
      if (!Number.isInteger(body.revision) || body.revision !== access.revision) throw new HttpError(409, 'O projeto mudou. Atualize a lista antes de movê-lo.', { revision: access.revision })
      const folderId = body.folderId === null ? null : typeof body.folderId === 'string' ? body.folderId : undefined
      if (folderId === undefined) throw new HttpError(400, 'Informe uma pasta ou null para remover a pasta.')
      if (folderId) {
        const folder = database.prepare('SELECT owner_id, team_id FROM project_folders WHERE id=?').get(folderId)
        if (!folder || (access.team_id ? folder.team_id !== access.team_id : (folder.team_id !== null || folder.owner_id !== user.id))) throw new HttpError(404, 'Pasta não encontrada neste local.')
        if (folder.team_id && !database.prepare('SELECT 1 FROM team_members WHERE team_id=? AND user_id=?').get(folder.team_id, user.id)) throw new HttpError(404, 'Pasta não encontrada neste local.')
      }
      const data = JSON.parse(access.data_json)
      if (folderId) data.folderId = folderId
      else delete data.folderId
      const nextRevision = access.revision + 1
      const now = new Date().toISOString()
      database.prepare('UPDATE documents SET data_json=?, revision=?, updated_at=? WHERE id=? AND revision=?').run(JSON.stringify(data), nextRevision, now, documentId, access.revision)
      database.prepare('INSERT INTO document_versions (document_id,revision,name,data_json,created_at,created_by) VALUES (?,?,?,?,?,?)').run(documentId, nextRevision, access.name, JSON.stringify(data), now, user.id)
      if (access.team_id) recordAudit({ user, action: 'document.folder.moved', targetType: 'document', targetId: documentId, details: { folderId }, teamId: access.team_id, documentId })
      publishDocument(documentId, { type: 'document.updated', revision: nextRevision })
      return sendJson(response, 200, serializeDocument(documentAccess(documentId, user.id)))
    }

    if (path === '/api/documents' && method === 'GET') {
      const user = requireUser(request)
      const rows = database.prepare(`
        SELECT documents.id, documents.owner_id, documents.team_id, documents.name, documents.data_json, documents.revision, documents.access_suspended, documents.created_at, documents.updated_at,
               CASE WHEN documents.owner_id = ? OR team_membership.team_role = 'admin' THEN 'owner'
                    WHEN team_membership.team_role = 'member' THEN 'editor'
                    WHEN documents.team_id IS NOT NULL THEN document_permissions.role
                    ELSE document_permissions.role END AS role
        FROM documents LEFT JOIN document_permissions ON document_permissions.document_id = documents.id AND document_permissions.user_id = ?
        LEFT JOIN (SELECT team_id, user_id, role AS team_role FROM team_members) AS team_membership ON team_membership.team_id = documents.team_id AND team_membership.user_id = ?
        WHERE (documents.owner_id = ? OR document_permissions.user_id = ? OR team_membership.user_id = ?)
          AND (documents.access_suspended = 0 OR documents.owner_id = ? OR team_membership.team_role = 'admin')
        ORDER BY documents.updated_at DESC
      `).all(user.id, user.id, user.id, user.id, user.id, user.id, user.id)
      return sendJson(response, 200, { documents: rows.map(serializeDocument) })
    }

    if (path === '/api/documents' && method === 'POST') {
      const user = requireUser(request)
      const body = await readJson(request)
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (name.length < 1 || name.length > 160) throw new HttpError(400, 'Informe um título com até 160 caracteres.')
      if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new HttpError(400, 'Inclua os dados do documento.')
      if (!hasSafeSiteLinks(body.data)) throw new HttpError(400, 'O site contém um link inválido.')
      const id = randomUUID()
      const now = new Date().toISOString()
      const teamId = typeof body.teamId === 'string' ? body.teamId : null
      if (teamId) {
        const membership = database.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, user.id)
        if (!membership) throw new HttpError(404, 'Equipe não encontrada.')
      }
      database.prepare('INSERT INTO documents (id, owner_id, team_id, name, data_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
        .run(id, user.id, teamId, name, JSON.stringify(body.data), now, now)
      database.prepare('INSERT INTO document_versions (document_id, revision, name, data_json, created_at, created_by) VALUES (?, 1, ?, ?, ?, ?)')
        .run(id, name, JSON.stringify(body.data), now, user.id)
      if (teamId) recordAudit({ user, action: 'document.created', targetType: 'document', targetId: id, details: { name }, teamId, documentId: id })
      return sendJson(response, 201, serializeDocument(documentAccess(id, user.id)))
    }

    if (path === '/api/documents/trash' && method === 'DELETE') {
      const user = requireUser(request)
      const body = await readJson(request)
      const requested = body.documents
      if (!Array.isArray(requested) || requested.length < 1 || requested.length > 1000
        || requested.some(item => !item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string' || item.id.length < 1 || item.id.length > 100 || !Number.isInteger(item.revision) || item.revision < 1)) {
        throw new HttpError(400, 'Informe entre 1 e 1000 projetos da lixeira com suas revisões atuais.')
      }
      const uniqueIds = new Set(requested.map(item => item.id))
      if (uniqueIds.size !== requested.length) throw new HttpError(400, 'A lista contém projetos duplicados.')
      const targets = []
      database.exec('BEGIN IMMEDIATE')
      try {
        for (const item of requested) {
          const access = documentAccess(item.id, user.id)
          if (access.role !== 'owner') throw new HttpError(403, 'Somente quem administra cada projeto pode esvaziar a lixeira.')
          const data = JSON.parse(access.data_json)
          if (!data.trashedAt) throw new HttpError(409, 'Todos os projetos precisam estar na lixeira antes de esvaziá-la.')
          if (item.revision !== access.revision) throw new HttpError(409, 'Um projeto mudou. Atualize a lixeira antes de esvaziá-la.', { documentId: item.id, current: serializeDocument(access) })
          const objectKeys = database.prepare('SELECT object_key FROM document_media WHERE document_id = ? AND object_key IS NOT NULL').all(item.id).map(row => row.object_key)
          targets.push({ id: item.id, revision: item.revision, name: access.name, teamId: access.team_id, objectKeys })
        }
        for (const target of targets) {
          if (target.teamId) recordAudit({ user, action: 'document.deleted', targetType: 'document', targetId: target.id, details: { name: target.name, revision: target.revision }, teamId: target.teamId })
          const result = database.prepare('DELETE FROM documents WHERE id = ? AND revision = ?').run(target.id, target.revision)
          if (result.changes !== 1) throw new HttpError(409, 'Um projeto mudou durante a exclusão. Atualize a lixeira e tente novamente.', { documentId: target.id })
        }
        database.exec('COMMIT')
      } catch (error) {
        try { database.exec('ROLLBACK') } catch {}
        throw error
      }
      for (const objectKey of new Set(targets.flatMap(target => target.objectKeys))) removeUnreferencedMediaObject(objectKey)
      for (const target of targets) {
        for (const subscriber of [...(documentSubscribers.get(target.id) ?? [])]) {
          sendEvent(subscriber, { type: 'document.deleted' })
          removeSubscriber(target.id, subscriber)
          subscriber.response.end()
        }
        documentEventHistory.delete(target.id)
        activePresentations.delete(target.id)
      }
      return sendJson(response, 200, { ok: true, deleted: targets.length })
    }

    const match = path.match(/^\/api\/documents\/([^/]+)(?:\/(permissions(?:\/([^/]+))?|collaborators|comments(?:\/([^/]+))?|invitations(?:\/([^/]+))?|media(?:\/[^/]+)?|versions(?:\/\d+\/(?:restore|copy))?|access|operations|events|cursor|selection|presentation))?$/)
    if (match) {
      const documentId = decodeURIComponent(match[1])
      const routeResource = match[2] ?? ''
      const subresource = routeResource.startsWith('comments') ? 'comments' : routeResource.startsWith('invitations') ? 'invitations' : routeResource.startsWith('media') ? 'media' : routeResource.startsWith('versions') ? 'versions' : routeResource
      const permissionUserId = match[3] ? decodeURIComponent(match[3]) : ''
      const commentId = match[4] ? decodeURIComponent(match[4]) : ''
      const invitationId = subresource === 'invitations' && match[5] ? decodeURIComponent(match[5]) : ''
      if (subresource === 'invitations' && match[5]) match[2] = `${match[2].split('/')[0]}/${match[5]}`
      const mediaId = routeResource.startsWith('media/') ? decodeURIComponent(routeResource.slice('media/'.length)) : ''
      const restoreVersion = routeResource.match(/^versions\/(\d+)\/restore$/)
      const copyVersion = routeResource.match(/^versions\/(\d+)\/copy$/)
      const user = requireUser(request)
      const access = documentAccess(documentId, user.id)

      if (subresource === 'collaborators' && method === 'GET') {
        const rows = database.prepare(`SELECT u.id, u.name, u.email,
          CASE WHEN u.id = d.owner_id OR tm.role = 'admin' THEN 'owner' WHEN tm.role = 'member' THEN 'editor' ELSE p.role END AS role
          FROM documents d JOIN users u ON (u.id = d.owner_id OR EXISTS (SELECT 1 FROM document_permissions p2 WHERE p2.document_id = d.id AND p2.user_id = u.id) OR EXISTS (SELECT 1 FROM team_members tm2 WHERE tm2.team_id = d.team_id AND tm2.user_id = u.id))
          LEFT JOIN document_permissions p ON p.document_id = d.id AND p.user_id = u.id
          LEFT JOIN team_members tm ON tm.team_id = d.team_id AND tm.user_id = u.id
          WHERE d.id = ? ORDER BY u.name`).all(documentId)
        const mayMention = ['owner', 'editor', 'commenter'].includes(access.role)
        return sendJson(response, 200, { collaborators: rows.map(({ id, name, email, role }) => ({ id, name, role, ...(mayMention && ['owner', 'editor', 'commenter'].includes(role) ? { email } : {}) })) })
      }

      if (subresource === 'access' && method === 'GET') {
        if (access.role !== 'owner') throw new HttpError(403, 'Somente quem administra este projeto pode ver as configurações de acesso.')
        const activeLink = database.prepare('SELECT id FROM document_public_links WHERE document_id = ? AND revoked_at IS NULL').get(documentId)
        return sendJson(response, 200, { accessSuspended: Boolean(access.access_suspended), publicLinkEnabled: Boolean(activeLink) })
      }

      if (subresource === 'access' && method === 'PATCH') {
        if (access.role !== 'owner') throw new HttpError(403, 'Somente quem administra este projeto pode alterar as configurações de acesso.')
        const body = await readJson(request)
        if (typeof body.suspended === 'boolean') {
          database.prepare('UPDATE documents SET access_suspended = ? WHERE id = ?').run(body.suspended ? 1 : 0, documentId)
          if (body.suspended) {
            for (const subscriber of [...(documentSubscribers.get(documentId) ?? [])]) {
              try {
                if (documentAccess(documentId, subscriber.userId).role !== 'owner') revokeSubscriber(documentId, subscriber.userId)
              } catch { revokeSubscriber(documentId, subscriber.userId) }
            }
          }
          if (access.team_id) recordAudit({ user, action: body.suspended ? 'document.access.suspended' : 'document.access.resumed', targetType: 'document', targetId: documentId, teamId: access.team_id, documentId })
          return sendJson(response, 200, { accessSuspended: body.suspended })
        }
        if (!['enable', 'rotate', 'revoke'].includes(body.publicLink)) throw new HttpError(400, 'Escolha criar, renovar ou revogar o link público.')
        if (body.publicLink !== 'revoke' && JSON.parse(access.data_json).trashedAt) throw new HttpError(409, 'Restaure o projeto da lixeira antes de ativar um link público.')
        const now = new Date().toISOString()
        let token = null
        database.exec('BEGIN IMMEDIATE')
        try {
          const existing = database.prepare('SELECT id FROM document_public_links WHERE document_id = ? AND revoked_at IS NULL').get(documentId)
          if (body.publicLink === 'revoke') {
            if (existing) database.prepare('UPDATE document_public_links SET revoked_at = ? WHERE id = ?').run(now, existing.id)
          } else if (body.publicLink === 'rotate' || !existing) {
            database.prepare('UPDATE document_public_links SET revoked_at = ? WHERE document_id = ? AND revoked_at IS NULL').run(now, documentId)
            token = randomBytes(32).toString('base64url')
            database.prepare('INSERT INTO document_public_links (id, document_id, token_hash, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
              .run(randomUUID(), documentId, hashToken(token), now, user.id)
          }
          database.exec('COMMIT')
        } catch (error) { try { database.exec('ROLLBACK') } catch {}; throw error }
        const publicLinkEnabled = Boolean(database.prepare('SELECT id FROM document_public_links WHERE document_id = ? AND revoked_at IS NULL').get(documentId))
        if (access.team_id) recordAudit({ user, action: body.publicLink === 'revoke' ? 'document.public_link.revoked' : token ? 'document.public_link.created' : 'document.public_link.confirmed', targetType: 'document', targetId: documentId, teamId: access.team_id, documentId })
        return sendJson(response, 200, { publicLinkEnabled, ...(token ? { token } : {}) })
      }

      if (!subresource && method === 'DELETE') {
        if (access.role !== 'owner') throw new HttpError(403, 'Somente quem administra este projeto pode excluí-lo permanentemente.')
        const body = await readJson(request)
        if (!Number.isInteger(body.revision) || body.revision < 1) throw new HttpError(400, 'Informe a revisão atual do projeto.')
        const data = JSON.parse(access.data_json)
        if (!data.trashedAt) throw new HttpError(409, 'Mova o projeto para a lixeira antes de excluí-lo permanentemente.')
        if (body.revision !== access.revision) throw new HttpError(409, 'O projeto mudou. Atualize a lixeira antes de excluí-lo.', { current: serializeDocument(access) })
        const objectKeys = database.prepare('SELECT object_key FROM document_media WHERE document_id = ? AND object_key IS NOT NULL').all(documentId).map(row => row.object_key)
        database.exec('BEGIN IMMEDIATE')
        try {
          const latest = documentAccess(documentId, user.id)
          const latestData = JSON.parse(latest.data_json)
          if (latest.role !== 'owner') throw new HttpError(403, 'Somente quem administra este projeto pode excluí-lo permanentemente.')
          if (!latestData.trashedAt) throw new HttpError(409, 'Mova o projeto para a lixeira antes de excluí-lo permanentemente.')
          if (latest.revision !== body.revision) throw new HttpError(409, 'O projeto mudou. Atualize a lixeira antes de excluí-lo.', { current: serializeDocument(latest) })
          if (latest.team_id) recordAudit({ user, action: 'document.deleted', targetType: 'document', targetId: documentId, details: { name: latest.name, revision: latest.revision }, teamId: latest.team_id })
          const result = database.prepare('DELETE FROM documents WHERE id = ? AND revision = ?').run(documentId, body.revision)
          if (result.changes !== 1) throw new HttpError(409, 'O projeto mudou. Atualize a lixeira antes de excluí-lo.')
          database.exec('COMMIT')
        } catch (error) {
          try { database.exec('ROLLBACK') } catch {}
          throw error
        }
        for (const objectKey of objectKeys) removeUnreferencedMediaObject(objectKey)
        for (const subscriber of [...(documentSubscribers.get(documentId) ?? [])]) {
          sendEvent(subscriber, { type: 'document.deleted' })
          removeSubscriber(documentId, subscriber)
          subscriber.response.end()
        }
        documentEventHistory.delete(documentId)
        activePresentations.delete(documentId)
        return sendJson(response, 200, { ok: true })
      }

      if (subresource === 'versions' && method === 'GET' && !restoreVersion) {
        const versions = database.prepare(`SELECT document_versions.revision, document_versions.name, document_versions.created_at AS createdAt, document_versions.created_by AS createdBy, users.name AS createdByName FROM document_versions LEFT JOIN users ON users.id = document_versions.created_by WHERE document_versions.document_id = ? ORDER BY document_versions.revision DESC LIMIT 100`).all(documentId)
        return sendJson(response, 200, { versions, currentRevision: access.revision })
      }

      if (subresource === 'versions' && method === 'POST' && restoreVersion) {
        if (!['owner', 'editor'].includes(access.role)) throw new HttpError(403, 'Seu acesso permite consultar o histórico, mas não restaurar versões.')
        const body = await readJson(request)
        if (!Number.isInteger(body.revision) || body.revision !== access.revision) throw new HttpError(409, 'O documento mudou. Atualize antes de restaurar uma versão.', { current: serializeDocument(access) })
        const targetRevision = Number(restoreVersion[1])
        const target = database.prepare('SELECT name, data_json FROM document_versions WHERE document_id = ? AND revision = ?').get(documentId, targetRevision)
        if (!target) throw new HttpError(404, 'Esta versão não está mais disponível.')
        const nextRevision = access.revision + 1
        const restoredAt = new Date().toISOString()
        database.exec('BEGIN IMMEDIATE')
        try {
          const saved = database.prepare('UPDATE documents SET name = ?, data_json = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?')
            .run(target.name, target.data_json, nextRevision, restoredAt, documentId, access.revision)
          if (!saved.changes) throw new HttpError(409, 'O documento mudou durante a restauração.')
          database.prepare('INSERT INTO document_versions (document_id, revision, name, data_json, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
            .run(documentId, nextRevision, target.name, target.data_json, restoredAt, user.id)
          database.prepare('DELETE FROM document_versions WHERE document_id = ? AND revision <= ?').run(documentId, nextRevision - 100)
          database.exec('COMMIT')
        } catch (error) {
          try { database.exec('ROLLBACK') } catch {}
          throw error
        }
        const restored = serializeDocument(documentAccess(documentId, user.id))
        if (access.team_id) recordAudit({ user, action: 'document.version.restored', targetType: 'document', targetId: documentId, details: { sourceRevision: targetRevision, revision: nextRevision }, teamId: access.team_id, documentId })
        publishDocument(documentId, { type: 'document.updated', revision: nextRevision })
        return sendJson(response, 200, { document: restored, sourceRevision: targetRevision })
      }

      if (subresource === 'versions' && method === 'POST' && copyVersion) {
        const targetRevision = Number(copyVersion[1])
        const target = database.prepare('SELECT name, data_json FROM document_versions WHERE document_id = ? AND revision = ?').get(documentId, targetRevision)
        if (!target) throw new HttpError(404, 'Esta versão não está mais disponível.')
        const sourceData = JSON.parse(target.data_json)
        const copyId = randomUUID()
        const createdAt = new Date().toISOString()
          const prefix = 'Cópia de '
          const copyName = `${prefix}${target.name.slice(0, Math.max(1, 160 - prefix.length))}`
          sourceData.id = copyId
          sourceData.name = copyName
        sourceData.updatedAt = createdAt
        const copyJson = JSON.stringify(sourceData)
        database.exec('BEGIN IMMEDIATE')
        try {
          database.prepare('INSERT INTO documents (id, owner_id, team_id, name, data_json, revision, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, 1, ?, ?)')
            .run(copyId, user.id, copyName, copyJson, createdAt, createdAt)
          database.prepare('INSERT INTO document_versions (document_id, revision, name, data_json, created_at, created_by) VALUES (?, 1, ?, ?, ?, ?)')
            .run(copyId, copyName, copyJson, createdAt, user.id)
          const assetIds = [...new Set((sourceData.pages ?? []).flatMap(page => (page.elements ?? []).filter(element => element?.type === 'image' && typeof element.assetId === 'string').map(element => element.assetId)))]
          const findAsset = database.prepare('SELECT asset_id, name, mime_type, width, height, src, object_key, fingerprint, created_at FROM document_media WHERE document_id = ? AND asset_id = ?')
          const insertAsset = database.prepare('INSERT INTO document_media (document_id, asset_id, created_by, name, mime_type, width, height, src, object_key, fingerprint, library_visible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)')
          for (const assetId of assetIds) {
            const asset = findAsset.get(documentId, assetId)
            if (asset) insertAsset.run(copyId, asset.asset_id, user.id, asset.name, asset.mime_type, asset.width, asset.height, asset.src, asset.object_key, asset.fingerprint, createdAt)
          }
          database.exec('COMMIT')
        } catch (error) {
          try { database.exec('ROLLBACK') } catch {}
          throw error
        }
        return sendJson(response, 201, serializeDocument(documentAccess(copyId, user.id)))
      }

      if (subresource === 'media' && method === 'GET') {
        const rows = database.prepare('SELECT asset_id, name, mime_type, width, height, src, object_key, fingerprint, library_visible, created_at FROM document_media WHERE document_id = ? ORDER BY created_at DESC').all(documentId)
        const referenced = new Set()
        if (url.searchParams.get('includeReferenced') === '1') {
          const collectReferences = data => { for (const page of data.pages ?? []) { for (const element of page.elements ?? []) if (element?.type === 'image' && element.assetId) referenced.add(element.assetId); for (const clip of page.timelineClips ?? []) if (clip.assetId) referenced.add(clip.assetId) } }
          collectReferences(JSON.parse(access.data_json))
          for (const version of database.prepare('SELECT data_json FROM document_versions WHERE document_id = ?').all(documentId)) collectReferences(JSON.parse(version.data_json))
        }
        const visibleRows = rows.filter(row => row.library_visible === 1 || referenced.has(row.asset_id))
        return sendJson(response, 200, { assets: visibleRows.map(row => ({ id: row.asset_id, name: row.name, mimeType: row.mime_type, width: row.width, height: row.height, src: readMediaSource(row), fingerprint: row.fingerprint ?? undefined, libraryVisible: row.library_visible, createdAt: row.created_at })) })
      }

      if (subresource === 'media' && method === 'POST') {
        if (!['owner', 'editor'].includes(access.role)) throw new HttpError(403, 'Seu acesso permite visualizar a biblioteca, mas não enviar mídias.')
        const body = await readJson(request)
        const asset = body.asset
        const validAsset = asset && typeof asset === 'object' && !Array.isArray(asset)
          && typeof asset.id === 'string' && asset.id.length > 0 && asset.id.length <= 100
          && typeof asset.name === 'string' && asset.name.trim().length > 0 && asset.name.length <= 256
          && typeof asset.mimeType === 'string' && /^(?:image\/[a-z0-9][a-z0-9.+-]*|video\/(?:mp4|webm|quicktime)|audio\/(?:mpeg|mp4|ogg|wav|webm|flac|aac))$/i.test(asset.mimeType)
          && Number.isInteger(asset.width) && asset.width > 0 && Number.isInteger(asset.height) && asset.height > 0 && (asset.mimeType.startsWith('audio/') ? asset.width === 1 && asset.height === 1 : asset.width * asset.height <= 32_000_000)
          && typeof asset.src === 'string' && asset.src.length <= 14_000_000 && asset.src.startsWith(`data:${asset.mimeType};base64,`)
          && (asset.fingerprint === undefined || typeof asset.fingerprint === 'string' && /^[a-f0-9]{64}$/i.test(asset.fingerprint))
          && (asset.createdAt === undefined || typeof asset.createdAt === 'string' && asset.createdAt.length <= 40)
        if (!validAsset) throw new HttpError(400, 'Mídia inválida ou acima dos limites suportados.')
        const duplicate = asset.fingerprint ? database.prepare('SELECT asset_id, name, mime_type, width, height, src, object_key, fingerprint, library_visible, created_at FROM document_media WHERE document_id = ? AND fingerprint = ?').get(documentId, asset.fingerprint) : null
        if (duplicate) {
          database.prepare('UPDATE document_media SET library_visible = 1 WHERE document_id = ? AND asset_id = ?').run(documentId, duplicate.asset_id)
          return sendJson(response, 200, { asset: { id: duplicate.asset_id, name: duplicate.name, mimeType: duplicate.mime_type, width: duplicate.width, height: duplicate.height, src: readMediaSource(duplicate), fingerprint: duplicate.fingerprint ?? undefined, libraryVisible: 1, createdAt: duplicate.created_at } })
        }
        const createdAt = asset.createdAt || new Date().toISOString()
        const stored = storeMediaSource(asset.src)
        try {
          database.prepare('INSERT INTO document_media (document_id, asset_id, created_by, name, mime_type, width, height, src, object_key, fingerprint, library_visible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)')
            .run(documentId, asset.id, user.id, asset.name.trim(), asset.mimeType, asset.width, asset.height, stored.src, stored.objectKey, asset.fingerprint ?? null, createdAt)
        } catch (error) {
          if (String(error?.message ?? '').includes('UNIQUE')) throw new HttpError(409, 'Esta mídia já existe na biblioteca compartilhada.')
          throw error
        }
        return sendJson(response, 201, { asset: { ...asset, name: asset.name.trim(), libraryVisible: 1, createdAt } })
      }

      if (subresource === 'media' && mediaId && method === 'DELETE') {
        if (!['owner', 'editor'].includes(access.role)) throw new HttpError(403, 'Seu acesso permite visualizar a biblioteca, mas não remover mídias.')
        const asset = database.prepare('SELECT object_key FROM document_media WHERE document_id = ? AND asset_id = ?').get(documentId, mediaId)
        if (!asset) throw new HttpError(404, 'Mídia não encontrada.')
        const currentDocument = JSON.parse(access.data_json)
        const currentReference = (currentDocument.pages ?? []).some(page => (page.elements ?? []).some(element => element?.type === 'image' && element.assetId === mediaId) || (page.timelineClips ?? []).some(clip => clip.assetId === mediaId))
        const historicalReference = database.prepare('SELECT data_json FROM document_versions WHERE document_id = ?').all(documentId)
          .some(version => (JSON.parse(version.data_json).pages ?? []).some(page => (page.elements ?? []).some(element => element?.type === 'image' && element.assetId === mediaId) || (page.timelineClips ?? []).some(clip => clip.assetId === mediaId)))
        const isReferenced = currentReference || historicalReference
        const result = isReferenced
          ? database.prepare('UPDATE document_media SET library_visible = 0 WHERE document_id = ? AND asset_id = ?').run(documentId, mediaId)
          : database.prepare('DELETE FROM document_media WHERE document_id = ? AND asset_id = ?').run(documentId, mediaId)
        if (!result.changes) throw new HttpError(404, 'Mídia não encontrada.')
        if (!isReferenced) removeUnreferencedMediaObject(asset.object_key)
        return sendJson(response, 200, { ok: true, retained: isReferenced })
      }

      if (subresource === 'events' && method === 'GET') return subscribeDocument(request, response, documentId, user)

      if (subresource === 'cursor' && method === 'POST') {
        const body = await readJson(request)
        if (body.cursor === null) {
          publishDocument(documentId, { type: 'cursor.updated', userId: user.id, cursor: null })
          return sendJson(response, 200, { ok: true })
        }
        const cursor = body.cursor
        if (!cursor || typeof cursor !== 'object' || typeof cursor.pageId !== 'string' || cursor.pageId.length < 1 || cursor.pageId.length > 100
          || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y) || cursor.x < 0 || cursor.x > 1 || cursor.y < 0 || cursor.y > 1) {
          throw new HttpError(400, 'A posi\u00e7\u00e3o do ponteiro \u00e9 inv\u00e1lida.')
        }
        publishDocument(documentId, { type: 'cursor.updated', userId: user.id, cursor: { pageId: cursor.pageId, x: cursor.x, y: cursor.y }, name: user.name })
        return sendJson(response, 200, { ok: true })
      }

      if (subresource === 'selection' && method === 'POST') {
        const body = await readJson(request)
        if (body.selection === null) {
          publishDocument(documentId, { type: 'selection.updated', userId: user.id, selection: null })
          return sendJson(response, 200, { ok: true })
        }
        const selection = body.selection
        const kind = selection?.kind ?? 'element'
        if (!selection || typeof selection !== 'object' || typeof selection.pageId !== 'string' || selection.pageId.length < 1 || selection.pageId.length > 100
          || typeof selection.elementId !== 'string' || selection.elementId.length < 1 || selection.elementId.length > 100
          || !['element', 'doc-block', 'table-cell'].includes(kind)) {
          throw new HttpError(400, 'A sele\u00e7\u00e3o compartilhada \u00e9 inv\u00e1lida.')
        }
        const data = JSON.parse(access.data_json)
        const page = Array.isArray(data.pages) ? data.pages.find(item => item?.id === selection.pageId) : null
        let exists = false
        if (kind === 'element') exists = Array.isArray(page?.elements) && page.elements.some(element => element?.id === selection.elementId)
        if (kind === 'doc-block') exists = Array.isArray(page?.blocks) && page.blocks.some(block => block?.id === selection.elementId)
        if (kind === 'table-cell') {
          const block = Array.isArray(page?.blocks) ? page.blocks.find(item => item?.id === selection.elementId && item.type === 'table') : null
          exists = Number.isInteger(selection.row) && Number.isInteger(selection.column)
            && selection.row >= 0 && selection.row < (block?.cells?.length ?? 0)
            && selection.column >= 0 && selection.column < (block?.cells?.[selection.row]?.length ?? 0)
        }
        if (!exists) throw new HttpError(404, 'O elemento selecionado n\u00e3o existe neste documento.')
        const normalized = kind === 'table-cell'
          ? { pageId: selection.pageId, elementId: selection.elementId, kind, row: selection.row, column: selection.column }
          : { pageId: selection.pageId, elementId: selection.elementId, kind }
        publishDocument(documentId, { type: 'selection.updated', userId: user.id, selection: normalized, name: user.name })
        return sendJson(response, 200, { ok: true })
      }

      if (subresource === 'operations' && method === 'POST') {
        if (!['owner', 'editor'].includes(access.role)) throw new HttpError(403, 'Seu acesso permite visualizar ou comentar, mas não editar células.')
        const body = await readJson(request)
        const operationId = typeof body.operationId === 'string' && body.operationId.length <= 100 ? body.operationId : ''
        const pageId = typeof body.pageId === 'string' && body.pageId.length <= 100 ? body.pageId : ''
        const cells = body.cells
        const formats = body.formats
        const blockId = typeof body.blockId === 'string' && body.blockId.length <= 100 ? body.blockId : ''
        const elementId = typeof body.elementId === 'string' && body.elementId.length <= 100 ? body.elementId : ''
        const validCell = cell => cell && Number.isInteger(cell.row) && cell.row >= 0 && cell.row < 1000 && Number.isInteger(cell.column) && cell.column >= 0 && cell.column < 200
        const validMarks = validDocInlineMarks
        const validDocCellImages = block => {
          if (block.cellImages === undefined) return true
          if (block.type !== 'table' || !block.cellImages || typeof block.cellImages !== 'object' || Array.isArray(block.cellImages) || Object.keys(block.cellImages).length > 200_000) return false
          let imageCount = 0
          return Object.entries(block.cellImages).every(([coordinate, images]) => {
            const match = /^(\d+):(\d+)$/.exec(coordinate)
            if (!match || block.cells?.[Number(match[1])]?.[Number(match[2])] === undefined || !Array.isArray(images) || images.length === 0) return false
            imageCount += images.length
            return imageCount <= 100 && images.every(validDocImage)
          })
        }
        const validDocBlock = block => {
          const blockKeys = ['id', 'type', 'text', 'marks', 'image', 'cells', 'cellImages', 'merges', 'cellPadding', 'tableSpacing', 'borderColor', 'borderWidth', 'cellBorders']
          if (!block || typeof block !== 'object' || Object.keys(block).some(key => !blockKeys.includes(key)) || typeof block.id !== 'string' || !block.id.length || block.id.length > 100
            || !['paragraph', 'heading', 'subheading', 'quote', 'bullet', 'table', 'image'].includes(block.type) || typeof block.text !== 'string' || block.text.length > 100_000) return false
          if (block.type === 'image' ? block.text !== '' || !validDocImage(block.image) : block.image !== undefined) return false
          if (block.marks !== undefined && !validMarks(block.marks, block.text)) return false
          if (block.type === 'table' && (!Array.isArray(block.cells) || block.cells.length > 1000 || block.cells.some(row => !Array.isArray(row) || row.length > 200 || row.some(cell => typeof cell !== 'string' || cell.length > 10_000)))) return false
          if (!validDocCellImages(block)) return false
          if (block.merges !== undefined && (!Array.isArray(block.merges) || block.merges.some(merge => !validCell(merge) || !Number.isInteger(merge.colSpan) || merge.colSpan < 1 || !Number.isInteger(merge.rowSpan ?? 1) || (merge.rowSpan ?? 1) < 1 || merge.colSpan + (merge.rowSpan ?? 1) < 3 || merge.column + merge.colSpan > 200 || merge.row + (merge.rowSpan ?? 1) > (block.cells?.length ?? 0)))) return false
          if (block.cellPadding !== undefined && (!Number.isFinite(block.cellPadding) || block.cellPadding < 0 || block.cellPadding > 32)) return false
          if (block.tableSpacing !== undefined && (!Number.isFinite(block.tableSpacing) || block.tableSpacing < 0 || block.tableSpacing > 32)) return false
          if (block.borderWidth !== undefined && (!Number.isFinite(block.borderWidth) || block.borderWidth < 0 || block.borderWidth > 16)) return false
          if (block.borderColor !== undefined && (typeof block.borderColor !== 'string' || block.borderColor.length > 256)) return false
          if (block.cellBorders !== undefined) {
            if (!block.cellBorders || typeof block.cellBorders !== 'object' || Array.isArray(block.cellBorders) || Object.keys(block.cellBorders).length > 200_000) return false
            for (const [coordinate, edges] of Object.entries(block.cellBorders)) {
              const match = /^(\d+):(\d+)$/.exec(coordinate)
              if (!match || block.cells?.[Number(match[1])]?.[Number(match[2])] === undefined || !edges || typeof edges !== 'object' || Array.isArray(edges)
                || Object.keys(edges).length === 0 || Object.keys(edges).some(edge => !['top', 'right', 'bottom', 'left'].includes(edge))) return false
              for (const border of Object.values(edges)) {
                if (!border || typeof border !== 'object' || Array.isArray(border) || Object.keys(border).some(key => !['style', 'width'].includes(key))
                  || !['none', 'solid', 'long-dashes', 'dots', 'dashes'].includes(border.style) || !Number.isFinite(border.width) || border.width < 0 || border.width > 16) return false
              }
            }
          }
          return true
        }
        const docBlockImageByteLength = block => (block?.type === 'image' ? docImageByteLength(block.image) : 0) + Object.values(block?.cellImages ?? {}).flat().reduce((total, image) => total + docImageByteLength(image), 0)
        const withinDocImageLimit = blocks => blocks.reduce((total, block) => total + docBlockImageByteLength(block), 0) <= MAX_DOC_IMAGE_TOTAL_BYTES
        const validDesignPatch = patch => {
          if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return false
          const entries = Object.entries(patch)
          if (entries.length === 0 || entries.length > 20) return false
          return entries.every(([key, value]) => {
            if (!['x', 'y', 'width', 'height', 'rotation', 'fontSize', 'strokeWidth', 'cornerRadius', 'brightness', 'contrast', 'saturation', 'sourceWidth', 'sourceHeight', 'startMs', 'durationMs'].includes(key)
              && !['name', 'text', 'fontFamily', 'color', 'fill', 'shape', 'bold', 'startArrow', 'endArrow', 'curveOffset', 'points', 'opacity', 'flipX', 'flipY', 'src', 'assetId', 'href', 'crop', 'filterPreset', 'maskStrokes', 'animation'].includes(key)) return false
            if (key === 'crop') return value === null || isValidImageCrop(value, patch.sourceWidth, patch.sourceHeight)
            if (key === 'curveOffset') return value === null || typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 10_000
            if (key === 'startMs' || key === 'durationMs') return Number.isInteger(value) && value >= (key === 'durationMs' ? 1 : 0) && value <= 86_400_000
            if (['x', 'y', 'width', 'height', 'rotation', 'fontSize', 'strokeWidth', 'cornerRadius', 'sourceWidth', 'sourceHeight'].includes(key)) return typeof value === 'number' && Number.isFinite(value)
              && (key === 'width' || key === 'height' ? value > 0 && value <= 100_000 : key === 'cornerRadius' || key === 'strokeWidth' || key === 'fontSize' ? value >= 0 && value <= 10_000 : Math.abs(value) <= 1_000_000)
            if (key === 'bold') return typeof value === 'boolean'
            if (key === 'startArrow' || key === 'endArrow') return typeof value === 'boolean'
            if (key === 'opacity') return Number.isInteger(value) && value >= 0 && value <= 100
            if (key === 'brightness') return Number.isInteger(value) && value >= -100 && value <= 100
            if (key === 'contrast' || key === 'saturation') return Number.isInteger(value) && value >= -100 && value <= 100
            if (key === 'filterPreset') return value === undefined || ['soft', 'vintage', 'mono', 'color-pop', 'duotone'].includes(value)
            if (key === 'maskStrokes') return isValidImageMaskStrokes(value)
            if (key === 'animation') return isValidImageAnimation(value)
            if (key === 'flipX' || key === 'flipY') return typeof value === 'boolean'
          if (key === 'src') return typeof value === 'string' && value.length <= 14_000_000
            if (key === 'assetId') return typeof value === 'string' && value.length <= 100
            if (key === 'href') return isSafeSiteHref(value)
            if (key === 'shape') return ['rect', 'ellipse', 'triangle', 'star', 'hexagon', 'line', 'arrow', 'speech-bubble'].includes(value)
            if (key === 'points') return Array.isArray(value) && value.length >= 2 && value.length <= 40_000 && value.length % 2 === 0 && value.every(point => typeof point === 'number' && Number.isFinite(point) && Math.abs(point) <= 100_000)
            return typeof value === 'string' && value.length <= (key === 'text' ? 100_000 : 256)
          })
        }
        const isValidImageCrop = (crop, sourceWidth, sourceHeight) => crop && typeof crop === 'object' && !Array.isArray(crop)
          && ['x', 'y', 'width', 'height'].every(key => Number.isInteger(crop[key]))
          && crop.x >= 0 && crop.y >= 0 && crop.width > 0 && crop.height > 0
          && Number.isInteger(sourceWidth) && Number.isInteger(sourceHeight) && sourceWidth > 0 && sourceHeight > 0
          && crop.x + crop.width <= sourceWidth && crop.y + crop.height <= sourceHeight
        const isValidImageMaskStrokes = value => Array.isArray(value) && value.length <= 100 && value.every(stroke => stroke && typeof stroke === 'object'
          && (stroke.mode === 'erase' || stroke.mode === 'restore') && Number.isFinite(stroke.size) && stroke.size >= .0025 && stroke.size <= .5
          && Array.isArray(stroke.points) && stroke.points.length >= 2 && stroke.points.length <= 2_000 && stroke.points.length % 2 === 0
          && stroke.points.every(point => Number.isFinite(point) && point >= 0 && point <= 1))
        const isValidImageAnimation = value => value === null || value && typeof value === 'object' && !Array.isArray(value)
          && Object.keys(value).length === 4 && Object.keys(value).every(key => ['effect', 'phase', 'speed', 'direction'].includes(key))
          && value.effect === 'elevation' && ['enter', 'exit'].includes(value.phase) && ['slow', 'medium', 'fast'].includes(value.speed) && ['down', 'up', 'left', 'right'].includes(value.direction)
        const validDesignElement = element => {
          const allowedKeys = {
            text: ['id', 'type', 'name', 'x', 'y', 'width', 'height', 'rotation', 'startMs', 'durationMs', 'text', 'href', 'fontSize', 'fontFamily', 'color', 'bold'],
            shape: ['id', 'type', 'name', 'x', 'y', 'width', 'height', 'rotation', 'startMs', 'durationMs', 'shape', 'fill', 'cornerRadius', 'strokeWidth', 'startArrow', 'endArrow', 'curveOffset'],
            image: ['id', 'type', 'name', 'x', 'y', 'width', 'height', 'rotation', 'startMs', 'durationMs', 'src', 'assetId', 'sourceWidth', 'sourceHeight', 'crop', 'opacity', 'flipX', 'flipY', 'brightness', 'contrast', 'saturation', 'filterPreset', 'maskStrokes', 'animation'],
            'sticky-note': ['id', 'type', 'name', 'x', 'y', 'width', 'height', 'rotation', 'startMs', 'durationMs', 'text', 'fill', 'color', 'fontSize'],
            'free-draw': ['id', 'type', 'name', 'x', 'y', 'width', 'height', 'rotation', 'startMs', 'durationMs', 'points', 'color', 'strokeWidth'],
          }
          if (!element || typeof element !== 'object' || typeof element.id !== 'string' || !element.id.length || element.id.length > 100
            || !allowedKeys[element.type] || Object.keys(element).some(key => !allowedKeys[element.type].includes(key))
            || typeof element.name !== 'string' || element.name.length > 256
            || !['x', 'y', 'width', 'height', 'rotation'].every(key => Number.isFinite(element[key]))
            || ['startMs', 'durationMs'].some(key => element[key] !== undefined && (!Number.isInteger(element[key]) || element[key] < (key === 'durationMs' ? 1 : 0) || element[key] > 86_400_000))
            || element.width <= 0 || element.height <= 0 || element.width > 100_000 || element.height > 100_000
            || Math.abs(element.x) > 1_000_000 || Math.abs(element.y) > 1_000_000 || Math.abs(element.rotation) > 36_000) return false
          if (element.type === 'text') return typeof element.text === 'string' && element.text.length <= 100_000 && (element.href === undefined || isSafeSiteHref(element.href)) && Number.isFinite(element.fontSize) && element.fontSize >= 0 && element.fontSize <= 10_000 && typeof element.fontFamily === 'string' && element.fontFamily.length <= 256 && typeof element.color === 'string' && element.color.length <= 256 && typeof element.bold === 'boolean'
          if (element.type === 'shape') return ['rect', 'ellipse', 'triangle', 'star', 'hexagon', 'line', 'arrow', 'speech-bubble'].includes(element.shape) && typeof element.fill === 'string' && element.fill.length <= 256 && Number.isFinite(element.cornerRadius) && element.cornerRadius >= 0 && element.cornerRadius <= 10_000 && (element.startArrow === undefined || typeof element.startArrow === 'boolean') && (element.endArrow === undefined || typeof element.endArrow === 'boolean') && (element.curveOffset === undefined || element.curveOffset === null || Number.isFinite(element.curveOffset) && Math.abs(element.curveOffset) <= 10_000)
            && (element.strokeWidth === undefined || Number.isFinite(element.strokeWidth) && element.strokeWidth >= 1 && element.strokeWidth <= 512)
          if (element.type === 'image') return typeof element.src === 'string' && element.src.length <= 14_000_000 && (element.assetId === undefined || typeof element.assetId === 'string' && element.assetId.length <= 100)
            && (element.sourceWidth === undefined || Number.isInteger(element.sourceWidth) && element.sourceWidth > 0 && element.sourceWidth <= 100_000)
            && (element.sourceHeight === undefined || Number.isInteger(element.sourceHeight) && element.sourceHeight > 0 && element.sourceHeight <= 100_000)
            && (element.crop === undefined || element.crop === null || isValidImageCrop(element.crop, element.sourceWidth, element.sourceHeight))
            && (element.opacity === undefined || Number.isInteger(element.opacity) && element.opacity >= 0 && element.opacity <= 100)
            && (element.brightness === undefined || Number.isInteger(element.brightness) && element.brightness >= -100 && element.brightness <= 100)
            && (element.contrast === undefined || Number.isInteger(element.contrast) && element.contrast >= -100 && element.contrast <= 100)
            && (element.saturation === undefined || Number.isInteger(element.saturation) && element.saturation >= -100 && element.saturation <= 100)
            && (element.filterPreset === undefined || ['soft', 'vintage', 'mono', 'color-pop', 'duotone'].includes(element.filterPreset))
            && (element.maskStrokes === undefined || isValidImageMaskStrokes(element.maskStrokes))
            && (element.animation === undefined || isValidImageAnimation(element.animation))
            && (element.flipX === undefined || typeof element.flipX === 'boolean') && (element.flipY === undefined || typeof element.flipY === 'boolean')
          if (element.type === 'sticky-note') return typeof element.text === 'string' && element.text.length <= 100_000 && typeof element.fill === 'string' && element.fill.length <= 256 && typeof element.color === 'string' && element.color.length <= 256 && Number.isFinite(element.fontSize) && element.fontSize >= 0 && element.fontSize <= 10_000
          if (element.type === 'free-draw') return Array.isArray(element.points) && element.points.length >= 2 && element.points.length <= 40_000 && element.points.length % 2 === 0 && element.points.every(point => Number.isFinite(point) && Math.abs(point) <= 100_000) && typeof element.color === 'string' && element.color.length <= 256 && Number.isFinite(element.strokeWidth) && element.strokeWidth >= 0 && element.strokeWidth <= 10_000
          return false
        }
        const validDesignGroup = group => group && typeof group.id === 'string' && group.id.length > 0 && group.id.length <= 100
          && typeof group.name === 'string' && group.name.length <= 256 && Array.isArray(group.elementIds) && group.elementIds.length >= 2 && group.elementIds.length <= 500
          && group.elementIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 100) && new Set(group.elementIds).size === group.elementIds.length
        const validDesignConnector = connector => connector && typeof connector.id === 'string' && connector.id.length > 0 && connector.id.length <= 100
          && typeof connector.fromId === 'string' && connector.fromId.length > 0 && connector.fromId.length <= 100
          && typeof connector.toId === 'string' && connector.toId.length > 0 && connector.toId.length <= 100
          && typeof connector.color === 'string' && connector.color.length <= 256 && Number.isFinite(connector.strokeWidth) && connector.strokeWidth >= 0 && connector.strokeWidth <= 10_000
          && ['fromAnchor', 'toAnchor'].every(key => connector[key] === undefined || connector[key] && Number.isFinite(connector[key].x) && Number.isFinite(connector[key].y) && connector[key].x >= 0 && connector[key].x <= 1 && connector[key].y >= 0 && connector[key].y <= 1)
        const validDesignConnectorPatch = patch => patch && typeof patch === 'object' && !Array.isArray(patch)
          && Object.keys(patch).length > 0 && Object.keys(patch).length <= 6
          && Object.keys(patch).every(key => ['fromId', 'toId', 'fromAnchor', 'toAnchor', 'color', 'strokeWidth'].includes(key))
          && Object.entries(patch).every(([key, value]) => key === 'fromAnchor' || key === 'toAnchor'
            ? value === null || value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(anchorKey => ['x', 'y'].includes(anchorKey)) && Number.isFinite(value.x) && Number.isFinite(value.y) && value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1
            : key === 'fromId' || key === 'toId' ? typeof value === 'string' && value.length > 0 && value.length <= 100
              : key === 'color' ? typeof value === 'string' && value.length <= 256
                : Number.isFinite(value) && value >= 0 && value <= 10_000)
        const validVideoOpacityKeyframes = (keyframes, durationMs = 86_400_000) => keyframes === undefined || Array.isArray(keyframes) && keyframes.length <= 100 && keyframes.every((keyframe, index) => keyframe && typeof keyframe === 'object' && !Array.isArray(keyframe)
          && Object.keys(keyframe).every(key => ['timeMs', 'opacity', 'easing'].includes(key))
          && Number.isInteger(keyframe.timeMs) && keyframe.timeMs >= 0 && keyframe.timeMs <= durationMs
          && Number.isFinite(keyframe.opacity) && keyframe.opacity >= 0 && keyframe.opacity <= 100
          && (keyframe.easing === undefined || ['linear', 'ease-in', 'ease-out', 'ease-in-out'].includes(keyframe.easing))
          && (index === 0 || keyframes[index - 1].timeMs < keyframe.timeMs))
        const validVideoTransformKeyframes = (keyframes, durationMs = 86_400_000) => keyframes === undefined || Array.isArray(keyframes) && keyframes.length <= 100 && keyframes.every((keyframe, index) => keyframe && typeof keyframe === 'object' && !Array.isArray(keyframe)
          && Object.keys(keyframe).every(key => ['timeMs', 'scale', 'offsetX', 'offsetY', 'easing'].includes(key))
          && Number.isInteger(keyframe.timeMs) && keyframe.timeMs >= 0 && keyframe.timeMs <= durationMs
          && Number.isFinite(keyframe.scale) && keyframe.scale >= 50 && keyframe.scale <= 300
          && Number.isFinite(keyframe.offsetX) && keyframe.offsetX >= -100 && keyframe.offsetX <= 100
          && Number.isFinite(keyframe.offsetY) && keyframe.offsetY >= -100 && keyframe.offsetY <= 100
          && (keyframe.easing === undefined || ['linear', 'ease-in', 'ease-out', 'ease-in-out'].includes(keyframe.easing))
          && (index === 0 || keyframes[index - 1].timeMs < keyframe.timeMs))
        const validVideoTimelineClip = clip => clip && typeof clip === 'object' && !Array.isArray(clip)
          && Object.keys(clip).every(key => ['id', 'assetId', 'name', 'kind', 'startMs', 'durationMs', 'sourceDurationMs', 'sourceStartMs', 'volume', 'fadeInMs', 'fadeOutMs', 'trackIndex', 'opacity', 'fitMode', 'scale', 'offsetX', 'offsetY', 'opacityKeyframes', 'transformKeyframes', 'animationEasing'].includes(key))
          && typeof clip.id === 'string' && clip.id.length > 0 && clip.id.length <= 100
          && typeof clip.assetId === 'string' && clip.assetId.length > 0 && clip.assetId.length <= 100
          && typeof clip.name === 'string' && clip.name.length > 0 && clip.name.length <= 256
          && ['video', 'audio'].includes(clip.kind)
          && (clip.trackIndex === undefined || Number.isInteger(clip.trackIndex) && clip.trackIndex >= 0 && clip.trackIndex <= 999)
          && (clip.opacity === undefined || clip.kind === 'video' && Number.isFinite(clip.opacity) && clip.opacity >= 0 && clip.opacity <= 100)
          && (clip.fitMode === undefined || clip.kind === 'video' && ['contain', 'cover'].includes(clip.fitMode))
          && (clip.scale === undefined || clip.kind === 'video' && Number.isFinite(clip.scale) && clip.scale >= 50 && clip.scale <= 300)
          && (clip.offsetX === undefined || clip.kind === 'video' && Number.isFinite(clip.offsetX) && clip.offsetX >= -100 && clip.offsetX <= 100)
          && (clip.offsetY === undefined || clip.kind === 'video' && Number.isFinite(clip.offsetY) && clip.offsetY >= -100 && clip.offsetY <= 100)
          && (clip.opacityKeyframes === undefined || clip.kind === 'video' && validVideoOpacityKeyframes(clip.opacityKeyframes, clip.durationMs))
          && (clip.transformKeyframes === undefined || clip.kind === 'video' && validVideoTransformKeyframes(clip.transformKeyframes, clip.durationMs))
          && (clip.animationEasing === undefined || clip.kind === 'video' && ['linear', 'ease-in', 'ease-out', 'ease-in-out'].includes(clip.animationEasing))
          && (clip.fadeInMs === undefined || clip.kind === 'audio' && Number.isInteger(clip.fadeInMs) && clip.fadeInMs >= 0 && clip.fadeInMs <= clip.durationMs)
          && (clip.fadeOutMs === undefined || clip.kind === 'audio' && Number.isInteger(clip.fadeOutMs) && clip.fadeOutMs >= 0 && clip.fadeOutMs <= clip.durationMs)
          && Number.isInteger(clip.startMs) && clip.startMs >= 0 && clip.startMs <= 86_400_000
          && Number.isInteger(clip.durationMs) && clip.durationMs > 0 && clip.durationMs <= 86_400_000
          && Number.isInteger(clip.sourceDurationMs) && clip.sourceDurationMs > 0 && clip.sourceDurationMs <= 86_400_000
          && Number.isInteger(clip.sourceStartMs) && clip.sourceStartMs >= 0 && clip.sourceStartMs <= 86_400_000
          && clip.sourceStartMs + clip.durationMs <= clip.sourceDurationMs
          && Number.isFinite(clip.volume) && clip.volume >= 0 && clip.volume <= 1
        const validDesignPage = page => {
          const pageKeys = ['id', 'name', 'background', 'elements', 'connectors', 'groups', 'presenterNotes', 'blocks', 'cells', 'cellMerges', 'cellFormats', 'timelineClips', 'charts']
          if (!page || typeof page !== 'object' || Object.keys(page).some(key => !pageKeys.includes(key))
            || typeof page.id !== 'string' || !page.id.length || page.id.length > 100
            || typeof page.name !== 'string' || page.name.length > 256
            || (page.background !== undefined && (typeof page.background !== 'string' || page.background.length > 256))
            || !Array.isArray(page.elements) || page.elements.length > 20_000 || !page.elements.every(validDesignElement)) return false
          const elementIds = new Set(page.elements.map(element => element.id))
          if (page.groups !== undefined && (!Array.isArray(page.groups) || page.groups.length > 1000 || !page.groups.every(validDesignGroup)
            || new Set(page.groups.map(group => group.id)).size !== page.groups.length
            || page.groups.some(group => group.elementIds.some(id => !elementIds.has(id)))
            || new Set(page.groups.flatMap(group => group.elementIds)).size !== page.groups.reduce((size, group) => size + group.elementIds.length, 0))) return false
          if (page.connectors !== undefined && (!Array.isArray(page.connectors) || page.connectors.length > 20_000 || !page.connectors.every(validDesignConnector)
            || new Set(page.connectors.map(connector => connector.id)).size !== page.connectors.length
            || page.connectors.some(connector => !elementIds.has(connector.fromId) || !elementIds.has(connector.toId)))) return false
          if (page.presenterNotes !== undefined && (typeof page.presenterNotes !== 'string' || page.presenterNotes.length > 100_000)) return false
          if (page.timelineClips !== undefined && (!Array.isArray(page.timelineClips) || page.timelineClips.length > 500 || !page.timelineClips.every(validVideoTimelineClip)
            || new Set(page.timelineClips.map(clip => clip.id)).size !== page.timelineClips.length)) return false
          if (page.cells !== undefined && (!Array.isArray(page.cells) || page.cells.length > 1000 || page.cells.some(row => !Array.isArray(row) || row.length > 200 || row.some(cell => typeof cell !== 'string' || cell.length > 10_000)))) return false
          if (page.cellMerges !== undefined && (!Array.isArray(page.cellMerges) || page.cellMerges.length > 20_000 || page.cellMerges.some(merge => !validCell(merge) || !Number.isInteger(merge.colSpan) || merge.colSpan < 1 || merge.column + merge.colSpan > 200 || merge.rowSpan !== undefined && (!Number.isInteger(merge.rowSpan) || merge.rowSpan < 1 || merge.row + merge.rowSpan > 1000) || merge.colSpan * (merge.rowSpan ?? 1) < 2))) return false
          if (page.cellFormats !== undefined && (!page.cellFormats || typeof page.cellFormats !== 'object' || Array.isArray(page.cellFormats)
            || Object.entries(page.cellFormats).some(([key, value]) => !/^\d{1,3}:\d{1,3}$/.test(key) || !['default', 'currency', 'percentage', 'date', 'time', 'datetime'].includes(value)))) return false
          if (page.charts !== undefined && (!Array.isArray(page.charts) || page.charts.length > 100 || !page.charts.every(chart => chart && typeof chart.id === 'string' && chart.id.length > 0 && chart.id.length <= 100 && ['bar', 'line'].includes(chart.type) && typeof chart.title === 'string' && chart.title.length <= 120 && chart.range && ['startRow', 'startColumn', 'endRow', 'endColumn'].every(key => Number.isInteger(chart.range[key])) && chart.range.startRow >= 0 && chart.range.startColumn >= 0 && chart.range.endRow >= chart.range.startRow && chart.range.endRow < 1000 && chart.range.endColumn >= chart.range.startColumn && chart.range.endColumn < 200 && (chart.range.endRow - chart.range.startRow + 1) * (chart.range.endColumn - chart.range.startColumn + 1) <= 2000) || new Set(page.charts.map(chart => chart.id)).size !== page.charts.length)) return false
          if (page.blocks !== undefined && (!Array.isArray(page.blocks) || page.blocks.length > 2000 || page.blocks.some(block => !validDocBlock(block)) || new Set(page.blocks.map(block => block.id)).size !== page.blocks.length)) return false
          if (page.blocks !== undefined && page.blocks.reduce((total, block) => total + docBlockImageByteLength(block), 0) > MAX_DOC_IMAGE_TOTAL_BYTES) return false
          return true
        }
        const validList = (list, predicate) => Array.isArray(list) && list.length > 0 && list.length <= 20_000 && list.every(predicate)
        const validType = body.type === 'sheet.cells.set'
          ? validList(cells, cell => validCell(cell) && typeof cell.value === 'string' && cell.value.length <= 10_000)
          : body.type === 'sheet.formats.set'
            ? validList(formats, cell => validCell(cell) && ['default', 'currency', 'percentage', 'date', 'time', 'datetime'].includes(cell.value))
            : body.type === 'sheet.merge.set'
              ? body.merge && Number.isInteger(body.merge.row) && body.merge.row >= 0 && body.merge.row < 1000 && Number.isInteger(body.merge.column) && body.merge.column >= 0 && Number.isInteger(body.merge.colSpan) && body.merge.colSpan >= 1 && body.merge.column + body.merge.colSpan <= 200 && Number.isInteger(body.merge.rowSpan ?? 1) && (body.merge.rowSpan ?? 1) >= 1 && body.merge.row + (body.merge.rowSpan ?? 1) <= 1000 && body.merge.colSpan + (body.merge.rowSpan ?? 1) >= 3
            : body.type === 'sheet.merge.remove'
              ? validCell(body)
              : body.type === 'sheet.rows.append' || body.type === 'sheet.columns.append'
                ? true
                : body.type === 'sheet.chart.set'
                  ? typeof body.chartId === 'string' && body.chartId.length > 0 && body.chartId.length <= 100 && (body.chart === null || Boolean(body.chart && body.chart.id === body.chartId && ['bar', 'line'].includes(body.chart.type) && typeof body.chart.title === 'string' && body.chart.title.length <= 120 && body.chart.range && ['startRow', 'startColumn', 'endRow', 'endColumn'].every(key => Number.isInteger(body.chart.range[key])) && body.chart.range.startRow >= 0 && body.chart.range.startColumn >= 0 && body.chart.range.endRow >= body.chart.range.startRow && body.chart.range.endRow < 1000 && body.chart.range.endColumn >= body.chart.range.startColumn && body.chart.range.endColumn < 200 && (body.chart.range.endRow - body.chart.range.startRow + 1) * (body.chart.range.endColumn - body.chart.range.startColumn + 1) <= 2000))
                : body.type === 'doc.table.cell.set'
                  ? Boolean(blockId && validCell(body) && typeof body.value === 'string' && body.value.length <= 10_000)
                  : body.type === 'doc.table.structure'
                    ? Boolean(blockId && (body.action === 'row.append' || body.action === 'column.append'
                      || body.action === 'row.move' && Number.isInteger(body.from) && body.from >= 0 && body.from < 1000 && Number.isInteger(body.to) && body.to >= 0 && body.to < 1000 && Math.abs(body.from - body.to) === 1
                      || body.action === 'row.delete' && Number.isInteger(body.row) && body.row >= 0 && body.row < 1000
                      || body.action === 'column.delete' && Number.isInteger(body.column) && body.column >= 0 && body.column < 200
                      || body.action === 'unmerge' && validCell(body)
                      || body.action === 'merge' && Number.isInteger(body.row) && body.row >= 0 && body.row < 1000 && Number.isInteger(body.column) && body.column >= 0 && Number.isInteger(body.colSpan) && body.colSpan >= 1 && body.colSpan <= 200 && body.column + body.colSpan <= 200 && Number.isInteger(body.rowSpan ?? 1) && (body.rowSpan ?? 1) >= 1 && (body.rowSpan ?? 1) <= 1000 && body.row + (body.rowSpan ?? 1) <= 1000 && body.colSpan * (body.rowSpan ?? 1) >= 2))
                    : body.type === 'doc.block.text.set'
                    ? Boolean(blockId && typeof body.text === 'string' && body.text.length <= 100_000 && validMarks(body.marks, body.text))
                    : body.type === 'doc.block.insert'
                      ? validDocBlock(body.block) && withinDocImageLimit([body.block]) && (body.afterBlockId === null || typeof body.afterBlockId === 'string' && body.afterBlockId.length > 0 && body.afterBlockId.length <= 100)
                      : body.type === 'doc.blocks.insert'
                      ? Array.isArray(body.blocks) && body.blocks.length > 0 && body.blocks.length <= 1000 && body.blocks.every(validDocBlock)
                        && withinDocImageLimit(body.blocks)
                          && new Set(body.blocks.map(block => block.id)).size === body.blocks.length
                          && (body.afterBlockId === null || typeof body.afterBlockId === 'string' && body.afterBlockId.length > 0 && body.afterBlockId.length <= 100)
                          && (body.replaceEmptyBlockId === undefined || typeof body.replaceEmptyBlockId === 'string' && body.replaceEmptyBlockId.length > 0 && body.replaceEmptyBlockId.length <= 100)
                          && !(body.replaceEmptyBlockId && body.afterBlockId !== null)
                      : body.type === 'doc.block.delete'
                        ? Boolean(blockId)
                        : body.type === 'doc.block.type.set'
                          ? Boolean(blockId && ['paragraph', 'heading', 'subheading', 'quote', 'bullet'].includes(body.blockType))
                          : body.type === 'doc.blocks.reorder'
                            ? Array.isArray(body.blockIds) && body.blockIds.length > 0 && body.blockIds.length <= 2000 && body.blockIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 100) && new Set(body.blockIds).size === body.blockIds.length
                            : body.type === 'doc.replace.apply'
                              ? Array.isArray(body.blocks) && Array.isArray(body.cells) && body.blocks.length + body.cells.length > 0 && body.blocks.length + body.cells.length <= 20_000
                                && body.blocks.length <= 2000 && body.blocks.every(item => item && typeof item.blockId === 'string' && item.blockId.length > 0 && item.blockId.length <= 100 && typeof item.text === 'string' && item.text.length <= 100_000 && validMarks(item.marks, item.text))
                                && new Set(body.blocks.map(item => item.blockId)).size === body.blocks.length
                                && body.cells.every(item => item && typeof item.blockId === 'string' && item.blockId.length > 0 && item.blockId.length <= 100 && validCell(item) && typeof item.value === 'string' && item.value.length <= 10_000)
                                && new Set(body.cells.map(item => `${item.blockId}:${item.row}:${item.column}`)).size === body.cells.length
                    : body.type === 'design.element.patch'
                      ? Boolean(elementId && validDesignPatch(body.patch))
                      : body.type === 'design.elements.create'
                        ? Array.isArray(body.elements) && body.elements.length > 0 && body.elements.length <= 100 && body.elements.every(validDesignElement) && new Set(body.elements.map(element => element.id)).size === body.elements.length
                          && (body.groups === undefined || Array.isArray(body.groups) && body.groups.length <= 100 && body.groups.every(validDesignGroup) && new Set(body.groups.map(group => group.id)).size === body.groups.length)
                          && (body.connectors === undefined || Array.isArray(body.connectors) && body.connectors.length <= 100 && body.connectors.every(validDesignConnector) && new Set(body.connectors.map(connector => connector.id)).size === body.connectors.length)
                        : body.type === 'design.elements.delete'
                          ? Array.isArray(body.elementIds) && body.elementIds.length > 0 && body.elementIds.length <= 500 && body.elementIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 100) && new Set(body.elementIds).size === body.elementIds.length
                          : body.type === 'design.groups.set'
                            ? Array.isArray(body.groups) && body.groups.length <= 1000 && body.groups.every(validDesignGroup) && new Set(body.groups.map(group => group.id)).size === body.groups.length && new Set(body.groups.flatMap(group => group.elementIds)).size === body.groups.reduce((size, group) => size + group.elementIds.length, 0)
                            : body.type === 'design.elements.reorder'
                              ? Array.isArray(body.elementIds) && body.elementIds.length > 0 && body.elementIds.length <= 20_000 && body.elementIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 100) && new Set(body.elementIds).size === body.elementIds.length
                              : body.type === 'design.page.insert'
                                ? validDesignPage(body.page) && typeof body.afterPageId === 'string' && body.afterPageId.length > 0 && body.afterPageId.length <= 100 && (body.sourcePageId === undefined || typeof body.sourcePageId === 'string' && body.sourcePageId.length > 0 && body.sourcePageId.length <= 100)
                                : body.type === 'design.page.delete'
                                  ? typeof body.targetPageId === 'string' && body.targetPageId.length > 0 && body.targetPageId.length <= 100
                                  : body.type === 'design.pages.reorder'
                                    ? Array.isArray(body.pageIds) && body.pageIds.length > 0 && body.pageIds.length <= 1000 && body.pageIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 100) && new Set(body.pageIds).size === body.pageIds.length
                                    : body.type === 'design.page.notes.set'
                                      ? typeof body.notes === 'string' && body.notes.length <= 100_000
                                      : body.type === 'design.page.patch'
                                        ? body.patch && typeof body.patch === 'object' && !Array.isArray(body.patch) && Object.keys(body.patch).length > 0 && Object.keys(body.patch).length <= 3
                                          && Object.entries(body.patch).every(([key, value]) => key === 'hidden' ? typeof value === 'boolean' : ['name', 'background'].includes(key) && typeof value === 'string' && value.length <= 256)
                                        : body.type === 'design.connector.create'
                                          ? validDesignConnector(body.connector) && body.connector.fromId !== body.connector.toId
                                          : body.type === 'design.connector.patch'
                                            ? typeof body.connectorId === 'string' && body.connectorId.length > 0 && body.connectorId.length <= 100 && validDesignConnectorPatch(body.patch)
                                          : body.type === 'design.video.clip.create'
                                            ? validVideoTimelineClip(body.clip)
                                            : body.type === 'design.video.clip.patch'
                                              ? typeof body.clipId === 'string' && body.clipId.length > 0 && body.clipId.length <= 100
                                                && body.patch && typeof body.patch === 'object' && !Array.isArray(body.patch) && Object.keys(body.patch).length > 0 && Object.keys(body.patch).length <= 12
                                                && Object.keys(body.patch).every(key => ['startMs', 'durationMs', 'sourceStartMs', 'volume', 'fadeInMs', 'fadeOutMs', 'trackIndex', 'opacity', 'fitMode', 'scale', 'offsetX', 'offsetY', 'opacityKeyframes', 'transformKeyframes', 'animationEasing'].includes(key))
                                                && Object.entries(body.patch).every(([key, value]) => key === 'volume' ? Number.isFinite(value) && value >= 0 && value <= 1 : key === 'fadeInMs' || key === 'fadeOutMs' ? Number.isInteger(value) && value >= 0 && value <= 86_400_000 : key === 'opacity' ? Number.isFinite(value) && value >= 0 && value <= 100 : key === 'fitMode' ? ['contain', 'cover'].includes(value) : key === 'scale' ? Number.isFinite(value) && value >= 50 && value <= 300 : key === 'offsetX' || key === 'offsetY' ? Number.isFinite(value) && value >= -100 && value <= 100 : key === 'opacityKeyframes' ? validVideoOpacityKeyframes(value) : key === 'transformKeyframes' ? validVideoTransformKeyframes(value) : key === 'animationEasing' ? ['linear', 'ease-in', 'ease-out', 'ease-in-out'].includes(value) : Number.isInteger(value) && value >= (key === 'durationMs' || key === 'trackIndex' ? (key === 'durationMs' ? 1 : 0) : 0) && value <= (key === 'trackIndex' ? 999 : 86_400_000))
                                              : body.type === 'design.video.clip.delete'
                                                ? typeof body.clipId === 'string' && body.clipId.length > 0 && body.clipId.length <= 100
                          : false
        if (!operationId || !pageId || !Number.isInteger(body.baseRevision) || body.baseRevision < 1 || !validType) throw new HttpError(400, 'Invalid collaborative operation or exceeded limits.')
        const list = body.type === 'sheet.cells.set' ? cells : body.type === 'sheet.formats.set' ? formats : []
        if (list.length && new Set(list.map(cell => `${cell.row}:${cell.column}`)).size !== list.length) throw new HttpError(400, 'Operation contains duplicate cells.')
        const prior = database.prepare('SELECT document_id FROM document_operations WHERE operation_id = ?').get(operationId)
        if (prior) {
          if (prior.document_id !== documentId) throw new HttpError(409, 'Operation ID was already used.')
          const current = documentAccess(documentId, user.id)
          return sendJson(response, 200, { revision: current.revision, document: { ...JSON.parse(current.data_json), id: current.id, name: current.name, updatedAt: current.updated_at }, duplicate: true })
        }
        const latest = documentAccess(documentId, user.id)
        const latestData = JSON.parse(latest.data_json)
        const page = Array.isArray(latestData.pages) ? latestData.pages.find(item => item?.id === pageId) : null
        const videoTimelineDurationMs = Number.isInteger(latestData.videoDurationMs) && latestData.videoDurationMs > 0 ? latestData.videoDurationMs : 5000
        const isSheetOperation = body.type.startsWith('sheet.')
        const isDocOperation = body.type.startsWith('doc.')
        const isPageOperation = body.type === 'design.page.insert' || body.type === 'design.page.delete' || body.type === 'design.pages.reorder' || body.type === 'design.page.notes.set' || body.type === 'design.page.patch'
        const isDesignOperation = body.type.startsWith('design.') && !isPageOperation
        const isVideoTimelineOperation = body.type.startsWith('design.video.clip.')
        const isPresenterNotesOperation = body.type === 'design.page.notes.set'
        if (!page || (isSheetOperation && latestData.type !== 'sheet') || (isDocOperation && latestData.type !== 'doc') || (isDesignOperation && !['design', 'presentation', 'whiteboard', 'video', 'site'].includes(latestData.type)) || (body.type.startsWith('design.connector.') && latestData.type !== 'whiteboard') || (isVideoTimelineOperation && latestData.type !== 'video') || (isPageOperation && !['design', 'presentation', 'whiteboard', 'doc', 'sheet', 'video', 'site'].includes(latestData.type)) || (isPresenterNotesOperation && latestData.type !== 'presentation')) throw new HttpError(404, 'Operation target not found.')
        if (body.type === 'doc.block.insert' && !withinDocImageLimit([...(page.blocks ?? []), body.block])) throw new HttpError(400, 'The page exceeds the embedded image size limit.')
        if (body.type === 'doc.blocks.insert' && !withinDocImageLimit([...(page.blocks ?? []).filter(block => block.id !== body.replaceEmptyBlockId), ...body.blocks])) throw new HttpError(400, 'The page exceeds the embedded image size limit.')
        if (body.type === 'sheet.cells.set') {
          const coveredCells = cells.filter(cell => (page.cellMerges ?? []).some(merge => cell.row >= merge.row && cell.row < merge.row + (merge.rowSpan ?? 1)
            && cell.column >= merge.column && cell.column < merge.column + merge.colSpan
            && (cell.row !== merge.row || cell.column !== merge.column)))
          if (coveredCells.length) {
            if (body.baseRevision !== latest.revision) {
              const baseVersion = database.prepare('SELECT data_json FROM document_versions WHERE document_id = ? AND revision = ?').get(documentId, body.baseRevision)
              if (baseVersion) {
                const basePage = JSON.parse(baseVersion.data_json).pages?.find(item => item?.id === pageId)
                const newlyCovered = coveredCells.filter(cell => !(basePage?.cellMerges ?? []).some(merge => cell.row >= merge.row && cell.row < merge.row + (merge.rowSpan ?? 1)
                  && cell.column >= merge.column && cell.column < merge.column + merge.colSpan
                  && (cell.row !== merge.row || cell.column !== merge.column)))
                if (newlyCovered.length) throw new HttpError(409, 'A collaborator merged the selected cells.', { current: serializeDocument(latest), conflicts: newlyCovered.map(cell => `pages[${pageId}].cellMerges[${cell.row}:${cell.column}]`) })
                throw new HttpError(400, 'Cells covered by a merged range cannot be edited individually.')
              }
            } else {
              throw new HttpError(400, 'Cells covered by a merged range cannot be edited individually.')
            }
          }
        }
        if (body.type === 'design.connector.create') {
          const elementIds = new Set((page.elements ?? []).map(element => element.id))
          if (!elementIds.has(body.connector.fromId) || !elementIds.has(body.connector.toId)) throw new HttpError(409, 'A connector endpoint was removed or is not available.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].connectors[${body.connector.id}]`] })
          if ((page.connectors ?? []).some(connector => connector.id === body.connector.id)) throw new HttpError(409, 'A connector with the same ID already exists.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].connectors[${body.connector.id}]`] })
        }
        if (body.type === 'design.connector.patch') {
          const connector = (page.connectors ?? []).find(item => item.id === body.connectorId)
          if (!connector) throw new HttpError(409, 'The connector was removed or is unavailable.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].connectors[${body.connectorId}]`] })
          const candidate = { ...connector, ...body.patch }
          for (const key of ['fromAnchor', 'toAnchor']) if (body.patch[key] === null) delete candidate[key]
          const elementIds = new Set((page.elements ?? []).map(element => element.id))
          if (!validDesignConnector(candidate) || candidate.fromId === candidate.toId || !elementIds.has(candidate.fromId) || !elementIds.has(candidate.toId)) throw new HttpError(409, 'Connector endpoints must reference distinct elements on this page.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].connectors[${body.connectorId}]`] })
        }
        if (body.type === 'doc.block.insert') {
          const currentBlocks = page.blocks ?? []
          if (currentBlocks.length >= 2000) throw new HttpError(400, 'The document page already has the maximum number of blocks.')
          if (currentBlocks.some(block => block.id === body.block.id)) throw new HttpError(409, 'A block with the same ID already exists.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks[${body.block.id}]`] })
          if (body.afterBlockId !== null && !currentBlocks.some(block => block.id === body.afterBlockId)) throw new HttpError(409, 'The insertion anchor block was removed.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks[${body.afterBlockId}]`] })
        }
        if (body.type === 'doc.blocks.insert') {
          const currentBlocks = page.blocks ?? []
          const replacing = body.replaceEmptyBlockId ? currentBlocks.find(block => block.id === body.replaceEmptyBlockId) : null
          if (body.replaceEmptyBlockId && (!replacing || currentBlocks.length !== 1 || replacing.type !== 'paragraph' || replacing.text.trim())) {
            throw new HttpError(409, 'The blank paragraph changed before the import could be applied.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks[${body.replaceEmptyBlockId}]`] })
          }
          if (currentBlocks.length + body.blocks.length - (replacing ? 1 : 0) > 2000) throw new HttpError(400, 'The document page already has the maximum number of blocks.')
          const existingIds = new Set(currentBlocks.filter(block => block.id !== body.replaceEmptyBlockId).map(block => block.id))
          const collisions = body.blocks.filter(block => existingIds.has(block.id)).map(block => `pages[${pageId}].blocks[${block.id}]`)
          if (collisions.length) throw new HttpError(409, 'Imported block IDs already exist.', { current: serializeDocument(latest), conflicts: collisions })
          if (!body.replaceEmptyBlockId && body.afterBlockId !== null && !existingIds.has(body.afterBlockId)) throw new HttpError(409, 'The insertion anchor block was removed.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks[${body.afterBlockId}]`] })
        }
        let mergedTextBlock = null
        let mergedDesignElement = null
        let mergedDesignConnector = null
        let deletedDesignElements = null
        let rebasedDesignOrder = null
        let rebasedPageOrder = null
        let rebasedDocBlockOrder = null
        let mergedPresenterNotes = null
        let mergedDesignPagePatch = null
        let mergedVideoTimelineClip = null
        let deletedVideoTimelineClip = false
        let mergedDocReplaceBlocks = null
        let mergedDocReplaceCells = null
        if (body.type === 'design.page.insert') {
          const pageIds = (latestData.pages ?? []).map(item => item.id)
          if (pageIds.length >= 1000) throw new HttpError(400, 'The document already has the maximum number of pages.')
          if (pageIds.includes(body.page.id)) throw new HttpError(409, 'A page with the same ID already exists.', { current: serializeDocument(latest), conflicts: [`pages[${body.page.id}]`] })
          if (!pageIds.includes(body.afterPageId)) throw new HttpError(409, 'The insertion anchor page was removed.', { current: serializeDocument(latest), conflicts: [`pages[${body.afterPageId}]`] })
          if (body.sourcePageId && !pageIds.includes(body.sourcePageId)) throw new HttpError(409, 'The source page was removed.', { current: serializeDocument(latest), conflicts: [`pages[${body.sourcePageId}]`] })
        } else if (body.type === 'design.page.delete') {
          if ((latestData.pages ?? []).length <= 1) throw new HttpError(409, 'A document must keep at least one page.', { current: serializeDocument(latest) })
          if (!(latestData.pages ?? []).some(item => item.id === body.targetPageId)) throw new HttpError(409, 'The page was already removed.', { current: serializeDocument(latest), conflicts: [`pages[${body.targetPageId}]`] })
        } else if (body.type === 'design.pages.reorder') {
          const currentIds = (latestData.pages ?? []).map(item => item.id)
          if (body.pageIds.length !== currentIds.length || body.pageIds.some(id => !currentIds.includes(id))) throw new HttpError(409, 'The page list changed before reordering.', { current: serializeDocument(latest), conflicts: ['pages.order'] })
          if (body.baseRevision === latest.revision) rebasedPageOrder = body.pageIds
        }
        if (body.type === 'design.elements.create') {
          const elementIds = new Set((page.elements ?? []).map(element => element.id))
          const groupIds = new Set((page.groups ?? []).map(group => group.id))
          const connectorIds = new Set((page.connectors ?? []).map(connector => connector.id))
          const collisions = body.elements.filter(element => elementIds.has(element.id)).map(element => `pages[${pageId}].elements[${element.id}]`)
          collisions.push(...(body.groups ?? []).filter(group => groupIds.has(group.id)).map(group => `pages[${pageId}].groups[${group.id}]`))
          collisions.push(...(body.connectors ?? []).filter(connector => connectorIds.has(connector.id)).map(connector => `pages[${pageId}].connectors[${connector.id}]`))
          if (collisions.length) throw new HttpError(409, 'Created IDs already exist.', { current: serializeDocument(latest), conflicts: collisions })
          const resultingIds = new Set([...elementIds, ...body.elements.map(element => element.id)])
          const allGroups = [...(page.groups ?? []), ...(body.groups ?? [])]
          if (allGroups.some(group => group.elementIds.some(id => !resultingIds.has(id))) || new Set(allGroups.flatMap(group => group.elementIds)).size !== allGroups.reduce((size, group) => size + group.elementIds.length, 0)) throw new HttpError(400, 'Created groups must reference existing ungrouped elements.')
          if ((body.connectors ?? []).some(connector => !resultingIds.has(connector.fromId) || !resultingIds.has(connector.toId))) throw new HttpError(400, 'Created connectors must reference existing elements.')
        } else if (body.type === 'design.groups.set') {
          const elementIds = new Set((page.elements ?? []).map(element => element.id))
          if (body.groups.some(group => group.elementIds.some(id => !elementIds.has(id)))) throw new HttpError(400, 'Groups must reference existing elements.')
        } else if (body.type === 'design.elements.reorder') {
          const currentOrder = (page.elements ?? []).map(element => element.id)
          if (body.elementIds.length !== currentOrder.length || body.elementIds.some(id => !currentOrder.includes(id))) throw new HttpError(409, 'The element list changed before reordering.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].elements.order`] })
          if (body.baseRevision === latest.revision) rebasedDesignOrder = body.elementIds
        }
        const allowedDesignKeys = {
          text: ['x', 'y', 'width', 'height', 'rotation', 'startMs', 'durationMs', 'name', 'text', 'href', 'fontSize', 'fontFamily', 'color', 'bold'],
          shape: ['x', 'y', 'width', 'height', 'rotation', 'startMs', 'durationMs', 'name', 'shape', 'fill', 'cornerRadius', 'strokeWidth', 'startArrow', 'endArrow', 'curveOffset'],
          image: ['x', 'y', 'width', 'height', 'rotation', 'startMs', 'durationMs', 'name', 'opacity', 'flipX', 'flipY', 'brightness', 'contrast', 'saturation', 'filterPreset', 'maskStrokes', 'animation', 'src', 'assetId', 'sourceWidth', 'sourceHeight', 'crop'],
          'sticky-note': ['x', 'y', 'width', 'height', 'rotation', 'startMs', 'durationMs', 'name', 'text', 'fill', 'color', 'fontSize'],
          'free-draw': ['x', 'y', 'width', 'height', 'rotation', 'startMs', 'durationMs', 'name', 'points', 'color', 'strokeWidth'],
        }
        const validateElementPatch = element => element && allowedDesignKeys[element.type]?.length && Object.keys(body.patch).every(key => allowedDesignKeys[element.type].includes(key))
          && (element.type !== 'text' || body.patch.href === undefined || isSafeSiteHref(body.patch.href))
          && (element.type !== 'shape' || (body.patch.shape === undefined || ['rect', 'ellipse', 'triangle', 'star', 'hexagon', 'line', 'arrow', 'speech-bubble'].includes(body.patch.shape))
            && (body.patch.strokeWidth === undefined || Number.isFinite(body.patch.strokeWidth) && body.patch.strokeWidth >= 1 && body.patch.strokeWidth <= 512)
            && (body.patch.startArrow === undefined || typeof body.patch.startArrow === 'boolean')
            && (body.patch.endArrow === undefined || typeof body.patch.endArrow === 'boolean')
            && (body.patch.curveOffset === undefined || body.patch.curveOffset === null || typeof body.patch.curveOffset === 'number' && Number.isFinite(body.patch.curveOffset) && Math.abs(body.patch.curveOffset) <= 10_000))
          && (element.type !== 'image' || (body.patch.opacity === undefined || Number.isInteger(body.patch.opacity) && body.patch.opacity >= 0 && body.patch.opacity <= 100)
            && (body.patch.brightness === undefined || Number.isInteger(body.patch.brightness) && body.patch.brightness >= -100 && body.patch.brightness <= 100)
            && (body.patch.contrast === undefined || Number.isInteger(body.patch.contrast) && body.patch.contrast >= -100 && body.patch.contrast <= 100)
            && (body.patch.saturation === undefined || Number.isInteger(body.patch.saturation) && body.patch.saturation >= -100 && body.patch.saturation <= 100)
            && (body.patch.filterPreset === undefined || ['soft', 'vintage', 'mono', 'color-pop', 'duotone'].includes(body.patch.filterPreset))
            && (body.patch.maskStrokes === undefined || isValidImageMaskStrokes(body.patch.maskStrokes))
            && (body.patch.animation === undefined || isValidImageAnimation(body.patch.animation))
            && (body.patch.flipX === undefined || typeof body.patch.flipX === 'boolean') && (body.patch.flipY === undefined || typeof body.patch.flipY === 'boolean')
            && (body.patch.src === undefined || typeof body.patch.src === 'string' && body.patch.src.length <= 14_000_000)
            && (body.patch.assetId === undefined || typeof body.patch.assetId === 'string' && body.patch.assetId.length <= 100)
            && (body.patch.sourceWidth === undefined || Number.isInteger(body.patch.sourceWidth) && body.patch.sourceWidth > 0 && body.patch.sourceWidth <= 100_000)
            && (body.patch.sourceHeight === undefined || Number.isInteger(body.patch.sourceHeight) && body.patch.sourceHeight > 0 && body.patch.sourceHeight <= 100_000)
            && (body.patch.crop === undefined || body.patch.crop === null || isValidImageCrop(body.patch.crop, body.patch.sourceWidth ?? element.sourceWidth, body.patch.sourceHeight ?? element.sourceHeight)))
        if (body.baseRevision !== latest.revision) {
          const base = database.prepare('SELECT data_json FROM document_versions WHERE document_id = ? AND revision = ?').get(documentId, body.baseRevision)
          if (!base) throw new HttpError(409, 'Base revision expired; reload the spreadsheet.', { current: serializeDocument(latest) })
          const basePage = JSON.parse(base.data_json).pages?.find(item => item?.id === pageId)
          if (!basePage) throw new HttpError(409, 'Spreadsheet page was removed.', { current: serializeDocument(latest) })
          if (body.type.startsWith('design.video.clip.')) {
            const baseClip = (basePage.timelineClips ?? []).find(clip => clip.id === body.clipId || body.type === 'design.video.clip.create' && clip.id === body.clip.id)
            const currentClip = (page.timelineClips ?? []).find(clip => clip.id === body.clipId || body.type === 'design.video.clip.create' && clip.id === body.clip.id)
            if (body.type === 'design.video.clip.create') {
              if (currentClip) throw new HttpError(409, 'A timeline clip with the same ID already exists.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].timelineClips[${body.clip.id}]`] })
              if (body.clip.startMs + body.clip.durationMs > videoTimelineDurationMs) throw new HttpError(400, 'The timeline clip extends past the project duration.')
            } else if (!baseClip || !currentClip) {
              throw new HttpError(409, 'The timeline clip changed or was removed.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].timelineClips[${body.clipId}]`] })
            } else if (body.type === 'design.video.clip.delete') {
              if (JSON.stringify(baseClip) !== JSON.stringify(currentClip)) throw new HttpError(409, 'The timeline clip changed before it could be removed.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].timelineClips[${body.clipId}]`] })
              deletedVideoTimelineClip = true
            } else {
              const conflicts = Object.keys(body.patch).filter(key => baseClip[key] !== currentClip[key] && currentClip[key] !== body.patch[key])
              if (conflicts.length) throw new HttpError(409, 'Collaborators changed the same timeline clip properties.', { current: serializeDocument(latest), conflicts: conflicts.map(key => `pages[${pageId}].timelineClips[${body.clipId}].${key}`) })
              mergedVideoTimelineClip = { ...currentClip, ...body.patch }
              if (!validVideoTimelineClip(mergedVideoTimelineClip)) throw new HttpError(400, 'The updated timeline clip is invalid.')
              if (mergedVideoTimelineClip.startMs + mergedVideoTimelineClip.durationMs > videoTimelineDurationMs) throw new HttpError(400, 'The timeline clip extends past the project duration.')
            }
          } else if (body.type === 'sheet.cells.set') {
            const overlaps = cells.filter(cell => (basePage.cells?.[cell.row]?.[cell.column] ?? '') !== (page.cells?.[cell.row]?.[cell.column] ?? '') && (page.cells?.[cell.row]?.[cell.column] ?? '') !== cell.value)
            if (overlaps.length) throw new HttpError(409, 'A collaborator changed the same cells.', { current: serializeDocument(latest), conflicts: overlaps.map(cell => `pages[${pageId}].cells[${cell.row}][${cell.column}]`) })
          } else if (body.type === 'sheet.formats.set') {
            const oldFormats = basePage.cellFormats ?? {}
            const currentFormats = page.cellFormats ?? {}
            const overlaps = formats.filter(cell => (oldFormats[`${cell.row}:${cell.column}`] ?? 'default') !== (currentFormats[`${cell.row}:${cell.column}`] ?? 'default') && (currentFormats[`${cell.row}:${cell.column}`] ?? 'default') !== cell.value)
            if (overlaps.length) throw new HttpError(409, 'A collaborator changed the same cell formats.', { current: serializeDocument(latest), conflicts: overlaps.map(cell => `pages[${pageId}].cellFormats[${cell.row}:${cell.column}]`) })
          } else if (body.type === 'sheet.chart.set') {
            const baseChart = (basePage.charts ?? []).find(chart => chart.id === body.chartId)
            const currentChart = (page.charts ?? []).find(chart => chart.id === body.chartId)
            if (JSON.stringify(baseChart ?? null) !== JSON.stringify(currentChart ?? null) && JSON.stringify(body.chart) !== JSON.stringify(currentChart ?? null)) throw new HttpError(409, 'A collaborator changed this chart.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].charts[${body.chartId}]`] })
          } else if (body.type === 'doc.table.cell.set') {
            const baseTable = basePage.blocks?.find(block => block?.id === blockId && block.type === 'table')
            const currentTable = page.blocks?.find(block => block?.id === blockId && block.type === 'table')
            if (!baseTable || !currentTable) throw new HttpError(409, 'The table changed or was removed.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks[${blockId}]`] })
            const baseValue = baseTable.cells?.[body.row]?.[body.column] ?? ''
            const currentValue = currentTable.cells?.[body.row]?.[body.column] ?? ''
            if (baseValue !== currentValue && currentValue !== body.value) throw new HttpError(409, 'A collaborator changed the same table cell.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks[${blockId}].cells[${body.row}][${body.column}]`] })
          } else if (body.type === 'doc.table.structure') {
            const baseTable = basePage.blocks?.find(block => block?.id === blockId && block.type === 'table')
            const currentTable = page.blocks?.find(block => block?.id === blockId && block.type === 'table')
            const conflicts = path => { throw new HttpError(409, 'The table structure changed before this operation could be applied.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks[${blockId}].${path}`] }) }
            if (!baseTable || !currentTable) conflicts('structure')
            const baseCells = baseTable.cells ?? []
            const currentCells = currentTable.cells ?? []
            if (body.action === 'row.move') {
              const { from, to } = body
              if (baseCells.length !== currentCells.length || from >= baseCells.length || to >= baseCells.length) conflicts('cells.dimensions')
              for (const row of [from, to]) if (JSON.stringify(baseCells[row]) !== JSON.stringify(currentCells[row])) conflicts(`cells[${row}]`)
              const affectedMerges = table => (table.merges ?? []).filter(merge => merge.row === from || merge.row === to)
              if (JSON.stringify(affectedMerges(baseTable)) !== JSON.stringify(affectedMerges(currentTable))) conflicts('merges')
              const affectedBorders = table => Object.fromEntries(Object.entries(table.cellBorders ?? {}).filter(([coordinate]) => [from, to].includes(Number(coordinate.split(':')[0]))))
              if (JSON.stringify(affectedBorders(baseTable)) !== JSON.stringify(affectedBorders(currentTable))) conflicts('cellBorders')
            } else if (body.action === 'row.delete') {
              if (baseCells.length !== currentCells.length || body.row >= baseCells.length || JSON.stringify(baseCells[body.row]) !== JSON.stringify(currentCells[body.row])) conflicts(`cells[${body.row}]`)
              if ((baseTable.merges ?? []).some(merge => merge.row === body.row) || (currentTable.merges ?? []).some(merge => merge.row === body.row)) conflicts(`merges[${body.row}]`)
            } else if (body.action === 'column.delete') {
              const baseWidth = Math.max(0, ...baseCells.map(row => row.length))
              const currentWidth = Math.max(0, ...currentCells.map(row => row.length))
              if (baseWidth !== currentWidth || body.column >= baseWidth) conflicts(`cells.columns`)
              const changedRow = baseCells.findIndex((row, index) => (row[body.column] ?? '') !== (currentCells[index]?.[body.column] ?? ''))
              if (changedRow >= 0) conflicts(`cells[${changedRow}][${body.column}]`)
              if (JSON.stringify(baseTable.merges ?? []) !== JSON.stringify(currentTable.merges ?? [])) conflicts('merges')
            } else if (body.action === 'merge') {
              const baseWidth = Math.max(0, ...baseCells.map(row => row.length))
              const rowSpan = body.rowSpan ?? 1
              if (baseCells.length !== currentCells.length || baseWidth !== Math.max(0, ...currentCells.map(row => row.length)) || body.row + rowSpan > baseCells.length || body.column + body.colSpan > baseWidth) conflicts('cells.dimensions')
              for (let row = body.row; row < body.row + rowSpan; row += 1) for (let column = body.column; column < body.column + body.colSpan; column += 1) {
                if ((baseCells[row]?.[column] ?? '') !== (currentCells[row]?.[column] ?? '')) conflicts(`cells[${row}][${column}]`)
              }
              if ((currentTable.merges ?? []).some(merge => body.row < merge.row + (merge.rowSpan ?? 1) && merge.row < body.row + rowSpan && body.column < merge.column + merge.colSpan && merge.column < body.column + body.colSpan)) conflicts('merges')
            } else if (body.action === 'unmerge') {
              const hasMerge = merges => merges.some(merge => body.row >= merge.row && body.row < merge.row + (merge.rowSpan ?? 1) && body.column >= merge.column && body.column < merge.column + merge.colSpan)
              if (!hasMerge(baseTable.merges ?? []) || !hasMerge(currentTable.merges ?? [])) conflicts(`merges[${body.row}:${body.column}]`)
            }
          } else if (body.type === 'doc.block.text.set') {
            const baseBlock = basePage.blocks?.find(block => block?.id === blockId && block.type !== 'table' && block.type !== 'image' && typeof block.text === 'string')
            const currentBlock = page.blocks?.find(block => block?.id === blockId && block.type !== 'table' && block.type !== 'image' && typeof block.text === 'string')
            if (!baseBlock || !currentBlock) throw new HttpError(409, 'The text block changed or was removed.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks[${blockId}]`] })
            const merged = mergeConcurrentDocuments(baseBlock, { ...baseBlock, text: body.text, marks: body.marks }, currentBlock)
            if (!merged.ok) throw new HttpError(409, 'Collaborators edited overlapping text or formatting.', { current: serializeDocument(latest), conflicts: merged.conflicts.map(path => `pages[${pageId}].blocks[${blockId}].${path}`) })
            mergedTextBlock = merged.value
          } else if (body.type === 'doc.blocks.insert' && body.replaceEmptyBlockId) {
            const baseBlock = basePage.blocks?.find(block => block?.id === body.replaceEmptyBlockId)
            const currentBlock = page.blocks?.find(block => block?.id === body.replaceEmptyBlockId)
            if (!baseBlock || !currentBlock || JSON.stringify(baseBlock) !== JSON.stringify(currentBlock) || currentBlock.type !== 'paragraph' || currentBlock.text.trim()) {
              throw new HttpError(409, 'The blank paragraph changed before the import could be applied.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks[${body.replaceEmptyBlockId}]`] })
            }
          } else if (body.type === 'doc.block.delete' || body.type === 'doc.block.type.set') {
            const baseBlock = basePage.blocks?.find(block => block?.id === blockId)
            const currentBlock = page.blocks?.find(block => block?.id === blockId)
            if (!baseBlock || !currentBlock) throw new HttpError(409, 'The document block changed or was removed.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks[${blockId}]`] })
            if (body.type === 'doc.block.delete' && JSON.stringify(baseBlock) !== JSON.stringify(currentBlock)) throw new HttpError(409, 'The block changed before it could be deleted.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks[${blockId}]`] })
            if (body.type === 'doc.block.type.set' && currentBlock.type !== baseBlock.type && currentBlock.type !== body.blockType) throw new HttpError(409, 'Collaborators changed the block style.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks[${blockId}].type`] })
          } else if (body.type === 'doc.blocks.reorder') {
            const baseOrder = (basePage.blocks ?? []).map(block => block.id)
            const currentOrder = (page.blocks ?? []).map(block => block.id)
            if (JSON.stringify(baseOrder) !== JSON.stringify(currentOrder)) throw new HttpError(409, 'Collaborators changed the document block order or structure.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks.order`] })
            if (body.blockIds.length !== currentOrder.length || new Set(body.blockIds).size !== currentOrder.length || body.blockIds.some(id => !currentOrder.includes(id))) throw new HttpError(409, 'The block list changed before reordering.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks.order`] })
            rebasedDocBlockOrder = body.blockIds
          } else if (body.type === 'doc.replace.apply') {
            const baseBlocks = new Map((basePage.blocks ?? []).map(block => [block.id, block]))
            const currentBlocks = new Map((page.blocks ?? []).map(block => [block.id, block]))
            const blockUpdates = new Map()
            const cellUpdates = []
            const conflicts = []
            for (const update of body.blocks) {
              const baseBlock = baseBlocks.get(update.blockId)
              const currentBlock = currentBlocks.get(update.blockId)
              if (!baseBlock || !currentBlock || baseBlock.type === 'table' || currentBlock.type === 'table') {
                conflicts.push(`pages[${pageId}].blocks[${update.blockId}]`)
                continue
              }
              const merged = mergeConcurrentDocuments(baseBlock, { ...baseBlock, text: update.text, marks: update.marks }, currentBlock)
              if (!merged.ok) conflicts.push(...merged.conflicts.map(path => `pages[${pageId}].blocks[${update.blockId}].${path}`))
              else blockUpdates.set(update.blockId, merged.value)
            }
            for (const update of body.cells) {
              const baseTable = baseBlocks.get(update.blockId)
              const currentTable = currentBlocks.get(update.blockId)
              if (!baseTable || !currentTable || baseTable.type !== 'table' || currentTable.type !== 'table') {
                conflicts.push(`pages[${pageId}].blocks[${update.blockId}]`)
                continue
              }
              const baseValue = baseTable.cells?.[update.row]?.[update.column] ?? ''
              const currentValue = currentTable.cells?.[update.row]?.[update.column] ?? ''
              if (baseValue !== currentValue && currentValue !== update.value) conflicts.push(`pages[${pageId}].blocks[${update.blockId}].cells[${update.row}][${update.column}]`)
              else cellUpdates.push(update)
            }
            if (conflicts.length) throw new HttpError(409, 'Collaborators changed overlapping content during replace-all.', { current: serializeDocument(latest), conflicts })
            mergedDocReplaceBlocks = blockUpdates
            mergedDocReplaceCells = cellUpdates
          } else if (body.type === 'design.element.patch') {
            const baseElement = basePage.elements?.find(element => element?.id === elementId)
            const currentElement = page.elements?.find(element => element?.id === elementId)
            if (!baseElement || !currentElement || baseElement.type !== currentElement.type || !validateElementPatch(currentElement)) throw new HttpError(409, 'The design element changed or was removed.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].elements[${elementId}]`] })
            const conflictingProperties = Object.keys(body.patch).filter(key => key !== 'text'
              && JSON.stringify(baseElement[key]) !== JSON.stringify(currentElement[key])
              && JSON.stringify(currentElement[key]) !== JSON.stringify(body.patch[key]))
            if (conflictingProperties.length) throw new HttpError(409, 'Collaborators changed the same design properties.', { current: serializeDocument(latest), conflicts: conflictingProperties.map(key => `pages[${pageId}].elements[${elementId}].${key}`) })
            const merged = mergeConcurrentDocuments(baseElement, { ...baseElement, ...body.patch }, currentElement)
            if (!merged.ok) throw new HttpError(409, 'Collaborators changed the same design properties.', { current: serializeDocument(latest), conflicts: merged.conflicts.map(path => `pages[${pageId}].elements[${elementId}].${path}`) })
            mergedDesignElement = merged.value
          } else if (body.type === 'design.elements.create') {
            const currentIds = new Set((page.elements ?? []).map(element => element.id))
            const groupIds = new Set((page.groups ?? []).map(group => group.id))
            const connectorIds = new Set((page.connectors ?? []).map(connector => connector.id))
            const collisions = body.elements.filter(element => currentIds.has(element.id)).map(element => `pages[${pageId}].elements[${element.id}]`)
            collisions.push(...(body.groups ?? []).filter(group => groupIds.has(group.id)).map(group => `pages[${pageId}].groups[${group.id}]`))
            collisions.push(...(body.connectors ?? []).filter(connector => connectorIds.has(connector.id)).map(connector => `pages[${pageId}].connectors[${connector.id}]`))
            if (collisions.length) throw new HttpError(409, 'An element with the same ID was created in another session.', { current: serializeDocument(latest), conflicts: collisions })
            const resultingIds = new Set([...currentIds, ...body.elements.map(element => element.id)])
            const combinedGroups = [...(page.groups ?? []), ...(body.groups ?? [])]
            if (combinedGroups.some(group => group.elementIds.some(id => !resultingIds.has(id))) || new Set(combinedGroups.flatMap(group => group.elementIds)).size !== combinedGroups.reduce((size, group) => size + group.elementIds.length, 0)) throw new HttpError(400, 'Created groups must reference existing ungrouped elements.')
            if ((body.connectors ?? []).some(connector => !resultingIds.has(connector.fromId) || !resultingIds.has(connector.toId))) throw new HttpError(400, 'Created connectors must reference existing elements.')
          } else if (body.type === 'design.connector.create') {
            const baseIds = new Set((basePage.elements ?? []).map(element => element.id))
            if (!baseIds.has(body.connector.fromId) || !baseIds.has(body.connector.toId)) throw new HttpError(409, 'A connector endpoint was created after the base revision.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].connectors[${body.connector.id}]`] })
          } else if (body.type === 'design.connector.patch') {
            const baseConnector = (basePage.connectors ?? []).find(connector => connector.id === body.connectorId)
            const currentConnector = (page.connectors ?? []).find(connector => connector.id === body.connectorId)
            if (!baseConnector || !currentConnector) throw new HttpError(409, 'The connector changed or was removed.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].connectors[${body.connectorId}]`] })
            const conflicts = Object.keys(body.patch).filter(key => JSON.stringify(baseConnector[key]) !== JSON.stringify(currentConnector[key]) && JSON.stringify(currentConnector[key]) !== JSON.stringify(body.patch[key]))
            if (conflicts.length) throw new HttpError(409, 'Collaborators changed the same connector properties.', { current: serializeDocument(latest), conflicts: conflicts.map(key => `pages[${pageId}].connectors[${body.connectorId}].${key}`) })
            mergedDesignConnector = { ...currentConnector, ...body.patch }
            for (const key of ['fromAnchor', 'toAnchor']) if (body.patch[key] === null) delete mergedDesignConnector[key]
            const elementIds = new Set((page.elements ?? []).map(element => element.id))
            if (!validDesignConnector(mergedDesignConnector) || mergedDesignConnector.fromId === mergedDesignConnector.toId || !elementIds.has(mergedDesignConnector.fromId) || !elementIds.has(mergedDesignConnector.toId)) throw new HttpError(409, 'Connector endpoints must reference distinct elements on this page.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].connectors[${body.connectorId}]`] })
          } else if (body.type === 'design.elements.delete') {
            const conflicts = []
            for (const id of body.elementIds) {
              const baseElement = basePage.elements?.find(element => element?.id === id)
              const currentElement = page.elements?.find(element => element?.id === id)
              if (!baseElement || !currentElement || JSON.stringify(baseElement) !== JSON.stringify(currentElement)) conflicts.push(`pages[${pageId}].elements[${id}]`)
            }
            if (conflicts.length) throw new HttpError(409, 'An element changed or was removed in another session.', { current: serializeDocument(latest), conflicts })
            deletedDesignElements = new Set(body.elementIds)
          } else if (body.type === 'design.groups.set') {
            const previousGroups = basePage.groups ?? []
            const currentGroups = page.groups ?? []
            if (JSON.stringify(previousGroups) !== JSON.stringify(currentGroups) && JSON.stringify(currentGroups) !== JSON.stringify(body.groups)) throw new HttpError(409, 'Collaborators changed whiteboard groups.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].groups`] })
            const elementIds = new Set((page.elements ?? []).map(element => element.id))
            if (body.groups.some(group => group.elementIds.some(id => !elementIds.has(id)))) throw new HttpError(400, 'Groups must reference existing elements.')
          } else if (body.type === 'design.elements.reorder') {
            const previousOrder = (basePage.elements ?? []).map(element => element.id)
            const currentOrder = (page.elements ?? []).map(element => element.id)
            if (body.baseRevision !== latest.revision && JSON.stringify(previousOrder) !== JSON.stringify(currentOrder)) throw new HttpError(409, 'Collaborators reordered design elements.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].elements.order`] })
            if (body.elementIds.length !== currentOrder.length || new Set(body.elementIds).size !== currentOrder.length || body.elementIds.some(id => !currentOrder.includes(id))) throw new HttpError(409, 'The element list changed before reordering.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].elements.order`] })
            rebasedDesignOrder = body.elementIds
          } else if (body.type === 'design.page.insert') {
            if (body.sourcePageId) {
              const baseSource = JSON.parse(base.data_json).pages?.find(item => item?.id === body.sourcePageId)
              const currentSource = latestData.pages?.find(item => item?.id === body.sourcePageId)
              if (!baseSource || !currentSource || JSON.stringify(baseSource) !== JSON.stringify(currentSource)) throw new HttpError(409, 'The source page changed since it was duplicated.', { current: serializeDocument(latest), conflicts: [`pages[${body.sourcePageId}]`] })
            }
          } else if (body.type === 'design.page.delete') {
            const baseTarget = JSON.parse(base.data_json).pages?.find(item => item?.id === body.targetPageId)
            const currentTarget = latestData.pages?.find(item => item?.id === body.targetPageId)
            if (!baseTarget || !currentTarget || JSON.stringify(baseTarget) !== JSON.stringify(currentTarget)) throw new HttpError(409, 'The page changed since it was selected for deletion.', { current: serializeDocument(latest), conflicts: [`pages[${body.targetPageId}]`] })
          } else if (body.type === 'design.pages.reorder') {
            const baseOrder = (JSON.parse(base.data_json).pages ?? []).map(item => item.id)
            const currentOrder = (latestData.pages ?? []).map(item => item.id)
            if (JSON.stringify(baseOrder) !== JSON.stringify(currentOrder)) throw new HttpError(409, 'Collaborators changed the page list or order.', { current: serializeDocument(latest), conflicts: ['pages.order'] })
            rebasedPageOrder = body.pageIds
          } else if (body.type === 'design.page.notes.set') {
            const baseNotesPage = JSON.parse(base.data_json).pages?.find(item => item?.id === pageId)
            const currentNotesPage = latestData.pages?.find(item => item?.id === pageId)
            if (!baseNotesPage || !currentNotesPage) throw new HttpError(409, 'The presentation slide was removed.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].presenterNotes`] })
            const merged = mergeConcurrentDocuments({ notes: baseNotesPage.presenterNotes ?? '' }, { notes: body.notes }, { notes: currentNotesPage.presenterNotes ?? '' })
            if (!merged.ok) throw new HttpError(409, 'Collaborators edited overlapping presenter notes.', { current: serializeDocument(latest), conflicts: merged.conflicts.map(path => `pages[${pageId}].presenterNotes${path === 'notes' ? '' : `.${path}`}`) })
            mergedPresenterNotes = merged.value.notes
          } else if (body.type === 'design.page.patch') {
            const baseTargetPage = JSON.parse(base.data_json).pages?.find(item => item?.id === pageId)
            const currentTargetPage = latestData.pages?.find(item => item?.id === pageId)
            if (!baseTargetPage || !currentTargetPage) throw new HttpError(409, 'The page was removed.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}]`] })
            const conflictingFields = Object.keys(body.patch).filter(key => JSON.stringify(baseTargetPage[key]) !== JSON.stringify(currentTargetPage[key]) && JSON.stringify(currentTargetPage[key]) !== JSON.stringify(body.patch[key]))
            if (conflictingFields.length) throw new HttpError(409, 'Collaborators changed the same page properties.', { current: serializeDocument(latest), conflicts: conflictingFields.map(key => `pages[${pageId}].${key}`) })
            mergedDesignPagePatch = body.patch
          } else if (body.type === 'sheet.merge.set' || body.type === 'sheet.merge.remove') {
            const oldMerges = basePage.cellMerges ?? []
            const currentMerges = page.cellMerges ?? []
            if (body.type === 'sheet.merge.set') {
              const candidate = body.merge
              const candidateRowSpan = candidate.rowSpan ?? 1
              const overlaps = merge => candidate.row < merge.row + (merge.rowSpan ?? 1) && merge.row < candidate.row + candidateRowSpan && candidate.column < merge.column + merge.colSpan && candidate.column + candidate.colSpan > merge.column
              const rangeChanged = JSON.stringify(oldMerges.filter(overlaps)) !== JSON.stringify(currentMerges.filter(overlaps))
              const cellsChanged = Array.from({ length: candidateRowSpan }, (_, rowOffset) => Array.from({ length: candidate.colSpan }, (_, columnOffset) => ({ row: candidate.row + rowOffset, column: candidate.column + columnOffset }))).flat().filter(cell => cell.row !== candidate.row || cell.column !== candidate.column).some(cell => (basePage.cells?.[cell.row]?.[cell.column] ?? '') !== (page.cells?.[cell.row]?.[cell.column] ?? ''))
              if (rangeChanged || cellsChanged) throw new HttpError(409, 'The selected range changed in another session.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].cellMerges[${candidate.row}:${candidate.column}]`] })
            } else {
              const oldMerge = oldMerges.find(merge => body.row >= merge.row && body.row < merge.row + (merge.rowSpan ?? 1) && body.column >= merge.column && body.column < merge.column + merge.colSpan)
              const currentMerge = currentMerges.find(merge => body.row >= merge.row && body.row < merge.row + (merge.rowSpan ?? 1) && body.column >= merge.column && body.column < merge.column + merge.colSpan)
              if (!oldMerge || !currentMerge || oldMerge.row !== currentMerge.row || oldMerge.column !== currentMerge.column || oldMerge.colSpan !== currentMerge.colSpan || (oldMerge.rowSpan ?? 1) !== (currentMerge.rowSpan ?? 1)) throw new HttpError(409, 'The merged range changed in another session.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].cellMerges[${body.row}:${body.column}]`] })
            }
          }
        }
        const nextData = structuredClone(latestData)
        const targetPage = nextData.pages.find(item => item.id === pageId)
        if (body.type === 'design.element.patch') {
          const targetElementIndex = targetPage.elements?.findIndex(element => element?.id === elementId) ?? -1
          if (targetElementIndex < 0) throw new HttpError(404, 'Design element not found.')
          const targetElement = targetPage.elements[targetElementIndex]
          if (!validateElementPatch(targetElement)) throw new HttpError(400, 'Invalid patch for this design element type.')
          targetPage.elements[targetElementIndex] = { ...targetElement, ...(mergedDesignElement ?? body.patch) }
        } else if (body.type === 'design.elements.create') {
          const ids = new Set((targetPage.elements ?? []).map(element => element.id))
          if (body.elements.some(element => ids.has(element.id))) throw new HttpError(409, 'An element with the same ID already exists.', { current: serializeDocument(latest) })
          targetPage.elements = [...(targetPage.elements ?? []), ...body.elements]
          if (body.groups?.length) targetPage.groups = [...(targetPage.groups ?? []), ...body.groups]
          if (body.connectors?.length) targetPage.connectors = [...(targetPage.connectors ?? []), ...body.connectors]
        } else if (body.type === 'design.elements.delete') {
          const removed = deletedDesignElements ?? new Set(body.elementIds)
          if ([...removed].some(id => !(targetPage.elements ?? []).some(element => element.id === id))) throw new HttpError(409, 'An element was already removed.', { current: serializeDocument(latest), conflicts: [...removed].map(id => `pages[${pageId}].elements[${id}]`) })
          targetPage.elements = (targetPage.elements ?? []).filter(element => !removed.has(element.id))
          targetPage.groups = (targetPage.groups ?? []).flatMap(group => {
            const elementIds = group.elementIds.filter(id => !removed.has(id))
            return elementIds.length > 1 ? [{ ...group, elementIds }] : []
          })
          targetPage.connectors = (targetPage.connectors ?? []).filter(connector => !removed.has(connector.fromId) && !removed.has(connector.toId))
        } else if (body.type === 'design.groups.set') {
          targetPage.groups = body.groups
        } else if (body.type === 'design.elements.reorder') {
          const elementById = new Map((targetPage.elements ?? []).map(element => [element.id, element]))
          targetPage.elements = (rebasedDesignOrder ?? body.elementIds).map(id => elementById.get(id))
        } else if (body.type === 'design.page.insert') {
          const anchorIndex = nextData.pages.findIndex(item => item.id === body.afterPageId)
          if (anchorIndex < 0 || nextData.pages.some(item => item.id === body.page.id)) throw new HttpError(409, 'The page insertion target changed.', { current: serializeDocument(latest) })
          nextData.pages.splice(anchorIndex + 1, 0, body.page)
        } else if (body.type === 'design.page.delete') {
          const targetIndex = nextData.pages.findIndex(item => item.id === body.targetPageId)
          if (targetIndex < 0 || nextData.pages.length <= 1) throw new HttpError(409, 'The page cannot be deleted.', { current: serializeDocument(latest) })
          nextData.pages.splice(targetIndex, 1)
        } else if (body.type === 'design.pages.reorder') {
          const pageById = new Map(nextData.pages.map(item => [item.id, item]))
          nextData.pages = (rebasedPageOrder ?? body.pageIds).map(id => pageById.get(id))
        } else if (body.type === 'design.page.notes.set') {
          targetPage.presenterNotes = mergedPresenterNotes ?? body.notes
        } else if (body.type === 'design.page.patch') {
          Object.assign(targetPage, mergedDesignPagePatch ?? body.patch)
        } else if (body.type === 'design.video.clip.create') {
          if (body.clip.startMs + body.clip.durationMs > videoTimelineDurationMs) throw new HttpError(400, 'The timeline clip extends past the project duration.')
          if ((targetPage.timelineClips ?? []).some(clip => clip.id === body.clip.id)) throw new HttpError(409, 'A timeline clip with the same ID already exists.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].timelineClips[${body.clip.id}]`] })
          targetPage.timelineClips = [...(targetPage.timelineClips ?? []), body.clip]
        } else if (body.type === 'design.video.clip.patch') {
          const index = (targetPage.timelineClips ?? []).findIndex(clip => clip.id === body.clipId)
          if (index < 0) throw new HttpError(409, 'The timeline clip was removed.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].timelineClips[${body.clipId}]`] })
          const updatedClip = { ...(mergedVideoTimelineClip ?? targetPage.timelineClips[index]), ...body.patch }
          if (body.patch.opacityKeyframes !== undefined && !validVideoOpacityKeyframes(body.patch.opacityKeyframes, updatedClip.durationMs)) throw new HttpError(400, 'Video opacity keyframes must fall within the clip duration.')
          if (body.patch.transformKeyframes !== undefined && !validVideoTransformKeyframes(body.patch.transformKeyframes, updatedClip.durationMs)) throw new HttpError(400, 'Video transform keyframes must fall within the clip duration.')
          if (!validVideoTimelineClip(updatedClip)) throw new HttpError(400, 'The updated timeline clip is invalid.')
          if (updatedClip.startMs + updatedClip.durationMs > videoTimelineDurationMs) throw new HttpError(400, 'The timeline clip extends past the project duration.')
          targetPage.timelineClips[index] = updatedClip
        } else if (body.type === 'design.video.clip.delete') {
          const index = (targetPage.timelineClips ?? []).findIndex(clip => clip.id === body.clipId)
          if (index < 0) throw new HttpError(409, 'The timeline clip was already removed.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].timelineClips[${body.clipId}]`] })
          if (body.baseRevision !== latest.revision && !deletedVideoTimelineClip) throw new HttpError(409, 'The timeline clip changed before it could be removed.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].timelineClips[${body.clipId}]`] })
          targetPage.timelineClips.splice(index, 1)
        } else if (body.type === 'design.connector.create') {
          targetPage.connectors = [...(targetPage.connectors ?? []), body.connector]
        } else if (body.type === 'design.connector.patch') {
          const connectorIndex = (targetPage.connectors ?? []).findIndex(connector => connector.id === body.connectorId)
          if (connectorIndex < 0) throw new HttpError(409, 'The connector was removed.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].connectors[${body.connectorId}]`] })
          const updatedConnector = { ...(mergedDesignConnector ?? targetPage.connectors[connectorIndex]), ...body.patch }
          for (const key of ['fromAnchor', 'toAnchor']) if (body.patch[key] === null) delete updatedConnector[key]
          targetPage.connectors[connectorIndex] = updatedConnector
        } else if (body.type === 'sheet.cells.set') {
          targetPage.cells ??= []
          for (const cell of cells) {
            while (targetPage.cells.length <= cell.row) targetPage.cells.push([])
            while (targetPage.cells[cell.row].length <= cell.column) targetPage.cells[cell.row].push('')
            targetPage.cells[cell.row][cell.column] = cell.value
          }
        } else if (body.type === 'sheet.formats.set') {
          targetPage.cellFormats ??= {}
          for (const cell of formats) {
            const key = `${cell.row}:${cell.column}`
            if (cell.value === 'default') delete targetPage.cellFormats[key]
            else targetPage.cellFormats[key] = cell.value
          }
        } else if (body.type === 'doc.table.cell.set') {
          const targetBlock = targetPage.blocks?.find(block => block?.id === blockId && block.type === 'table')
          if (!targetBlock) throw new HttpError(404, 'Table block not found.')
          targetBlock.cells ??= []
          while (targetBlock.cells.length <= body.row) targetBlock.cells.push([])
          while (targetBlock.cells[body.row].length <= body.column) targetBlock.cells[body.row].push('')
          targetBlock.cells[body.row][body.column] = body.value
        } else if (body.type === 'doc.table.structure') {
          const targetBlock = targetPage.blocks?.find(block => block?.id === blockId && block.type === 'table')
          if (!targetBlock) throw new HttpError(404, 'Table block not found.')
          const sourceCells = targetBlock.cells ?? []
          const width = Math.max(1, ...sourceCells.map(row => row.length))
          const rectangular = (sourceCells.length ? sourceCells : [[]]).map(row => Array.from({ length: width }, (_, column) => row[column] ?? ''))
          const merges = targetBlock.merges ?? []
          const shiftBorders = (axis, index) => Object.fromEntries(Object.entries(targetBlock.cellBorders ?? {}).flatMap(([coordinate, borders]) => {
            const [row, column] = coordinate.split(':').map(Number)
            const value = axis === 'row' ? row : column
            if (value === index) return []
            return [[axis === 'row' ? `${value > index ? value - 1 : value}:${column}` : `${row}:${value > index ? value - 1 : value}`, borders]]
          }))
          const shiftCellImages = (axis, index) => Object.fromEntries(Object.entries(targetBlock.cellImages ?? {}).flatMap(([coordinate, images]) => {
            const [row, column] = coordinate.split(':').map(Number)
            const value = axis === 'row' ? row : column
            if (value === index) return []
            return [[axis === 'row' ? `${value > index ? value - 1 : value}:${column}` : `${row}:${value > index ? value - 1 : value}`, images]]
          }))
          if (body.action === 'row.move') {
            const { from, to } = body
            if (from >= rectangular.length || to >= rectangular.length || Math.abs(from - to) !== 1) throw new HttpError(409, 'The selected table rows can no longer be moved.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks[${blockId}].rows[${from}:${to}]`] })
            const [moved] = rectangular.splice(from, 1)
            rectangular.splice(to, 0, moved)
            const rowAfterMove = row => row === from ? to : from < to && row > from && row <= to ? row - 1 : from > to && row >= to && row < from ? row + 1 : row
            targetBlock.cells = rectangular
            targetBlock.merges = merges.map(merge => ({ ...merge, row: rowAfterMove(merge.row) })).sort((left, right) => left.row - right.row || left.column - right.column)
            if (targetBlock.cellBorders) targetBlock.cellBorders = Object.fromEntries(Object.entries(targetBlock.cellBorders).map(([coordinate, borders]) => {
              const [row, column] = coordinate.split(':').map(Number)
              return [`${rowAfterMove(row)}:${column}`, borders]
            }))
            if (targetBlock.cellImages) targetBlock.cellImages = Object.fromEntries(Object.entries(targetBlock.cellImages).map(([coordinate, images]) => {
              const [row, column] = coordinate.split(':').map(Number)
              return [`${rowAfterMove(row)}:${column}`, images]
            }))
          } else if (body.action === 'row.append') {
            if (rectangular.length >= 1000) throw new HttpError(400, 'The table already has the maximum number of rows.')
            targetBlock.cells = [...rectangular, Array.from({ length: width }, () => '')]
          } else if (body.action === 'column.append') {
            if (width >= 200) throw new HttpError(400, 'The table already has the maximum number of columns.')
            targetBlock.cells = rectangular.map(row => [...row, ''])
          } else if (body.action === 'row.delete') {
            if (rectangular.length <= 1 || body.row >= rectangular.length || merges.some(merge => merge.row === body.row)) throw new HttpError(409, 'The table row cannot be deleted while it is empty, missing, or merged.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks[${blockId}].rows[${body.row}]`] })
            targetBlock.cells = rectangular.filter((_, index) => index !== body.row)
            targetBlock.merges = merges.flatMap(merge => merge.row === body.row ? [] : [merge.row > body.row ? { ...merge, row: merge.row - 1 } : merge])
            if (targetBlock.cellBorders) targetBlock.cellBorders = shiftBorders('row', body.row)
            if (targetBlock.cellImages) targetBlock.cellImages = shiftCellImages('row', body.row)
          } else if (body.action === 'column.delete') {
            if (width <= 1 || body.column >= width || merges.some(merge => body.column >= merge.column && body.column < merge.column + merge.colSpan)) throw new HttpError(409, 'The table column cannot be deleted while it is missing or merged.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks[${blockId}].columns[${body.column}]`] })
            targetBlock.cells = rectangular.map(row => row.filter((_, index) => index !== body.column))
            targetBlock.merges = merges.flatMap(merge => body.column < merge.column ? [{ ...merge, column: merge.column - 1 }] : body.column > merge.column + merge.colSpan - 1 ? [merge] : merge.colSpan > 2 ? [{ ...merge, colSpan: merge.colSpan - 1 }] : [])
            if (targetBlock.cellBorders) targetBlock.cellBorders = shiftBorders('column', body.column)
            if (targetBlock.cellImages) targetBlock.cellImages = shiftCellImages('column', body.column)
          } else if (body.action === 'merge') {
            const rowSpan = body.rowSpan ?? 1
            const overlaps = merges.some(merge => body.row < merge.row + (merge.rowSpan ?? 1) && merge.row < body.row + rowSpan && body.column < merge.column + merge.colSpan && merge.column < body.column + body.colSpan)
            if (body.row + rowSpan > rectangular.length || body.column + body.colSpan > width || overlaps) throw new HttpError(409, 'The selected table cells cannot be merged.', { current: serializeDocument(latest), conflicts: ['table.merges'] })
            const mergedText = Array.from({ length: rowSpan }, (_, rowOffset) => rectangular[body.row + rowOffset].slice(body.column, body.column + body.colSpan).join('\n')).join('\n')
            for (let row = body.row; row < body.row + rowSpan; row += 1) for (let column = body.column; column < body.column + body.colSpan; column += 1) rectangular[row][column] = ''
            rectangular[body.row][body.column] = mergedText
            targetBlock.cells = rectangular
            targetBlock.merges = [...merges, { row: body.row, column: body.column, colSpan: body.colSpan, ...(rowSpan > 1 ? { rowSpan } : {}) }].sort((left, right) => left.row - right.row || left.column - right.column)
          } else if (body.action === 'unmerge') {
            const merge = merges.find(item => body.row >= item.row && body.row < item.row + (item.rowSpan ?? 1) && body.column >= item.column && body.column < item.column + item.colSpan)
            if (!merge) throw new HttpError(409, 'The selected table cells are no longer merged.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks[${blockId}].merges[${body.row}:${body.column}]`] })
            targetBlock.merges = merges.filter(item => item !== merge)
          }
        } else if (body.type === 'doc.block.text.set') {
          const targetBlock = targetPage.blocks?.find(block => block?.id === blockId && block.type !== 'table' && block.type !== 'image')
          if (!targetBlock) throw new HttpError(404, 'Text block not found.')
          targetBlock.text = mergedTextBlock?.text ?? body.text
          targetBlock.marks = mergedTextBlock?.marks ?? body.marks
        } else if (body.type === 'doc.block.insert') {
          const targetBlocks = targetPage.blocks ??= []
          const anchorIndex = body.afterBlockId === null ? -1 : targetBlocks.findIndex(block => block.id === body.afterBlockId)
          if (body.afterBlockId !== null && anchorIndex < 0) throw new HttpError(409, 'The insertion anchor block was removed.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks[${body.afterBlockId}]`] })
          targetBlocks.splice(anchorIndex + 1, 0, body.block)
        } else if (body.type === 'doc.blocks.insert') {
          const targetBlocks = targetPage.blocks ??= []
          if (body.replaceEmptyBlockId) {
            const placeholderIndex = targetBlocks.findIndex(block => block.id === body.replaceEmptyBlockId)
            if (placeholderIndex < 0) throw new HttpError(409, 'The blank paragraph changed before the import could be applied.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks[${body.replaceEmptyBlockId}]`] })
            targetBlocks.splice(placeholderIndex, 1, ...body.blocks)
          } else {
            const anchorIndex = body.afterBlockId === null ? -1 : targetBlocks.findIndex(block => block.id === body.afterBlockId)
            if (body.afterBlockId !== null && anchorIndex < 0) throw new HttpError(409, 'The insertion anchor block was removed.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks[${body.afterBlockId}]`] })
            targetBlocks.splice(anchorIndex + 1, 0, ...body.blocks)
          }
        } else if (body.type === 'doc.block.delete') {
          const blockIndex = targetPage.blocks?.findIndex(block => block.id === blockId) ?? -1
          if (blockIndex < 0 || (targetPage.blocks?.length ?? 0) <= 1) throw new HttpError(409, 'The block cannot be deleted.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks[${blockId}]`] })
          targetPage.blocks.splice(blockIndex, 1)
        } else if (body.type === 'doc.block.type.set') {
          const targetBlock = targetPage.blocks?.find(block => block.id === blockId)
          if (!targetBlock || targetBlock.type === 'table') throw new HttpError(404, 'Text block not found.')
          targetBlock.type = body.blockType
        } else if (body.type === 'doc.blocks.reorder') {
          const blockById = new Map((targetPage.blocks ?? []).map(block => [block.id, block]))
          if (body.blockIds.length !== blockById.size || body.blockIds.some(id => !blockById.has(id))) throw new HttpError(409, 'The block list changed before reordering.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks.order`] })
          targetPage.blocks = (rebasedDocBlockOrder ?? body.blockIds).map(id => blockById.get(id))
        } else if (body.type === 'doc.replace.apply') {
          targetPage.blocks ??= []
          for (const update of body.blocks) {
            const targetBlock = targetPage.blocks.find(block => block.id === update.blockId && block.type !== 'table')
            const mergedBlock = mergedDocReplaceBlocks?.get(update.blockId)
            if (!targetBlock) throw new HttpError(409, 'A text block changed during replace-all.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks[${update.blockId}]`] })
            targetBlock.text = mergedBlock?.text ?? update.text
            targetBlock.marks = mergedBlock?.marks ?? update.marks
          }
          for (const update of mergedDocReplaceCells ?? body.cells) {
            const targetBlock = targetPage.blocks.find(block => block.id === update.blockId && block.type === 'table')
            if (!targetBlock) throw new HttpError(409, 'A table changed during replace-all.', { current: serializeDocument(latest), conflicts: [`pages[${pageId}].blocks[${update.blockId}]`] })
            targetBlock.cells ??= []
            while (targetBlock.cells.length <= update.row) targetBlock.cells.push([])
            while (targetBlock.cells[update.row].length <= update.column) targetBlock.cells[update.row].push('')
            targetBlock.cells[update.row][update.column] = update.value
          }
        } else if (body.type === 'sheet.merge.set') {
          const merge = body.merge
          const mergeRowSpan = merge.rowSpan ?? 1
          const overlaps = (targetPage.cellMerges ?? []).some(item => merge.row < item.row + (item.rowSpan ?? 1) && item.row < merge.row + mergeRowSpan && merge.column < item.column + item.colSpan && item.column < merge.column + merge.colSpan)
          const occupied = Array.from({ length: mergeRowSpan }, (_, rowOffset) => Array.from({ length: merge.colSpan }, (_, columnOffset) => ({ row: merge.row + rowOffset, column: merge.column + columnOffset }))).flat().filter(cell => cell.row !== merge.row || cell.column !== merge.column).some(cell => (targetPage.cells?.[cell.row]?.[cell.column] ?? '') !== '')
          if (overlaps || occupied) throw new HttpError(400, 'Merge requires an empty contiguous range without overlap.')
          targetPage.cells ??= []
          while (targetPage.cells.length < merge.row + mergeRowSpan) targetPage.cells.push([])
          for (let row = merge.row; row < merge.row + mergeRowSpan; row += 1) while (targetPage.cells[row].length < merge.column + merge.colSpan) targetPage.cells[row].push('')
          targetPage.cellMerges = [...(targetPage.cellMerges ?? []), merge].sort((left, right) => left.row - right.row || left.column - right.column)
        } else if (body.type === 'sheet.rows.append') {
          const sheetCells = targetPage.cells ?? Array.from({ length: 30 }, () => Array.from({ length: 12 }, () => ''))
          if (sheetCells.length >= 1000) throw new HttpError(400, 'The spreadsheet already has the maximum number of rows.')
          const columnCount = Math.max(12, ...sheetCells.map(row => row.length))
          targetPage.cells = [...sheetCells, Array.from({ length: columnCount }, () => '')]
        } else if (body.type === 'sheet.columns.append') {
          const sheetCells = targetPage.cells ?? Array.from({ length: 30 }, () => Array.from({ length: 12 }, () => ''))
          const columnCount = Math.max(12, ...sheetCells.map(row => row.length))
          if (columnCount >= 200) throw new HttpError(400, 'The spreadsheet already has the maximum number of columns.')
          targetPage.cells = sheetCells.map(row => [...Array.from({ length: columnCount }, (_, column) => row[column] ?? ''), ''])
          } else if (body.type === 'sheet.chart.set') {
            const existing = targetPage.charts ?? []
            const chartIndex = existing.findIndex(chart => chart.id === body.chartId)
            if (chartIndex < 0 && body.chart === null) throw new HttpError(404, 'Chart not found.')
            if (chartIndex < 0) targetPage.charts = [...existing, body.chart]
            else targetPage.charts = body.chart ? existing.map(chart => chart.id === body.chartId ? body.chart : chart) : existing.filter(chart => chart.id !== body.chartId)
        } else {
          const currentMerge = (targetPage.cellMerges ?? []).find(merge => body.row >= merge.row && body.row < merge.row + (merge.rowSpan ?? 1) && body.column >= merge.column && body.column < merge.column + merge.colSpan)
          if (!currentMerge) throw new HttpError(404, 'No merged range exists at this cell.')
          targetPage.cellMerges = targetPage.cellMerges.filter(merge => merge !== currentMerge)
        }
        const revision = latest.revision + 1
        const updatedAt = new Date().toISOString()
        nextData.updatedAt = updatedAt
        const dataJson = JSON.stringify(normalizeDocumentMediaReferences(documentId, nextData, false))
        database.exec('BEGIN IMMEDIATE')
        try {
          const saved = database.prepare('UPDATE documents SET data_json = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?').run(dataJson, revision, updatedAt, documentId, latest.revision)
          if (saved.changes !== 1) {
            database.exec('ROLLBACK')
            throw new HttpError(409, 'A planilha mudou durante a operação. Tente novamente.')
          }
          database.prepare('INSERT INTO document_versions (document_id, revision, name, data_json, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(documentId, revision, latest.name, dataJson, updatedAt, user.id)
          database.prepare('DELETE FROM document_versions WHERE document_id = ? AND revision <= ?').run(documentId, revision - 100)
          database.prepare('INSERT INTO document_operations (operation_id, document_id, revision, result_json) VALUES (?, ?, ?, ?)').run(operationId, documentId, revision, JSON.stringify({ revision }))
          database.prepare('DELETE FROM document_operations WHERE document_id = ? AND revision <= ?').run(documentId, revision - 100)
          database.exec('COMMIT')
        } catch (error) {
          if (database.isTransaction) database.exec('ROLLBACK')
          throw error
        }
        const savedDocument = { ...normalizeDocumentMediaReferences(documentId, nextData, true), id: documentId, name: latest.name, updatedAt }
        if (access.team_id) recordAudit({ user, action: 'document.operation', targetType: 'document', targetId: documentId, details: { operation: body.type, revision }, teamId: access.team_id, documentId })
        publishDocument(documentId, { type: 'document.updated', revision, operationId })
        publishDocument(documentId, { type: isSheetOperation ? 'sheet.operation.updated' : 'document.operation.updated', revision, operationId, pageId, operation: body.type, userId: user.id, name: user.name })
        if (body.type === 'sheet.cells.set') publishDocument(documentId, { type: 'sheet.cells.updated', revision, operationId, pageId, cells, userId: user.id, name: user.name })
        return sendJson(response, 200, { revision, document: savedDocument, duplicate: false })
      }

      if (subresource === 'presentation' && method === 'POST') {
        const body = await readJson(request)
        const data = JSON.parse(access.data_json)
        if (data.type !== 'presentation') throw new HttpError(400, 'Este projeto não é uma apresentação.')
        const pageIndex = body.pageIndex
        if (pageIndex !== null && (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= (Array.isArray(data.pages) ? data.pages.length : 0))) {
          throw new HttpError(400, 'O slide da apresentação é inválido.')
        }
        const wasPresenting = activePresentations.get(documentId)?.has(user.id) ?? false
        if (pageIndex === null) clearPresentation(documentId, user.id)
        else {
          const presentations = activePresentations.get(documentId) ?? new Map()
          const currentPresenter = [...presentations.entries()].find(([userId]) => userId !== user.id)
          if (currentPresenter) throw new HttpError(409, `${currentPresenter[1].name} já está apresentando este projeto.`)
          presentations.set(user.id, { name: user.name, pageIndex })
          activePresentations.set(documentId, presentations)
          publishDocument(documentId, { type: 'presentation.updated', userId: user.id, name: user.name, presenting: true, pageIndex })
        }
        if (access.team_id && (pageIndex !== null || wasPresenting)) recordAudit({ user, action: pageIndex === null ? 'document.presentation.ended' : wasPresenting ? 'document.presentation.slide_changed' : 'document.presentation.started', targetType: 'presentation', targetId: documentId, details: { pageIndex }, teamId: access.team_id, documentId })
        return sendJson(response, 200, { ok: true })
      }

      if (!subresource && method === 'GET') return sendJson(response, 200, serializeDocument(access))

      if (!subresource && method === 'PUT') {
        if (!['owner', 'editor'].includes(access.role)) throw new HttpError(403, 'Voc\u00ea pode visualizar este projeto, mas n\u00e3o edit\u00e1-lo.')
        const body = await readJson(request)
        if (!Number.isInteger(body.revision) || body.revision < 1) throw new HttpError(400, 'Informe a revis\u00e3o atual do documento.')
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        if (name.length < 1 || name.length > 160) throw new HttpError(400, 'Informe um t\u00edtulo com at\u00e9 160 caracteres.')
        if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new HttpError(400, 'Inclua os dados do documento.')
        if (!hasSafeSiteLinks(body.data)) throw new HttpError(400, 'O site cont\u00e9m um link inv\u00e1lido.')
        if (!validDocumentInlineMarks(body.data)) throw new HttpError(400, 'As marcas de formata\u00e7\u00e3o do Docs s\u00e3o inv\u00e1lidas.')
        const latest = documentAccess(documentId, user.id)
        let merged = { name, data: body.data }
        if (body.revision !== latest.revision) {
          const base = database.prepare('SELECT name, data_json FROM document_versions WHERE document_id = ? AND revision = ?').get(documentId, body.revision)
          if (!base) throw new HttpError(409, 'A revis\u00e3o-base expirou; recarregue a vers\u00e3o atual.', { current: serializeDocument(latest) })
          const result = mergeConcurrentDocuments(
            { name: base.name, data: JSON.parse(base.data_json) },
            { name, data: body.data },
            { name: latest.name, data: JSON.parse(latest.data_json) },
          )
          if (!result.ok) throw new HttpError(409, 'As sess\u00f5es alteraram os mesmos campos.', { current: serializeDocument(latest), conflicts: result.conflicts })
          merged = result.value
        }
        const updatedAt = new Date().toISOString()
        const nextRevision = latest.revision + 1
        const mergedJson = JSON.stringify(normalizeDocumentMediaReferences(documentId, merged.data, false))
        database.exec('BEGIN IMMEDIATE')
        try {
          const result = database.prepare('UPDATE documents SET name = ?, data_json = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?')
            .run(merged.name, mergedJson, nextRevision, updatedAt, documentId, latest.revision)
          if (result.changes !== 1) {
            database.exec('ROLLBACK')
            const current = documentAccess(documentId, user.id)
            throw new HttpError(409, 'O projeto mudou em outra sess\u00e3o.', { current: serializeDocument(current) })
          }
          database.prepare('INSERT INTO document_versions (document_id, revision, name, data_json, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
            .run(documentId, nextRevision, merged.name, mergedJson, updatedAt, user.id)
          database.prepare('DELETE FROM document_versions WHERE document_id = ? AND revision <= ?')
            .run(documentId, nextRevision - 100)
          if (latest.team_id) recordAudit({ user, action: 'document.updated', targetType: 'document', targetId: documentId, details: { revision: nextRevision }, teamId: latest.team_id, documentId })
          database.exec('COMMIT')
        } catch (error) {
          try { database.exec('ROLLBACK') } catch {}
          throw error
        }
        const saved = serializeDocument(documentAccess(documentId, user.id))
        publishDocument(documentId, { type: 'document.updated', revision: saved.revision })
        return sendJson(response, 200, saved)
      }

      if (subresource === 'permissions' && method === 'GET') {
        if (access.role !== 'owner') throw new HttpError(403, 'Somente quem criou o projeto pode gerenciar acessos.')
        const rows = database.prepare(`
          SELECT users.id, users.name, users.email, document_permissions.role, document_permissions.created_at AS createdAt
          FROM document_permissions JOIN users ON users.id = document_permissions.user_id
          WHERE document_permissions.document_id = ? ORDER BY users.name
        `).all(documentId)
        return sendJson(response, 200, { permissions: rows })
      }

      if (subresource === 'permissions' && method === 'POST') {
        if (access.role !== 'owner') throw new HttpError(403, 'Somente quem criou o projeto pode gerenciar acessos.')
        const body = await readJson(request)
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
        const role = body.role
        if (!ROLES.has(role)) throw new HttpError(400, 'Escolha visualizador, comentarista ou editor.')
        const target = database.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email)
        if (!target) throw new HttpError(404, 'Não existe uma conta cadastrada com esse e-mail. Nenhum convite foi enviado.')
        if (target.id === user.id) throw new HttpError(400, 'Você já é proprietário deste projeto.')
        const createdAt = new Date().toISOString()
        database.prepare(`
          INSERT INTO document_permissions (document_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(document_id, user_id) DO UPDATE SET role = excluded.role
        `).run(documentId, target.id, role, createdAt)
        const savedPermission = database.prepare('SELECT role, created_at FROM document_permissions WHERE document_id = ? AND user_id = ?').get(documentId, target.id)
        recordAudit({ user, action: 'document.permission.granted', targetType: 'user', targetId: target.id, details: { email: target.email, role: savedPermission.role }, teamId: access.team_id, documentId })
        const effectiveRole = documentAccess(documentId, target.id).role
        publishAccess(documentId, target.id, effectiveRole)
        return sendJson(response, 201, { permission: { ...publicUser(target), role: savedPermission.role, createdAt: savedPermission.created_at } })
      }

      if (subresource.startsWith('permissions/') && method === 'DELETE') {
        if (access.role !== 'owner') throw new HttpError(403, 'Somente quem criou o projeto pode gerenciar acessos.')
        const result = database.prepare('DELETE FROM document_permissions WHERE document_id = ? AND user_id = ?').run(documentId, permissionUserId)
        if (result.changes > 0) recordAudit({ user, action: 'document.permission.revoked', targetType: 'user', targetId: permissionUserId, teamId: access.team_id, documentId })
        if (result.changes > 0) {
          try { publishAccess(documentId, permissionUserId, documentAccess(documentId, permissionUserId).role) }
          catch { revokeSubscriber(documentId, permissionUserId) }
        }
        if (result.changes === 0) throw new HttpError(404, 'A permissão não foi encontrada.')
        return sendJson(response, 200, { ok: true })
      }

      if (subresource === 'invitations' && !invitationId && method === 'GET') {
        if (access.role !== 'owner') throw new HttpError(403, 'Somente quem criou o projeto pode gerenciar convites.')
        const invitations = database.prepare(`
          SELECT id, email, role, created_at AS createdAt, expires_at AS expiresAt,
                 accepted_at AS acceptedAt, revoked_at AS revokedAt
          FROM document_invitations WHERE document_id = ? ORDER BY created_at DESC
        `).all(documentId).map(invitation => ({ ...invitation, expired: !invitation.acceptedAt && !invitation.revokedAt && Date.parse(invitation.expiresAt) <= Date.now() }))
        return sendJson(response, 200, { invitations })
      }

      if (subresource === 'invitations' && !invitationId && method === 'POST') {
        if (access.role !== 'owner') throw new HttpError(403, 'Somente quem criou o projeto pode enviar convites.')
        const body = await readJson(request)
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
        const role = body.role
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new HttpError(400, 'Informe um e-mail válido.')
        if (!ROLES.has(role)) throw new HttpError(400, 'Escolha visualizador, comentarista ou editor.')
        if (email === user.email) throw new HttpError(400, 'Você já é proprietário deste projeto.')
        if (database.prepare('SELECT 1 FROM document_permissions JOIN users ON users.id = document_permissions.user_id WHERE document_permissions.document_id = ? AND users.email = ?').get(documentId, email)) throw new HttpError(409, 'Esta conta já tem acesso. Atualize o papel na lista de pessoas.')
        const now = new Date()
        const createdAt = now.toISOString()
        const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
        database.prepare('UPDATE document_invitations SET revoked_at = ? WHERE document_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= ?').run(createdAt, documentId, email, createdAt)
        const id = randomUUID()
        const token = randomBytes(32).toString('base64url')
        database.prepare('INSERT INTO document_invitations (id, document_id, email, role, token_hash, created_at, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, documentId, email, role, hashToken(token), createdAt, expiresAt, user.id)
        recordAudit({ user, action: 'document.invitation.created', targetType: 'invitation', targetId: id, details: { email, role, expiresAt }, teamId: access.team_id, documentId })
        publishDocument(documentId, { type: 'invitations.updated' })
        const delivery = await sendInvitationEmailSafely({ kind: 'document', email, token, targetName: access.name, inviterName: user.name, roleLabel: role === 'viewer' ? 'visualizador' : role === 'commenter' ? 'comentarista' : 'editor' })
        return sendJson(response, 201, { invitation: { id, email, role, createdAt, expiresAt, token, delivery } })
      }

      if (subresource === 'invitations' && invitationId && method === 'DELETE') {
        if (access.role !== 'owner') throw new HttpError(403, 'Somente quem criou o projeto pode revogar convites.')
        const now = new Date().toISOString()
        const revoked = database.prepare('UPDATE document_invitations SET revoked_at = ? WHERE id = ? AND document_id = ? AND accepted_at IS NULL AND revoked_at IS NULL').run(now, invitationId, documentId)
        if (revoked.changes === 0) throw new HttpError(404, 'Convite pendente não encontrado.')
        publishDocument(documentId, { type: 'invitations.updated' })
        return sendJson(response, 200, { ok: true })
      }

      if (subresource === 'comments' && method === 'GET') {
        const comments = database.prepare(`
          SELECT comments.id, comments.parent_id AS parentId, comments.page_id AS pageId, comments.element_id AS elementId, comments.content, comments.created_at AS createdAt,
                 comments.resolved_at AS resolvedAt, comments.resolved_by AS resolvedBy,
                 users.id AS authorId, users.name AS authorName
          FROM comments JOIN users ON users.id = comments.author_id
          WHERE comments.document_id = ? ORDER BY comments.created_at, comments.id
        `).all(documentId)
        return sendJson(response, 200, { comments })
      }

      if (subresource === 'comments' && commentId && method === 'PATCH') {
        if (!['owner', 'editor', 'commenter'].includes(access.role)) throw new HttpError(403, 'Seu acesso permite visualizar, mas não alterar o estado dos comentários.')
        const body = await readJson(request)
        if (typeof body.resolved !== 'boolean') throw new HttpError(400, 'Informe se a conversa está resolvida.')
        const comment = database.prepare('SELECT id, parent_id FROM comments WHERE id = ? AND document_id = ?').get(commentId, documentId)
        if (!comment || comment.parent_id) throw new HttpError(404, 'A conversa principal não foi encontrada.')
        const resolvedAt = body.resolved ? new Date().toISOString() : null
        const resolvedBy = body.resolved ? user.id : null
        const prior = database.prepare('SELECT resolved_at FROM comments WHERE id = ? AND document_id = ?').get(commentId, documentId)
        const changed = Boolean(prior?.resolved_at) !== body.resolved
        database.prepare('UPDATE comments SET resolved_at = ?, resolved_by = ? WHERE id = ?').run(resolvedAt, resolvedBy, commentId)
        if (changed && access.team_id) recordAudit({ user, action: body.resolved ? 'document.comment.resolved' : 'document.comment.reopened', targetType: 'comment', targetId: commentId, details: { resolved: body.resolved }, teamId: access.team_id, documentId })
        publishDocument(documentId, { type: 'comments.updated' })
        return sendJson(response, 200, { comment: { id: commentId, resolvedAt, resolvedBy } })
      }

      if (subresource === 'comments' && method === 'POST') {
        if (!['owner', 'editor', 'commenter'].includes(access.role)) throw new HttpError(403, 'Seu acesso permite visualizar, mas não comentar.')
        const body = await readJson(request)
        const content = typeof body.content === 'string' ? body.content.trim() : ''
        if (content.length < 1 || content.length > 5000) throw new HttpError(400, 'O comentário precisa ter entre 1 e 5.000 caracteres.')
        const parentId = typeof body.parentId === 'string' ? body.parentId : null
        const parent = parentId ? database.prepare('SELECT id, parent_id, page_id, element_id FROM comments WHERE id = ? AND document_id = ?').get(parentId, documentId) : null
        if (parentId && (!parent || parent.parent_id)) throw new HttpError(400, 'A resposta precisa apontar para um comentário principal deste projeto.')
        const id = randomUUID()
        const createdAt = new Date().toISOString()
        const pageId = parent ? parent.page_id : typeof body.pageId === 'string' ? body.pageId.slice(0, 100) : null
        const elementId = parent ? parent.element_id : typeof body.elementId === 'string' ? body.elementId.slice(0, 100) : null
        database.prepare('INSERT INTO comments (id, document_id, author_id, page_id, element_id, content, created_at, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, documentId, user.id, pageId, elementId, content, createdAt, parentId)
        const mentionedEmails = [...new Set([...content.matchAll(/(?:^|\s)@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g)].map(match => match[1].toLowerCase()))]
        const recipientLookup = database.prepare(`SELECT users.id FROM users JOIN documents ON documents.id = ? LEFT JOIN document_permissions p ON p.document_id = documents.id AND p.user_id = users.id LEFT JOIN team_members tm ON tm.team_id = documents.team_id AND tm.user_id = users.id WHERE lower(users.email) = ? AND (users.id = documents.owner_id OR p.role IN ('viewer', 'commenter', 'editor') OR tm.role IN ('admin', 'member'))`)
        const insertNotification = database.prepare('INSERT OR IGNORE INTO notifications (id, user_id, document_id, comment_id, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        for (const email of mentionedEmails) {
          const recipient = recipientLookup.get(documentId, email)
          if (recipient && recipient.id !== user.id) {
            const notificationId = randomUUID()
            const inserted = insertNotification.run(notificationId, recipient.id, documentId, id, user.id, createdAt)
            if (inserted.changes > 0) publishNotification(recipient.id, notificationId)
          }
        }
        if (access.team_id) recordAudit({ user, action: parentId ? 'document.comment.replied' : 'document.comment.created', targetType: 'comment', targetId: id, details: { parentId, pageId, elementId }, teamId: access.team_id, documentId })
        publishDocument(documentId, { type: 'comments.updated' })
        return sendJson(response, 201, { comment: { id, parentId, pageId, elementId, content, createdAt, authorId: user.id, authorName: user.name } })
      }
    }

    throw new HttpError(404, 'Rota não encontrada.')
  }

  const server = createHttpServer((request, response) => {
    Promise.resolve(handle(request, response)).catch(error => {
      if (response.headersSent) return response.destroy()
      if (error instanceof HttpError) return sendJson(response, error.status, { error: error.message, ...error.extra })
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return sendJson(response, 409, { error: 'Este registro já existe.' })
      console.error('API error:', error)
      return sendJson(response, 500, { error: 'Ocorreu um erro interno.' })
    })
  })

  const closeServer = server.close.bind(server)
  server.close = callback => {
    for (const subscribers of userTeamSubscribers.values()) {
      for (const subscriber of [...subscribers]) {
        removeUserTeamSubscriber(subscriber)
        subscriber.response.end()
      }
    }
    for (const [documentId, subscribers] of documentSubscribers) {
      for (const subscriber of [...subscribers]) {
        removeSubscriber(documentId, subscriber)
        subscriber.response.end()
      }
    }
    for (const subscribers of notificationSubscribers.values()) {
      for (const subscriber of [...subscribers]) {
        removeNotificationSubscriber(subscriber)
        subscriber.response.end()
      }
    }
    for (const [teamId, subscribers] of teamSubscribers) {
      for (const subscriber of [...subscribers]) {
        removeTeamSubscriber(teamId, subscriber)
        subscriber.response.end()
      }
    }
    return closeServer(callback)
  }

  server.on('close', () => {
    if (!closed) {
      closed = true
      database.close()
    }
  })
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 8787)
  const server = createAppServer()
  server.listen(port, '127.0.0.1', () => console.log(`Fuse Studio API ouvindo em http://127.0.0.1:${port}`))
  const shutdown = () => server.close(() => process.exit(0))
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
