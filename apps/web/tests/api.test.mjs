import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppServer } from '../server/index.mjs'

const ORIGIN = 'http://127.0.0.1:5173'

async function startApi(options = {}) {
  const server = createAppServer({ databasePath: ':memory:', allowedOrigins: [ORIGIN], invitationEmailSender: async () => ({ status: 'link-only', reason: 'test-sandbox' }), ...options })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const base = `http://127.0.0.1:${address.port}`
  return {
    server,
    base,
    async request(path, { method = 'GET', body, cookie, origin = ORIGIN } = {}) {
      const headers = { origin }
      if (body !== undefined) headers['content-type'] = 'application/json'
      if (cookie) headers.cookie = cookie
      const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
      const payload = await response.json()
      const setCookie = response.headers.get('set-cookie')
      return { status: response.status, payload, cookie: setCookie?.split(';')[0], setCookie }
    },
    async close() {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    },
  }
}

test('cloud project folders are scoped to accounts and teams, with editor-authorized moves and per-user favorites', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Folder admin', 'folder-admin@example.test')
    const editor = await registerAndLogin(api, 'Folder editor', 'folder-editor@example.test')
    const outsider = await registerAndLogin(api, 'Folder outsider', 'folder-outsider@example.test')
    const team = (await api.request('/api/teams', { method: 'POST', cookie: owner.cookie, body: { name: 'Shared folder team' } })).payload.team
    const invite = (await api.request(`/api/teams/${team.id}/invitations`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email } })).payload.invitation
    assert.equal((await api.request(`/api/team-invitations/${invite.token}`, { method: 'POST', cookie: editor.cookie })).status, 200)

    const personalFolder = await api.request('/api/project-folders', { method: 'POST', cookie: owner.cookie, body: { name: 'Private folder' } })
    const teamFolder = await api.request('/api/project-folders', { method: 'POST', cookie: owner.cookie, body: { name: 'Campaigns', teamId: team.id } })
    assert.equal(personalFolder.status, 201)
    assert.equal(teamFolder.status, 201)
    assert.equal((await api.request('/api/project-folders', { cookie: outsider.cookie })).payload.folders.length, 0)
    const editorFolders = await api.request(`/api/project-folders?teamId=${team.id}`, { cookie: editor.cookie })
    assert.deepEqual(editorFolders.payload.folders.map(folder => folder.id), [teamFolder.payload.folder.id])
    assert.equal((await api.request(`/api/project-folders?teamId=${team.id}`, { cookie: outsider.cookie })).status, 404)
    assert.equal((await api.request(`/api/project-folders/${teamFolder.payload.folder.id}`, { method: 'PATCH', cookie: outsider.cookie, body: { name: 'Leaked' } })).status, 404)

    const personalProject = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Personal design', data: { type: 'design', width: 800, pages: [{ id: 'page-private', elements: [] }] } } })
    await api.request(`/api/documents/${personalProject.payload.id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    assert.equal((await api.request(`/api/documents/${personalProject.payload.id}/folder`, { method: 'PATCH', cookie: editor.cookie, body: { folderId: personalFolder.payload.folder.id, revision: personalProject.payload.revision } })).status, 403, 'an invited editor cannot place an owner document into their private folder')

    const project = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Shared design', teamId: team.id, data: { type: 'design', width: 800, pages: [{ id: 'page', elements: [] }] } } })
    await api.request(`/api/documents/${project.payload.id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: outsider.user.email, role: 'editor' } })
    assert.equal((await api.request(`/api/documents/${project.payload.id}/folder`, { method: 'PATCH', cookie: outsider.cookie, body: { folderId: teamFolder.payload.folder.id, revision: project.payload.revision } })).status, 404, 'directly shared editors without team membership cannot use a team folder')
    const moved = await api.request(`/api/documents/${project.payload.id}/folder`, { method: 'PATCH', cookie: editor.cookie, body: { folderId: teamFolder.payload.folder.id, revision: project.payload.revision } })
    assert.equal(moved.status, 200)
    assert.equal(moved.payload.data.folderId, teamFolder.payload.folder.id)
    assert.equal(moved.payload.revision, project.payload.revision + 1)
    assert.equal((await api.request(`/api/documents/${project.payload.id}/folder`, { method: 'PATCH', cookie: editor.cookie, body: { folderId: null, revision: project.payload.revision } })).status, 409)

    const renamed = await api.request(`/api/project-folders/${teamFolder.payload.folder.id}`, { method: 'PATCH', cookie: editor.cookie, body: { name: 'Launch', favorite: true } })
    assert.equal(renamed.payload.folder.name, 'Launch')
    assert.equal(renamed.payload.folder.favorite, true)
    assert.equal((await api.request(`/api/project-folders?teamId=${team.id}`, { cookie: owner.cookie })).payload.folders[0].favorite, false, 'favorites are private to each collaborator')
    assert.equal((await api.request(`/api/project-folders/${teamFolder.payload.folder.id}`, { method: 'DELETE', cookie: owner.cookie })).status, 409)
    assert.equal((await api.request(`/api/documents/${project.payload.id}/folder`, { method: 'PATCH', cookie: outsider.cookie, body: { folderId: teamFolder.payload.folder.id, revision: moved.payload.revision } })).status, 404)

    const ownFolderList = await api.request('/api/project-folders', { cookie: owner.cookie })
    assert.equal(ownFolderList.payload.folders.some(folder => folder.id === personalFolder.payload.folder.id), true)
    assert.equal((await api.request('/api/project-folders', { cookie: editor.cookie })).payload.folders.some(folder => folder.id === personalFolder.payload.folder.id), false)
  } finally {
    await api.close()
  }
})

test('folder access follows current team membership even for directly shared document editors', async () => {
  const api = await startApi()
  let memberReader
  try {
    const admin = await registerAndLogin(api, 'Folder ACL admin', 'folder-acl-admin@example.test')
    const member = await registerAndLogin(api, 'Folder ACL member', 'folder-acl-member@example.test')
    const outsider = await registerAndLogin(api, 'Folder ACL outsider', 'folder-acl-outsider@example.test')
    const team = (await api.request('/api/teams', { method: 'POST', cookie: admin.cookie, body: { name: 'Folder ACL team' } })).payload.team
    const invite = (await api.request(`/api/teams/${team.id}/invitations`, { method: 'POST', cookie: admin.cookie, body: { email: member.user.email } })).payload.invitation
    assert.equal((await api.request(`/api/team-invitations/${invite.token}`, { method: 'POST', cookie: member.cookie })).status, 200)

    const personal = (await api.request('/api/project-folders', { method: 'POST', cookie: admin.cookie, body: { name: 'Personal' } })).payload.folder
    const shared = (await api.request('/api/project-folders', { method: 'POST', cookie: admin.cookie, body: { name: 'Shared', teamId: team.id } })).payload.folder
    assert.deepEqual((await api.request(`/api/project-folders/${shared.id}`, { cookie: member.cookie })).payload.folder, shared)
    assert.equal((await api.request(`/api/project-folders/${personal.id}`, { cookie: admin.cookie })).status, 200)
    for (const account of [member, outsider]) assert.equal((await api.request(`/api/project-folders/${personal.id}`, { cookie: account.cookie })).status, 404)
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const response = await api.request(`/api/project-folders/${shared.id}`, { method, cookie: outsider.cookie, ...(method === 'PATCH' ? { body: { name: 'Unauthorized', favorite: true } } : {}) })
      assert.equal(response.status, 404, `non-member cannot ${method} a team folder by ID`)
    }
    assert.equal((await api.request('/api/project-folders', { method: 'POST', cookie: outsider.cookie, body: { name: 'Unauthorized', teamId: team.id } })).status, 404)
    const disposable = await api.request('/api/project-folders', { method: 'POST', cookie: member.cookie, body: { name: 'Member folder', teamId: team.id } })
    assert.equal(disposable.status, 201, 'a team member can create a folder')
    assert.equal((await api.request(`/api/project-folders/${disposable.payload.folder.id}`, { method: 'DELETE', cookie: member.cookie })).status, 200, 'a member can remove an empty team folder')
    assert.equal((await api.request(`/api/project-folders/${shared.id}`, { method: 'PATCH', cookie: member.cookie, body: { name: 'Renamed', favorite: true } })).status, 200)
    assert.equal((await api.request(`/api/project-folders/${shared.id}`, { cookie: admin.cookie })).payload.folder.favorite, false, 'favorites remain individual')
    assert.equal((await api.request(`/api/project-folders/${shared.id}`, { cookie: member.cookie })).payload.folder.favorite, true)

    const document = await api.request('/api/documents', { method: 'POST', cookie: admin.cookie, body: { name: 'Team design', teamId: team.id, data: { type: 'design', width: 800, pages: [{ id: 'page', elements: [] }] } } })
    assert.equal(document.status, 201)
    for (const account of [member, outsider]) {
      const grant = await api.request(`/api/documents/${document.payload.id}/permissions`, { method: 'POST', cookie: admin.cookie, body: { email: account.user.email, role: 'editor' } })
      assert.equal(grant.status, 201)
    }
    const moved = await api.request(`/api/documents/${document.payload.id}/folder`, { method: 'PATCH', cookie: member.cookie, body: { folderId: shared.id, revision: document.payload.revision } })
    assert.equal(moved.status, 200)
    assert.equal((await api.request(`/api/project-folders/${shared.id}`, { method: 'DELETE', cookie: admin.cookie })).status, 409, 'nonempty folders cannot be deleted')
    assert.equal((await api.request(`/api/documents/${document.payload.id}/folder`, { method: 'PATCH', cookie: outsider.cookie, body: { folderId: null, revision: moved.payload.revision } })).status, 404, 'direct editor access does not allow removing a document from a team folder')

    const teamEvents = await fetch(`${api.base}/api/teams/${team.id}/events`, { headers: { origin: ORIGIN, cookie: member.cookie } })
    assert.equal(teamEvents.status, 200)
    memberReader = teamEvents.body.getReader()
    const streamState = { buffer: '' }
    await readSseEvent(memberReader, streamState, 'ready')
    assert.equal((await api.request(`/api/teams/${team.id}/members?userId=${member.user.id}`, { method: 'DELETE', cookie: admin.cookie })).status, 200)
    assert.equal((await readSseEvent(memberReader, streamState, 'access.revoked')).type, 'access.revoked', 'the open team stream is revoked when membership is removed without expiring the login')
    assert.equal((await api.request('/api/auth/me', { cookie: member.cookie })).status, 200, 'team removal does not expire the account session')
    assert.equal((await api.request(`/api/teams/${team.id}/events`, { cookie: member.cookie })).status, 404, 'the same session cannot reconnect to the team stream')
    assert.equal((await api.request(`/api/documents/${document.payload.id}`, { cookie: member.cookie })).status, 200, 'explicit document sharing survives team removal')
    assert.equal((await api.request(`/api/project-folders/${shared.id}`, { cookie: member.cookie })).status, 404, 'the same session loses direct folder access immediately')
    assert.equal((await api.request(`/api/project-folders?teamId=${team.id}`, { cookie: member.cookie })).status, 404)
    assert.equal((await api.request('/api/project-folders', { cookie: member.cookie })).payload.folders.some(folder => folder.id === shared.id), false)
    assert.equal((await api.request(`/api/project-folders/${shared.id}`, { method: 'PATCH', cookie: member.cookie, body: { name: 'After removal' } })).status, 404)
    assert.equal((await api.request(`/api/project-folders/${shared.id}`, { method: 'DELETE', cookie: member.cookie })).status, 404)
    assert.equal((await api.request('/api/project-folders', { method: 'POST', cookie: member.cookie, body: { name: 'After removal', teamId: team.id } })).status, 404)
    assert.equal((await api.request(`/api/documents/${document.payload.id}/folder`, { method: 'PATCH', cookie: member.cookie, body: { folderId: null, revision: moved.payload.revision } })).status, 404)
    const unchanged = await api.request(`/api/documents/${document.payload.id}`, { cookie: admin.cookie })
    assert.equal(unchanged.payload.data.folderId, shared.id)
    assert.equal(unchanged.payload.revision, moved.payload.revision, 'denied folder moves leave the document revision unchanged')
    const removed = await api.request(`/api/documents/${document.payload.id}/folder`, { method: 'PATCH', cookie: admin.cookie, body: { folderId: null, revision: moved.payload.revision } })
    assert.equal(removed.status, 200)
    assert.equal((await api.request(`/api/project-folders/${shared.id}`, { method: 'DELETE', cookie: admin.cookie })).status, 200)
  } finally {
    await memberReader?.cancel()
    await api.close()
  }
})

test('AI text route uses the configured sandbox and enforces document write access', async () => {
  const api = await startApi({ textGenerator: { mode: 'sandbox', generate: async prompt => `Rascunho: ${prompt}` } })
  try {
    const owner = await registerAndLogin(api, 'AI Owner', 'ai-owner@example.test')
    const viewer = await registerAndLogin(api, 'AI Viewer', 'ai-viewer@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Texto', data: { width: 794, pages: [{ id: 'page-1', elements: [] }] } } })
    await api.request(`/api/documents/${created.payload.id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: viewer.user.email, role: 'viewer' } })
    const generated = await api.request('/api/ai/text', { method: 'POST', cookie: owner.cookie, body: { documentId: created.payload.id, prompt: 'Escreva uma chamada curta' } })
    assert.equal(generated.status, 200)
    assert.equal(generated.payload.mode, 'sandbox')
    assert.match(generated.payload.text, /Escreva uma chamada curta/)
    assert.equal((await api.request('/api/ai/text', { method: 'POST', cookie: viewer.cookie, body: { documentId: created.payload.id, prompt: 'Escreva outra chamada' } })).status, 403)
    assert.equal((await api.request('/api/ai/text', { method: 'POST', cookie: owner.cookie, body: { documentId: created.payload.id, prompt: 'x' } })).status, 400)
  } finally { await api.close() }
})

test('AI image route requires an authenticated document editor and bounds prompts', async () => {
  const calls = []
  const api = await startApi({ imageGenerator: { mode: 'sandbox', generate: async prompt => { calls.push(prompt); return { mimeType: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+', width: 512, height: 512, mode: 'sandbox' } } } })
  try {
    const owner = await registerAndLogin(api, 'Image Owner', 'image-owner@example.test')
    const viewer = await registerAndLogin(api, 'Image Viewer', 'image-viewer@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Image', data: { type: 'design', width: 794, pages: [{ id: 'page-image', elements: [] }] } } })
    await api.request(`/api/documents/${created.payload.id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: viewer.user.email, role: 'viewer' } })
    const generated = await api.request('/api/ai/image', { method: 'POST', cookie: owner.cookie, body: { documentId: created.payload.id, prompt: 'Uma capa abstrata azul' } })
    assert.equal(generated.status, 200)
    assert.equal(generated.payload.mode, 'sandbox')
    assert.match(generated.payload.dataUrl, /^data:image\/svg\+xml;base64,/)
    assert.equal((await api.request('/api/ai/image', { method: 'POST', cookie: viewer.cookie, body: { documentId: created.payload.id, prompt: 'Uma capa azul' } })).status, 403)
    assert.equal((await api.request('/api/ai/image', { method: 'POST', body: { documentId: created.payload.id, prompt: 'Uma capa azul' } })).status, 401)
    assert.equal((await api.request('/api/ai/image', { method: 'POST', cookie: owner.cookie, body: { documentId: created.payload.id, prompt: 'x' } })).status, 400)
    assert.deepEqual(calls, ['Uma capa abstrata azul'])
  } finally { await api.close() }
})

test('spreadsheet cell operations apply atomically, merge stale independent cells and reject overlapping writes', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Sheet Owner', 'sheet-owner@example.test')
    const editor = await registerAndLogin(api, 'Sheet Editor', 'sheet-editor@example.test')
    const commenter = await registerAndLogin(api, 'Sheet Commenter', 'sheet-commenter@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Budget', data: { type: 'sheet', width: 794, pages: [{ id: 'grid-1', cells: [['', ''], ['', '']] }] },
    } })
    const documentId = created.payload.id
    await api.request(`/api/documents/${documentId}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    await api.request(`/api/documents/${documentId}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: commenter.user.email, role: 'commenter' } })
    const stream = await fetch(`${api.base}/api/documents/${documentId}/events`, { headers: { cookie: owner.cookie } })
    const reader = stream.body.getReader()
    const streamState = { buffer: '' }
    await readSseEvent(reader, streamState, 'ready')
    await readSseEvent(reader, streamState, 'presence.updated')
    const operation = (operationId, baseRevision, cells) => ({ operationId, baseRevision, pageId: 'grid-1', cells, type: 'sheet.cells.set' })
    const first = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: editor.cookie, body: operation('op-editor-1', 1, [{ row: 0, column: 0, value: '100' }]) })
    assert.equal(first.status, 200)
    assert.equal(first.payload.revision, 2)
    await readSseEvent(reader, streamState, 'document.updated')
    const operationEvent = await readSseEvent(reader, streamState, 'sheet.operation.updated')
    assert.equal(operationEvent.operation, 'sheet.cells.set')
    const appliedEvent = await readSseEvent(reader, streamState, 'sheet.cells.updated')
    assert.equal(appliedEvent.operationId, 'op-editor-1')
    const staleIndependent = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('op-owner-1', 1, [{ row: 0, column: 1, value: '20' }]) })
    assert.equal(staleIndependent.status, 200)
    assert.deepEqual(staleIndependent.payload.document.pages[0].cells[0], ['100', '20'])
    const overlap = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('op-owner-2', 1, [{ row: 0, column: 0, value: '200' }]) })
    assert.equal(overlap.status, 409)
    assert.deepEqual(overlap.payload.conflicts, ['pages[grid-1].cells[0][0]'])
    const duplicate = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: editor.cookie, body: operation('op-editor-1', 1, [{ row: 0, column: 0, value: '100' }]) })
    assert.equal(duplicate.payload.duplicate, true)
    const formatOwner = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'op-format-owner', baseRevision: 3, pageId: 'grid-1', type: 'sheet.formats.set', formats: [{ row: 0, column: 0, value: 'currency' }],
    } })
    assert.equal(formatOwner.status, 200)
    const formatEditor = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'op-format-editor', baseRevision: 3, pageId: 'grid-1', type: 'sheet.formats.set', formats: [{ row: 0, column: 1, value: 'percentage' }, { row: 1, column: 0, value: 'date' }],
    } })
    assert.equal(formatEditor.status, 200)
    assert.deepEqual(formatEditor.payload.document.pages[0].cellFormats, { '0:0': 'currency', '0:1': 'percentage', '1:0': 'date' })
    const formatConflict = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'op-format-conflict', baseRevision: 3, pageId: 'grid-1', type: 'sheet.formats.set', formats: [{ row: 0, column: 0, value: 'percentage' }],
    } })
    assert.equal(formatConflict.status, 409)
    const merge = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'op-merge-owner', baseRevision: 5, pageId: 'grid-1', type: 'sheet.merge.set', merge: { row: 0, column: 2, colSpan: 2 },
    } })
    assert.equal(merge.status, 200)
    const staleDisjointMerge = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'op-merge-editor', baseRevision: 5, pageId: 'grid-1', type: 'sheet.merge.set', merge: { row: 1, column: 2, colSpan: 2 },
    } })
    assert.equal(staleDisjointMerge.status, 200)
    const overlappingMerge = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'op-merge-conflict', baseRevision: 5, pageId: 'grid-1', type: 'sheet.merge.set', merge: { row: 0, column: 3, colSpan: 2 },
    } })
    assert.equal(overlappingMerge.status, 409)
    const unmerge = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'op-unmerge-owner', baseRevision: 7, pageId: 'grid-1', type: 'sheet.merge.remove', row: 0, column: 3,
    } })
    assert.equal(unmerge.status, 200)
    assert.deepEqual(unmerge.payload.document.pages[0].cellMerges, [{ row: 1, column: 2, colSpan: 2 }])
    const appendRowOwner = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'op-row-owner', baseRevision: 8, pageId: 'grid-1', type: 'sheet.rows.append',
    } })
    assert.equal(appendRowOwner.status, 200)
    assert.equal(appendRowOwner.payload.document.pages[0].cells.length, 3)
    const appendRowDuplicate = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'op-row-owner', baseRevision: 8, pageId: 'grid-1', type: 'sheet.rows.append',
    } })
    assert.equal(appendRowDuplicate.payload.duplicate, true)
    assert.equal(appendRowDuplicate.payload.document.pages[0].cells.length, 3)
    const appendRowEditor = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'op-row-editor', baseRevision: 8, pageId: 'grid-1', type: 'sheet.rows.append',
    } })
    assert.equal(appendRowEditor.status, 200)
    assert.equal(appendRowEditor.payload.document.pages[0].cells.length, 4)
    const appendColumnOwner = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'op-column-owner', baseRevision: 10, pageId: 'grid-1', type: 'sheet.columns.append',
    } })
    assert.equal(appendColumnOwner.status, 200)
    const appendColumnEditor = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'op-column-editor', baseRevision: 10, pageId: 'grid-1', type: 'sheet.columns.append',
    } })
    assert.equal(appendColumnEditor.status, 200)
    assert.equal(appendColumnEditor.payload.document.pages[0].cells.length, 4)
    assert.ok(appendColumnEditor.payload.document.pages[0].cells.every(row => row.length === 14))
    assert.deepEqual(appendColumnEditor.payload.document.pages[0].cells[0].slice(0, 2), ['100', '20'])
    const rangeFormulas = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: editor.cookie, body: operation('op-formula-range', appendColumnEditor.payload.revision, [
      { row: 2, column: 2, value: '=LEN(A2)' },
      { row: 2, column: 3, value: '=$A$2&":"&C2' },
      { row: 3, column: 2, value: '=LEN(A3)' },
      { row: 3, column: 3, value: '=$A$2&":"&C3' },
    ]) })
    assert.equal(rangeFormulas.status, 200)
    assert.equal(rangeFormulas.payload.revision, appendColumnEditor.payload.revision + 1)
    assert.deepEqual(rangeFormulas.payload.document.pages[0].cells.slice(2, 4).map(row => row.slice(2, 4)), [
      ['=LEN(A2)', '=$A$2&":"&C2'],
      ['=LEN(A3)', '=$A$2&":"&C3'],
    ])
    const duplicateFormulaRange = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: editor.cookie, body: operation('op-formula-range', appendColumnEditor.payload.revision, [
      { row: 2, column: 2, value: '=LEN(A2)' },
      { row: 2, column: 3, value: '=$A$2&":"&C2' },
      { row: 3, column: 2, value: '=LEN(A3)' },
      { row: 3, column: 3, value: '=$A$2&":"&C3' },
    ]) })
    assert.equal(duplicateFormulaRange.payload.duplicate, true)
    assert.equal(duplicateFormulaRange.payload.revision, rangeFormulas.payload.revision)
    const chart = { id: 'chart-1', type: 'bar', title: 'Vendas', range: { startRow: 0, startColumn: 0, endRow: 2, endColumn: 1 } }
    const createChart = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'op-chart-create', baseRevision: rangeFormulas.payload.revision, pageId: 'grid-1', type: 'sheet.chart.set', chartId: chart.id, chart,
    } })
    assert.equal(createChart.status, 200)
    assert.deepEqual(createChart.payload.document.pages[0].charts, [chart])
    const chartEvent = await readSseEvent(reader, streamState, 'sheet.operation.updated', event => event.operationId === 'op-chart-create')
    assert.equal(chartEvent.operation, 'sheet.chart.set')
    const renameChart = { ...chart, title: 'Receita' }
    const updatedChart = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'op-chart-update-owner', baseRevision: createChart.payload.revision, pageId: 'grid-1', type: 'sheet.chart.set', chartId: chart.id, chart: renameChart,
    } })
    assert.equal(updatedChart.status, 200)
    const chartConflict = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'op-chart-update-conflict', baseRevision: createChart.payload.revision, pageId: 'grid-1', type: 'sheet.chart.set', chartId: chart.id, chart: { ...chart, title: 'Lucro' },
    } })
    assert.equal(chartConflict.status, 409)
    assert.deepEqual(chartConflict.payload.conflicts, ['pages[grid-1].charts[chart-1]'])
    const deleteChart = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'op-chart-delete', baseRevision: updatedChart.payload.revision, pageId: 'grid-1', type: 'sheet.chart.set', chartId: chart.id, chart: null,
    } })
    assert.equal(deleteChart.status, 200)
    assert.deepEqual(deleteChart.payload.document.pages[0].charts, [])
    const invalidChart = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'op-chart-invalid', baseRevision: deleteChart.payload.revision, pageId: 'grid-1', type: 'sheet.chart.set', chartId: 'chart-bad', chart: { ...chart, id: 'chart-bad', range: { ...chart.range, endColumn: 200 } },
    } })
    assert.equal(invalidChart.status, 400)
    assert.equal((await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: commenter.cookie, body: operation('op-commenter', 2, [{ row: 1, column: 0, value: 'no' }]) })).status, 403)
    await reader.cancel()
  } finally { await api.close() }
})

test('collaborative sheet merge operations accept rectangular ranges and find covered cells on unmerge', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Rectangle Owner', 'rectangle-owner@example.test')
    const editor = await registerAndLogin(api, 'Rectangle Editor', 'rectangle-editor@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Merged range', data: { type: 'sheet', width: 794, pages: [{ id: 'rectangle-grid', cells: [['=1+2', ''], ['', '']] }] },
    } })
    const documentId = created.payload.id
    await api.request(`/api/documents/${documentId}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const merged = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'rectangular-merge', baseRevision: 1, pageId: 'rectangle-grid', type: 'sheet.merge.set', merge: { row: 0, column: 0, colSpan: 2, rowSpan: 2 },
    } })
    assert.equal(merged.status, 200, JSON.stringify(merged.payload))
    assert.deepEqual(merged.payload.document.pages[0].cellMerges, [{ row: 0, column: 0, colSpan: 2, rowSpan: 2 }])
    const overlap = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'rectangular-merge-overlap', baseRevision: 1, pageId: 'rectangle-grid', type: 'sheet.merge.set', merge: { row: 1, column: 1, colSpan: 2 },
    } })
    assert.equal(overlap.status, 409)
    const unmerged = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'rectangular-merge-remove', baseRevision: 2, pageId: 'rectangle-grid', type: 'sheet.merge.remove', row: 1, column: 1,
    } })
    assert.equal(unmerged.status, 200)
    assert.deepEqual(unmerged.payload.document.pages[0].cellMerges, [])
    const occupiedCell = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'rectangular-occupied-cell', baseRevision: 3, pageId: 'rectangle-grid', type: 'sheet.cells.set', cells: [{ row: 1, column: 1, value: 'occupied' }],
    } })
    assert.equal(occupiedCell.status, 200)
    const occupiedMerge = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'rectangular-merge-occupied', baseRevision: 4, pageId: 'rectangle-grid', type: 'sheet.merge.set', merge: { row: 0, column: 0, colSpan: 2, rowSpan: 2 },
    } })
    assert.equal(occupiedMerge.status, 400)
  } finally { await api.close() }
})

test('collaborative cell edits cannot write into merged coverage and detect a merge added after the base revision', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Merge range owner', 'merge-range-owner@example.test')
    const editor = await registerAndLogin(api, 'Merge range editor', 'merge-range-editor@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Merged cell concurrency', data: { type: 'sheet', width: 794, pages: [
        { id: 'merge-first', cells: [['top-left', ''], ['', '']] },
        { id: 'merge-second', cells: [['', ''], ['', '']] },
      ] },
    } })
    const documentId = created.payload.id
    await api.request(`/api/documents/${documentId}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const operation = (operationId, baseRevision, pageId, type, details) => ({ operationId, baseRevision, pageId, type, ...details })

    const mergeFirst = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: owner.cookie, body: operation(
      'merge-first-range', 1, 'merge-first', 'sheet.merge.set', { merge: { row: 0, column: 0, colSpan: 2, rowSpan: 2 } },
    ) })
    assert.equal(mergeFirst.status, 200)
    assert.equal(mergeFirst.payload.revision, 2)

    const staleCoveredEdit = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: editor.cookie, body: operation(
      'stale-edit-covered-cell', 1, 'merge-first', 'sheet.cells.set', { cells: [{ row: 1, column: 1, value: 'hidden write' }] },
    ) })
    assert.equal(staleCoveredEdit.status, 409)
    assert.deepEqual(staleCoveredEdit.payload.conflicts, ['pages[merge-first].cellMerges[1:1]'])
    assert.equal(staleCoveredEdit.payload.current.data.pages[0].cells[1]?.[1] ?? '', '')

    const currentCoveredEdit = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: editor.cookie, body: operation(
      'current-edit-covered-cell', 2, 'merge-first', 'sheet.cells.set', { cells: [{ row: 0, column: 1, value: 'hidden write' }] },
    ) })
    assert.equal(currentCoveredEdit.status, 400)
    assert.match(currentCoveredEdit.payload.error, /covered by a merged range/i)

    const anchorEdit = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: editor.cookie, body: operation(
      'edit-merge-anchor', 2, 'merge-first', 'sheet.cells.set', { cells: [{ row: 0, column: 0, value: 'preserved anchor' }] },
    ) })
    assert.equal(anchorEdit.status, 200)

    const unmergeFromCoveredCell = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: owner.cookie, body: operation(
      'unmerge-by-covered-cell', 3, 'merge-first', 'sheet.merge.remove', { row: 1, column: 1 },
    ) })
    assert.equal(unmergeFromCoveredCell.status, 200)
    assert.deepEqual(unmergeFromCoveredCell.payload.document.pages[0].cellMerges, [])
    assert.equal(unmergeFromCoveredCell.payload.document.pages[0].cells[0][0], 'preserved anchor')
    assert.equal(unmergeFromCoveredCell.payload.document.pages[0].cells[1]?.[1] ?? '', '')

    const cellBeforeMerge = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: owner.cookie, body: operation(
      'edit-before-stale-merge', 4, 'merge-second', 'sheet.cells.set', { cells: [{ row: 1, column: 1, value: 'concurrent value' }] },
    ) })
    assert.equal(cellBeforeMerge.status, 200)
    const staleMerge = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: editor.cookie, body: operation(
      'stale-merge-over-new-value', 4, 'merge-second', 'sheet.merge.set', { merge: { row: 0, column: 0, colSpan: 2, rowSpan: 2 } },
    ) })
    assert.equal(staleMerge.status, 409)
    assert.deepEqual(staleMerge.payload.conflicts, ['pages[merge-second].cellMerges[0:0]'])
    assert.equal(staleMerge.payload.current.data.pages[1].cells[1][1], 'concurrent value')
    assert.deepEqual(staleMerge.payload.current.data.pages[1].cellMerges ?? [], [])
  } finally { await api.close() }
})

test('video timeline event streams replay missed clip operations after reconnect', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Replay owner', 'replay-owner@example.test')
    const editor = await registerAndLogin(api, 'Replay editor', 'replay-editor@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Replay video', data: { type: 'video', width: 1920, height: 1080, videoDurationMs: 10_000, pages: [{ id: 'video-1', elements: [], timelineClips: [
        { id: 'clip-1', assetId: 'audio-1', name: 'Trilha.wav', kind: 'audio', startMs: 0, durationMs: 5000, sourceDurationMs: 8000, sourceStartMs: 0, volume: 1 },
      ] }] },
    } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })

    const initial = await fetch(`${api.base}/api/documents/${id}/events`, { headers: { cookie: owner.cookie } })
    const initialReader = initial.body.getReader()
    const initialState = { buffer: '' }
    await readSseEvent(initialReader, initialState, 'ready')
    const presence = await readSseEventWithId(initialReader, initialState, 'presence.updated')
    assert.ok(Number(presence.id) > 0)
    await initialReader.cancel()

    const operation = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'replayed-video-clip-volume', baseRevision: 1, pageId: 'video-1', type: 'design.video.clip.patch', clipId: 'clip-1', patch: { volume: 0.6 },
    } })
    assert.equal(operation.status, 200, JSON.stringify(operation.payload))
    assert.equal(operation.payload.document.pages[0].timelineClips[0].volume, 0.6)

    const resumed = await fetch(`${api.base}/api/documents/${id}/events`, { headers: { cookie: owner.cookie, 'last-event-id': presence.id } })
    const resumedReader = resumed.body.getReader()
    const resumedState = { buffer: '' }
    await readSseEvent(resumedReader, resumedState, 'ready')
    const update = await readSseEventWithId(resumedReader, resumedState, 'document.updated')
    const applied = await readSseEventWithId(resumedReader, resumedState, 'document.operation.updated')
    assert.ok(Number(update.id) > Number(presence.id))
    assert.ok(Number(applied.id) > Number(update.id))
    assert.equal(applied.event.operationId, 'replayed-video-clip-volume')
    assert.equal(applied.event.operation, 'design.video.clip.patch')
    const persisted = await api.request(`/api/documents/${id}`, { cookie: owner.cookie })
    assert.equal(persisted.payload.data.pages[0].timelineClips[0].volume, 0.6)
    await resumedReader.cancel()

    const denied = await fetch(`${api.base}/api/documents/${id}/events`, { headers: { cookie: 'fuse_session=invalid', 'last-event-id': presence.id } })
    assert.equal(denied.status, 401)
  } finally { await api.close() }
})

test('authorized collaborators can inspect document versions and restore one as a new revision', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'History owner', 'history-owner@example.test')
    const editor = await registerAndLogin(api, 'History editor', 'history-editor@example.test')
    const viewer = await registerAndLogin(api, 'History viewer', 'history-viewer@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Draft v1', data: { type: 'design', pages: [{ id: 'page-1', elements: [{ id: 'element-1', type: 'text', text: 'Version one' }] }] },
    } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: viewer.user.email, role: 'viewer' } })
    const edited = await api.request(`/api/documents/${id}`, { method: 'PUT', cookie: owner.cookie, body: {
      revision: 1, name: 'Draft v2', data: { type: 'design', pages: [{ id: 'page-1', elements: [{ id: 'element-1', type: 'text', text: 'Version two' }] }] },
    } })
    assert.equal(edited.status, 200)

    const history = await api.request(`/api/documents/${id}/versions`, { cookie: viewer.cookie })
    assert.equal(history.status, 200)
    assert.equal(history.payload.currentRevision, 2)
    assert.deepEqual(history.payload.versions.map(version => version.revision), [2, 1])
    assert.equal('data_json' in history.payload.versions[0], false)

    const restored = await api.request(`/api/documents/${id}/versions/1/restore`, { method: 'POST', cookie: editor.cookie, body: { revision: 2 } })
    assert.equal(restored.status, 200)
    assert.equal(restored.payload.sourceRevision, 1)
    assert.equal(restored.payload.document.revision, 3)
    assert.equal(restored.payload.document.name, 'Draft v1')
    assert.equal(restored.payload.document.data.pages[0].elements[0].text, 'Version one')

    const staleRestore = await api.request(`/api/documents/${id}/versions/2/restore`, { method: 'POST', cookie: owner.cookie, body: { revision: 2 } })
    assert.equal(staleRestore.status, 409)
    assert.equal(staleRestore.payload.current.revision, 3)
    assert.equal((await api.request(`/api/documents/${id}/versions/99/restore`, { method: 'POST', cookie: owner.cookie, body: { revision: 3 } })).status, 404)
    assert.equal((await api.request(`/api/documents/${id}/versions/1/restore`, { method: 'POST', cookie: viewer.cookie, body: { revision: 3 } })).status, 403)

    const sourceBeforeCopy = (await api.request(`/api/documents/${id}`, { cookie: owner.cookie })).payload
    const copy = await api.request(`/api/documents/${id}/versions/1/copy`, { method: 'POST', cookie: viewer.cookie, body: {} })
    assert.equal(copy.status, 201)
    assert.notEqual(copy.payload.id, id)
    assert.equal(copy.payload.ownerId, viewer.user.id)
    assert.equal(copy.payload.revision, 1)
    assert.equal(copy.payload.name, 'Cópia de Draft v1')
    assert.equal(copy.payload.data.id, copy.payload.id)
    assert.equal(copy.payload.data.name, copy.payload.name)
    assert.equal(copy.payload.data.pages[0].elements[0].text, 'Version one')
    assert.deepEqual((await api.request(`/api/documents/${id}`, { cookie: owner.cookie })).payload, sourceBeforeCopy, 'copying a historical version must preserve the entire current source')
  } finally { await api.close() }
})

test('cloud archive and restore persist as versioned document metadata and reject stale overlap', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Archive owner', 'archive-owner@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Cloud archive', data: { type: 'design', width: 320, height: 240, pages: [{ id: 'page-1', elements: [{ id: 'shape-1', type: 'shape', shape: 'rect', name: 'Body', x: 10, y: 10, width: 100, height: 80, rotation: 0, fill: '#123456', cornerRadius: 0 }] }] },
    } })
    const id = created.payload.id
    const archived = { ...created.payload.data, archivedAt: '2026-10-21T12:00:00.000Z' }
    const saved = await api.request(`/api/documents/${id}`, { method: 'PUT', cookie: owner.cookie, body: { revision: 1, name: created.payload.name, data: archived } })
    assert.equal(saved.status, 200, JSON.stringify(saved.payload))
    assert.equal(saved.payload.revision, 2)
    assert.equal(saved.payload.data.archivedAt, archived.archivedAt)
    const stale = await api.request(`/api/documents/${id}`, { method: 'PUT', cookie: owner.cookie, body: { revision: 1, name: created.payload.name, data: { ...created.payload.data, archivedAt: '2026-10-21T12:01:00.000Z' } } })
    assert.equal(stale.status, 409)
    assert.ok(stale.payload.conflicts?.some(path => path.includes('archivedAt')))
    const restoredData = { ...saved.payload.data }
    delete restoredData.archivedAt
    const restored = await api.request(`/api/documents/${id}`, { method: 'PUT', cookie: owner.cookie, body: { revision: 2, name: saved.payload.name, data: restoredData } })
    assert.equal(restored.status, 200, JSON.stringify(restored.payload))
    assert.equal(restored.payload.revision, 3)
    assert.equal(Object.hasOwn(restored.payload.data, 'archivedAt'), false)
    assert.deepEqual(restored.payload.data.pages[0].elements[0], created.payload.data.pages[0].elements[0])
    const trashData = { ...restored.payload.data, trashedAt: '2026-10-21T12:02:00.000Z' }
    const trashed = await api.request(`/api/documents/${id}`, { method: 'PUT', cookie: owner.cookie, body: { revision: 3, name: restored.payload.name, data: trashData } })
    assert.equal(trashed.status, 200, JSON.stringify(trashed.payload))
    assert.equal(trashed.payload.revision, 4)
    assert.equal(trashed.payload.data.trashedAt, trashData.trashedAt)
    const copyData = { ...trashed.payload.data }
    delete copyData.trashedAt
    delete copyData.archivedAt
    const copy = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Cloud archive copy', data: copyData } })
    assert.equal(copy.status, 201, JSON.stringify(copy.payload))
    assert.equal(Object.hasOwn(copy.payload.data, 'trashedAt'), false)
    assert.deepEqual(copy.payload.data.pages[0].elements[0], created.payload.data.pages[0].elements[0])
    const restoreTrashData = { ...trashed.payload.data }
    delete restoreTrashData.trashedAt
    const trashRestore = await api.request(`/api/documents/${id}`, { method: 'PUT', cookie: owner.cookie, body: { revision: 4, name: trashed.payload.name, data: restoreTrashData } })
    assert.equal(trashRestore.status, 200, JSON.stringify(trashRestore.payload))
    assert.equal(trashRestore.payload.revision, 5)
    assert.equal(Object.hasOwn(trashRestore.payload.data, 'trashedAt'), false)
    assert.deepEqual(trashRestore.payload.data.pages[0].elements[0], created.payload.data.pages[0].elements[0])
  } finally { await api.close() }
})

test('permanent cloud deletion requires owner, trash state and current revision while shared media stays available', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Delete owner', 'delete-owner@example.test')
    const editor = await registerAndLogin(api, 'Delete editor', 'delete-editor@example.test')
    const team = await api.request('/api/teams', { method: 'POST', cookie: owner.cookie, body: { name: 'Deletion audit team' } })
    const imageSource = 'data:image/svg+xml;base64,PHN2Zy8+'
    const source = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Source asset', teamId: team.payload.team.id, data: { type: 'design', width: 320, height: 240, pages: [{ id: 'source-page', elements: [] }] } } })
    const retained = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Retained asset', data: { type: 'design', width: 320, height: 240, pages: [{ id: 'retained-page', elements: [] }] } } })
    await api.request(`/api/documents/${source.payload.id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const asset = { id: 'shared-object', name: 'shared.svg', mimeType: 'image/svg+xml', width: 1, height: 1, src: imageSource, createdAt: new Date().toISOString() }
    assert.equal((await api.request(`/api/documents/${source.payload.id}/media`, { method: 'POST', cookie: owner.cookie, body: { asset } })).status, 201)
    assert.equal((await api.request(`/api/documents/${retained.payload.id}/media`, { method: 'POST', cookie: owner.cookie, body: { asset: { ...asset, id: 'retained-object' } } })).status, 201)
    assert.equal((await api.request(`/api/documents/${source.payload.id}`, { method: 'DELETE', cookie: owner.cookie, body: { revision: 1 } })).status, 409, 'active documents cannot be permanently deleted')
    const trashedData = { ...source.payload.data, trashedAt: new Date().toISOString() }
    const trashed = await api.request(`/api/documents/${source.payload.id}`, { method: 'PUT', cookie: owner.cookie, body: { revision: 1, name: source.payload.name, data: trashedData } })
    assert.equal(trashed.status, 200)
    assert.equal((await api.request(`/api/documents/${source.payload.id}`, { method: 'DELETE', cookie: editor.cookie, body: { revision: 2 } })).status, 403, 'editors cannot permanently delete projects')
    assert.equal((await api.request(`/api/documents/${source.payload.id}`, { method: 'DELETE', cookie: owner.cookie, body: { revision: 1 } })).status, 409, 'stale deletion is rejected')
    const deleted = await api.request(`/api/documents/${source.payload.id}`, { method: 'DELETE', cookie: owner.cookie, body: { revision: 2 } })
    assert.equal(deleted.status, 200, JSON.stringify(deleted.payload))
    assert.equal((await api.request(`/api/documents/${source.payload.id}`, { cookie: owner.cookie })).status, 404)
    const deletionAudit = await api.request(`/api/teams/${team.payload.team.id}/audit?limit=100`, { cookie: owner.cookie })
    assert.ok(deletionAudit.payload.events.some(event => event.action === 'document.deleted' && event.targetId === source.payload.id && event.details.name === 'Source asset'), 'team audit keeps the deletion record after the document cascade')
    const retainedAssets = await api.request(`/api/documents/${retained.payload.id}/media`, { cookie: owner.cookie })
    assert.equal(retainedAssets.status, 200)
    assert.equal(retainedAssets.payload.assets.find(item => item.id === 'retained-object').src, imageSource, 'the shared content-addressed object remains until its final document reference is deleted')
  } finally { await api.close() }
})

test('emptying cloud trash is all-or-nothing and removes only current owner trash entries', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Trash owner', 'trash-owner@example.test')
    const editor = await registerAndLogin(api, 'Trash editor', 'trash-editor@example.test')
    const create = async name => api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name, data: { type: 'design', width: 320, height: 240, pages: [{ id: `${name}-page`, elements: [] }] } } })
    const first = await create('Bulk trash one')
    const second = await create('Bulk trash two')
    const active = await create('Keep active')
    const moveToTrash = async document => api.request(`/api/documents/${document.payload.id}`, { method: 'PUT', cookie: owner.cookie, body: { revision: 1, name: document.payload.name, data: { ...document.payload.data, trashedAt: new Date().toISOString() } } })
    assert.equal((await moveToTrash(first)).status, 200)
    assert.equal((await moveToTrash(second)).status, 200)
    await api.request(`/api/documents/${first.payload.id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const mixed = [{ id: first.payload.id, revision: 2 }, { id: active.payload.id, revision: 1 }]
    assert.equal((await api.request('/api/documents/trash', { method: 'DELETE', cookie: owner.cookie, body: { documents: mixed } })).status, 409, 'one active project prevents every deletion in the batch')
    assert.equal((await api.request(`/api/documents/${first.payload.id}`, { cookie: owner.cookie })).status, 200)
    const unauthorized = await api.request('/api/documents/trash', { method: 'DELETE', cookie: editor.cookie, body: { documents: [{ id: first.payload.id, revision: 2 }] } })
    assert.equal(unauthorized.status, 403, 'editors cannot empty an owner trash')
    const emptied = await api.request('/api/documents/trash', { method: 'DELETE', cookie: owner.cookie, body: { documents: [{ id: first.payload.id, revision: 2 }, { id: second.payload.id, revision: 2 }] } })
    assert.equal(emptied.status, 200, JSON.stringify(emptied.payload))
    assert.equal(emptied.payload.deleted, 2)
    assert.equal((await api.request(`/api/documents/${first.payload.id}`, { cookie: owner.cookie })).status, 404)
    assert.equal((await api.request(`/api/documents/${second.payload.id}`, { cookie: owner.cookie })).status, 404)
    assert.equal((await api.request(`/api/documents/${active.payload.id}`, { cookie: owner.cookie })).status, 200, 'active documents remain untouched')
  } finally { await api.close() }
})

async function registerAndLogin(api, name, email) {
  const password = 'Fuse-Studio-Password-42'
  const registered = await api.request('/api/auth/register', { method: 'POST', body: { name, email, password } })
  assert.equal(registered.status, 201)
  const loggedIn = await api.request('/api/auth/login', { method: 'POST', body: { email, password } })
  assert.equal(loggedIn.status, 200)
  assert.ok(loggedIn.cookie?.startsWith('fuse_session='))
  assert.match(loggedIn.setCookie, /HttpOnly/i)
  assert.match(loggedIn.setCookie, /SameSite=Lax/i)
  return { user: registered.payload.user, cookie: loggedIn.cookie }
}

test('team profile rename is admin-only, validated, unique per creator, persistent, and auditable', async () => {
  const api = await startApi()
  try {
    const admin = await registerAndLogin(api, 'Profile admin', 'profile-admin@example.test')
    const member = await registerAndLogin(api, 'Profile member', 'profile-member@example.test')
    const outsider = await registerAndLogin(api, 'Profile outsider', 'profile-outsider@example.test')
    const team = (await api.request('/api/teams', { method: 'POST', cookie: admin.cookie, body: { name: 'Design team' } })).payload.team
    const second = await api.request('/api/teams', { method: 'POST', cookie: admin.cookie, body: { name: 'Operations team' } })
    assert.equal(second.status, 201)
    assert.equal((await api.request('/api/teams', { method: 'POST', cookie: admin.cookie, body: { name: ' design TEAM ' } })).status, 409, 'team names are unique case-insensitively for one creator')
    const invitation = (await api.request(`/api/teams/${team.id}/invitations`, { method: 'POST', cookie: admin.cookie, body: { email: member.user.email } })).payload.invitation
    assert.equal((await api.request(`/api/team-invitations/${invitation.token}`, { method: 'POST', cookie: member.cookie })).status, 200)

    const renamed = await api.request(`/api/teams/${team.id}`, { method: 'PATCH', cookie: admin.cookie, body: { name: '  Creative studio  ' } })
    assert.equal(renamed.status, 200)
    assert.equal(renamed.payload.team.name, 'Creative studio')
    assert.equal(renamed.payload.team.role, 'admin')
    assert.equal((await api.request(`/api/teams/${team.id}`, { cookie: member.cookie })).payload.team.name, 'Creative studio')
    assert.equal((await api.request('/api/teams', { cookie: member.cookie })).payload.teams[0].name, 'Creative studio')
    assert.equal((await api.request(`/api/teams/${team.id}`, { method: 'PATCH', cookie: member.cookie, body: { name: 'Member edit' } })).status, 403)
    assert.equal((await api.request(`/api/teams/${team.id}`, { method: 'PATCH', cookie: outsider.cookie, body: { name: 'Outsider edit' } })).status, 404)
    assert.equal((await api.request(`/api/teams/${team.id}`, { method: 'PATCH', cookie: admin.cookie, body: { name: '   ' } })).status, 400)
    assert.equal((await api.request(`/api/teams/${team.id}`, { method: 'PATCH', cookie: admin.cookie, body: { name: 'x'.repeat(101) } })).status, 400)
    assert.equal((await api.request(`/api/teams/${team.id}`, { method: 'PATCH', cookie: admin.cookie, body: { name: 'Operations team' } })).status, 409, 'renaming to a duplicate creator-owned team name is rejected')
    assert.equal((await api.request(`/api/teams/${team.id}`, { method: 'PATCH', cookie: admin.cookie, body: { name: 'Valid name', unexpected: true } })).status, 400)
    const audit = await api.request(`/api/teams/${team.id}/audit?limit=100`, { cookie: admin.cookie })
    const profileEvents = audit.payload.events.filter(event => event.action === 'team.profile.updated' && event.targetId === team.id)
    assert.equal(profileEvents.length, 1)
    assert.deepEqual(profileEvents[0].details, { previousName: 'Design team', name: 'Creative studio' })
  } finally { await api.close() }
})

test('team groups are scoped, admin-managed, persistent, auditable, and cascade on removal', async () => {
  const api = await startApi()
  try {
    const admin = await registerAndLogin(api, 'Group admin', 'group-admin@example.test')
    const member = await registerAndLogin(api, 'Group member', 'group-member@example.test')
    const outsider = await registerAndLogin(api, 'Group outsider', 'group-outsider@example.test')
    const team = (await api.request('/api/teams', { method: 'POST', cookie: admin.cookie, body: { name: 'Design team' } })).payload.team
    const invitation = (await api.request(`/api/teams/${team.id}/invitations`, { method: 'POST', cookie: admin.cookie, body: { email: member.user.email } })).payload.invitation
    assert.equal((await api.request(`/api/team-invitations/${invitation.token}`, { method: 'POST', cookie: member.cookie })).status, 200)

    const created = await api.request(`/api/teams/${team.id}/groups`, { method: 'POST', cookie: admin.cookie, body: { name: 'Brand designers' } })
    assert.equal(created.status, 201)
    const groupId = created.payload.group.id
    assert.equal(created.payload.group.name, 'Brand designers')
    assert.deepEqual(created.payload.group.members, [])
    assert.equal((await api.request(`/api/teams/${team.id}/groups`, { method: 'POST', cookie: admin.cookie, body: { name: 'brand designers' } })).status, 409)
    assert.equal((await api.request(`/api/teams/${team.id}/groups`, { method: 'POST', cookie: member.cookie, body: { name: 'Blocked' } })).status, 403)
    assert.equal((await api.request(`/api/teams/${team.id}/groups`, { cookie: outsider.cookie })).status, 404)

    const assigned = await api.request(`/api/teams/${team.id}/groups/${groupId}/members`, { method: 'PUT', cookie: admin.cookie, body: { userIds: [admin.user.id, member.user.id] } })
    assert.equal(assigned.status, 200)
    assert.deepEqual(assigned.payload.group.members.map(item => item.id).sort(), [admin.user.id, member.user.id].sort())
    assert.equal((await api.request(`/api/teams/${team.id}/groups/${groupId}/members`, { method: 'PUT', cookie: member.cookie, body: { userIds: [] } })).status, 403)
    assert.equal((await api.request(`/api/teams/${team.id}/groups/${groupId}/members`, { method: 'PUT', cookie: admin.cookie, body: { userIds: [outsider.user.id] } })).status, 400)
    assert.equal((await api.request(`/api/teams/${team.id}/groups/${groupId}/members`, { method: 'PUT', cookie: admin.cookie, body: { userIds: [member.user.id, member.user.id] } })).status, 400)

    const renamed = await api.request(`/api/teams/${team.id}/groups/${groupId}`, { method: 'PATCH', cookie: admin.cookie, body: { name: 'Creative' } })
    assert.equal(renamed.status, 200)
    assert.equal(renamed.payload.group.name, 'Creative')
    const listed = await api.request(`/api/teams/${team.id}/groups`, { cookie: member.cookie })
    assert.equal(listed.payload.groups[0].name, 'Creative')
    assert.deepEqual(listed.payload.groups[0].members.map(item => item.id).sort(), [admin.user.id, member.user.id].sort())

    assert.equal((await api.request(`/api/teams/${team.id}/members?userId=${member.user.id}`, { method: 'DELETE', cookie: admin.cookie })).status, 200)
    assert.deepEqual((await api.request(`/api/teams/${team.id}/groups`, { cookie: admin.cookie })).payload.groups[0].members.map(item => item.id), [admin.user.id])
    const audit = await api.request(`/api/teams/${team.id}/audit?limit=100`, { cookie: admin.cookie })
    assert.ok(audit.payload.events.some(event => event.action === 'team.group.created' && event.targetId === groupId))
    assert.ok(audit.payload.events.some(event => event.action === 'team.group.renamed' && event.targetId === groupId))
    assert.ok(audit.payload.events.some(event => event.action === 'team.group.members_changed' && event.targetId === groupId))
    assert.equal((await api.request(`/api/teams/${team.id}/groups/${groupId}`, { method: 'DELETE', cookie: member.cookie })).status, 404, 'removed member cannot query team groups')
    assert.equal((await api.request(`/api/teams/${team.id}/groups/${groupId}`, { method: 'DELETE', cookie: admin.cookie })).status, 200)
    assert.deepEqual((await api.request(`/api/teams/${team.id}/groups`, { cookie: admin.cookie })).payload.groups, [])
  } finally { await api.close() }
})

test('private team event stream notifies members, replays missed updates, and hides teams from outsiders', async () => {
  const api = await startApi()
  const streams = []
  async function connect(cookie, teamId, lastEventId) {
    const controller = new AbortController()
    const headers = { origin: ORIGIN, cookie }
    if (lastEventId !== undefined) headers['last-event-id'] = String(lastEventId)
    const response = await fetch(`${api.base}/api/teams/${teamId}/events`, { headers, signal: controller.signal })
    if (!response.ok) return { response, controller }
    const reader = response.body.getReader()
    let carry = ''
    streams.push(controller)
    return { response, controller, async nextEvent() {
      const deadline = Date.now() + 3000
      while (Date.now() < deadline) {
        const delimiter = carry.indexOf('\n\n')
        if (delimiter >= 0) {
          const frame = carry.slice(0, delimiter)
          carry = carry.slice(delimiter + 2)
          const id = frame.match(/^id: (\d+)$/m)?.[1]
          const data = frame.match(/^data: (.+)$/m)?.[1]
          if (data) return { id: id ? Number(id) : undefined, event: JSON.parse(data) }
          continue
        }
        let timer
        let result
        try {
          result = await Promise.race([
            reader.read(),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out waiting for SSE frame')), Math.max(1, deadline - Date.now())) }),
          ])
        } finally { clearTimeout(timer) }
        const { value, done } = result
        if (done) throw new Error('SSE stream ended unexpectedly')
        carry += new TextDecoder().decode(value, { stream: true })
      }
      throw new Error('Timed out waiting for SSE frame')
    } }
  }
  try {
    const admin = await registerAndLogin(api, 'Events admin', 'events-admin@example.test')
    const member = await registerAndLogin(api, 'Events member', 'events-member@example.test')
    const outsider = await registerAndLogin(api, 'Events outsider', 'events-outsider@example.test')
    const team = (await api.request('/api/teams', { method: 'POST', cookie: admin.cookie, body: { name: 'Event team' } })).payload.team
    const invite = (await api.request(`/api/teams/${team.id}/invitations`, { method: 'POST', cookie: admin.cookie, body: { email: member.user.email } })).payload.invitation
    assert.equal((await api.request(`/api/team-invitations/${invite.token}`, { method: 'POST', cookie: member.cookie })).status, 200)

    const denied = await connect(outsider.cookie, team.id)
    assert.equal(denied.response.status, 404)
    const adminStream = await connect(admin.cookie, team.id)
    const memberStream = await connect(member.cookie, team.id)
    assert.equal((await adminStream.nextEvent()).event.type, 'ready')
    assert.equal((await memberStream.nextEvent()).event.type, 'ready')

    const created = await api.request(`/api/teams/${team.id}/groups`, { method: 'POST', cookie: admin.cookie, body: { name: 'Shared group' } })
    assert.equal(created.status, 201)
    const adminUpdate = await adminStream.nextEvent()
    const memberUpdate = await memberStream.nextEvent()
    assert.deepEqual(adminUpdate.event, { type: 'team.updated' })
    assert.deepEqual(memberUpdate.event, { type: 'team.updated' })
    assert.equal(adminUpdate.id, memberUpdate.id)
    assert.equal(JSON.stringify(adminUpdate.event).includes('@'), false)

    memberStream.controller.abort()
    await new Promise(resolve => setTimeout(resolve, 30))
    const renamed = await api.request(`/api/teams/${team.id}/groups/${created.payload.group.id}`, { method: 'PATCH', cookie: admin.cookie, body: { name: 'Renamed group' } })
    assert.equal(renamed.status, 200)
    const secondUpdate = await adminStream.nextEvent()
    assert.equal(secondUpdate.event.type, 'team.updated')
    const reconnected = await connect(member.cookie, team.id, adminUpdate.id)
    assert.equal((await reconnected.nextEvent()).event.type, 'ready')
    const replayed = await reconnected.nextEvent()
    assert.deepEqual(replayed.event, { type: 'team.updated' })
    assert.equal(replayed.id, secondUpdate.id)
  } finally {
    for (const controller of streams) controller.abort()
    await api.close()
  }
})

test('document invitations stay pending until the matching account accepts and can be revoked safely', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Invite owner', 'invite-owner@example.test')
    const attacker = await registerAndLogin(api, 'Wrong recipient', 'wrong-recipient@example.test')
    const invitedEmail = 'future-collaborator@example.test'
    const document = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Invited project', data: { type: 'design', width: 794, height: 1123, pages: [{ id: 'invite-page', name: 'Page 1', background: '#ffffff', elements: [] }] } } })
    const documentId = document.payload.id
    const created = await api.request(`/api/documents/${documentId}/invitations`, { method: 'POST', cookie: owner.cookie, body: { email: invitedEmail, role: 'commenter' } })
    assert.equal(created.status, 201)
    assert.match(created.payload.invitation.token, /^[A-Za-z0-9_-]{43}$/)
    assert.deepEqual(created.payload.invitation.delivery, { status: 'link-only', reason: 'test-sandbox' }, 'API tests never send real invitation emails')
    assert.equal(Date.parse(created.payload.invitation.expiresAt) - Date.parse(created.payload.invitation.createdAt), 7 * 24 * 60 * 60 * 1000)
    assert.equal((await api.request(`/api/documents/${documentId}`, { cookie: attacker.cookie })).status, 404)
    assert.equal((await api.request(`/api/invitations/${created.payload.invitation.token}`, { cookie: attacker.cookie })).status, 403, 'wrong account cannot inspect invite details')
    assert.equal((await api.request(`/api/invitations/${created.payload.invitation.token}`, { method: 'POST', cookie: attacker.cookie })).status, 403)
    const ownerList = await api.request(`/api/documents/${documentId}/invitations`, { cookie: owner.cookie })
    assert.equal(ownerList.payload.invitations.length, 1)
    assert.equal(ownerList.payload.invitations[0].email, invitedEmail)
    assert.equal('token' in ownerList.payload.invitations[0], false, 'raw tokens are only returned once on invite creation')
    assert.equal((await api.request(`/api/documents/${documentId}/invitations`, { cookie: attacker.cookie })).status, 404)

    const invited = await registerAndLogin(api, 'Future collaborator', invitedEmail)
    const inspected = await api.request(`/api/invitations/${created.payload.invitation.token}`, { cookie: invited.cookie })
    assert.equal(inspected.status, 200)
    assert.equal(inspected.payload.invitation.documentName, 'Invited project')
    assert.equal(inspected.payload.invitation.role, 'commenter')
    const accepted = await api.request(`/api/invitations/${created.payload.invitation.token}`, { method: 'POST', cookie: invited.cookie })
    assert.equal(accepted.status, 200)
    assert.equal(accepted.payload.role, 'commenter')
    assert.equal((await api.request(`/api/documents/${documentId}`, { cookie: invited.cookie })).payload.role, 'commenter')
    assert.equal((await api.request(`/api/documents/${documentId}`, { method: 'PUT', cookie: invited.cookie, body: { revision: 1, name: 'No edit', data: {} } })).status, 403)
    assert.equal((await api.request(`/api/invitations/${created.payload.invitation.token}`, { method: 'POST', cookie: invited.cookie })).status, 404)
    assert.ok((await api.request(`/api/documents/${documentId}/invitations`, { cookie: owner.cookie })).payload.invitations[0].acceptedAt)

    const revokedInvite = await api.request(`/api/documents/${documentId}/invitations`, { method: 'POST', cookie: owner.cookie, body: { email: 'cancelled-collaborator@example.test', role: 'viewer' } })
    assert.equal(revokedInvite.status, 201)
    assert.equal((await api.request(`/api/documents/${documentId}/invitations/${revokedInvite.payload.invitation.id}`, { method: 'DELETE', cookie: owner.cookie })).status, 200)
    const cancelledRecipient = await registerAndLogin(api, 'Cancelled recipient', 'cancelled-collaborator@example.test')
    assert.equal((await api.request(`/api/invitations/${revokedInvite.payload.invitation.token}`, { cookie: cancelledRecipient.cookie })).status, 404)
    assert.equal((await api.request(`/api/documents/${documentId}/invitations/${created.payload.invitation.id}`, { method: 'DELETE', cookie: owner.cookie })).status, 404, 'accepted access must use permission revocation, not invitation cancellation')
  } finally { await api.close() }
})

test('team invitations grant shared project access only after acceptance and revocation removes it', async () => {
  const api = await startApi()
  try {
    const admin = await registerAndLogin(api, 'Team admin', 'team-admin@example.test')
    const stranger = await registerAndLogin(api, 'Team stranger', 'team-stranger@example.test')
    const createdTeam = await api.request('/api/teams', { method: 'POST', cookie: admin.cookie, body: { name: 'Studio team' } })
    assert.equal(createdTeam.status, 201)
    const teamId = createdTeam.payload.team.id
    const team = await api.request(`/api/teams/${teamId}`, { cookie: admin.cookie })
    assert.equal(team.payload.members.length, 1)
    assert.equal(team.payload.members[0].role, 'admin')
    const createdDocument = await api.request('/api/documents', { method: 'POST', cookie: admin.cookie, body: { name: 'Team file', teamId, data: { type: 'design', width: 794, pages: [{ id: 'team-page', elements: [] }] } } })
    assert.equal(createdDocument.status, 201)
    assert.equal(createdDocument.payload.teamId, teamId)
    const invitation = await api.request(`/api/teams/${teamId}/invitations`, { method: 'POST', cookie: admin.cookie, body: { email: 'team-member@example.test', role: 'member' } })
    assert.equal(invitation.status, 201)
    assert.match(invitation.payload.invitation.token, /^[A-Za-z0-9_-]{43}$/)
    assert.deepEqual(invitation.payload.invitation.delivery, { status: 'link-only', reason: 'test-sandbox' }, 'team invitation tests never send real email')
    const cancelledInvitation = await api.request(`/api/teams/${teamId}/invitations`, { method: 'POST', cookie: admin.cookie, body: { email: 'team-cancelled@example.test' } })
    assert.equal(cancelledInvitation.status, 201)
    assert.equal((await api.request(`/api/teams/${teamId}/invitations/${cancelledInvitation.payload.invitation.id}`, { method: 'DELETE', cookie: admin.cookie })).status, 200)
    const invitations = await api.request(`/api/teams/${teamId}/invitations`, { cookie: admin.cookie })
    assert.ok(invitations.payload.invitations.find(item => item.id === cancelledInvitation.payload.invitation.id).revokedAt)
    assert.equal((await api.request(`/api/team-invitations/${cancelledInvitation.payload.invitation.token}`, { cookie: stranger.cookie })).status, 404)
    assert.equal((await api.request(`/api/documents/${createdDocument.payload.id}`, { cookie: stranger.cookie })).status, 404)
    assert.equal((await api.request(`/api/team-invitations/${invitation.payload.invitation.token}`, { cookie: stranger.cookie })).status, 403)
    const adminInvite = await api.request(`/api/teams/${teamId}/invitations`, { method: 'POST', cookie: admin.cookie, body: { email: 'team-admin-two@example.test', role: 'admin' } })
    assert.equal(adminInvite.status, 201)
    const adminTwo = await registerAndLogin(api, 'Second admin', 'team-admin-two@example.test')
    assert.equal((await api.request(`/api/team-invitations/${adminInvite.payload.invitation.token}`, { method: 'POST', cookie: adminTwo.cookie })).status, 200)
    assert.equal((await api.request(`/api/teams/${teamId}`, { cookie: adminTwo.cookie })).payload.team.role, 'admin')
    const member = await registerAndLogin(api, 'Team member', 'team-member@example.test')
    assert.equal((await api.request(`/api/teams/${teamId}/invitations`, { method: 'POST', cookie: member.cookie, body: { email: 'blocked@example.test' } })).status, 403)
    const inspected = await api.request(`/api/team-invitations/${invitation.payload.invitation.token}`, { cookie: member.cookie })
    assert.equal(inspected.status, 200)
    assert.equal(inspected.payload.invitation.teamName, 'Studio team')
    const accepted = await api.request(`/api/team-invitations/${invitation.payload.invitation.token}`, { method: 'POST', cookie: member.cookie })
    assert.equal(accepted.status, 200)
    const remoteDocs = await api.request('/api/documents', { cookie: member.cookie })
    assert.equal(remoteDocs.payload.documents[0].id, createdDocument.payload.id)
    assert.equal(remoteDocs.payload.documents[0].role, 'editor')
    const memberDocument = await api.request(`/api/documents/${createdDocument.payload.id}`, { cookie: member.cookie })
    assert.equal(memberDocument.status, 200)
    const memberEdit = await api.request(`/api/documents/${createdDocument.payload.id}`, { method: 'PUT', cookie: member.cookie, body: { revision: 1, name: 'Team member edit', data: createdDocument.payload.data } })
    assert.equal(memberEdit.status, 200)
    assert.equal((await api.request(`/api/documents/${createdDocument.payload.id}`, { cookie: admin.cookie })).payload.name, 'Team member edit')
    const memberAudit = await api.request(`/api/teams/${teamId}/audit`, { cookie: member.cookie })
    assert.equal(memberAudit.status, 403)
    const audit = await api.request(`/api/teams/${teamId}/audit?limit=100`, { cookie: admin.cookie })
    assert.equal(audit.status, 200)
    assert.ok(audit.payload.events.some(event => event.action === 'team.created'))
    assert.ok(audit.payload.events.some(event => event.action === 'team.invitation.created' && event.details.email === 'team-member@example.test'))
    const createdAudit = audit.payload.events.find(event => event.action === 'document.created')
    assert.deepEqual(createdAudit.details, { name: 'Team file' }, 'audit omits document contents')
    for (let index = 0; index < 7; index += 1) {
      await api.request(`/api/documents/${createdDocument.payload.id}/comments`, { method: 'POST', cookie: admin.cookie, body: { pageId: 'team-page', content: `audit-pagination-${index}` } })
    }
    const nextPage = await api.request(`/api/teams/${teamId}/audit?limit=3`, { cookie: admin.cookie })
    assert.equal(nextPage.status, 200)
    assert.ok(nextPage.payload.nextBefore)
    const followingPage = await api.request(`/api/teams/${teamId}/audit?limit=3&before=${encodeURIComponent(nextPage.payload.nextBefore)}`, { cookie: admin.cookie })
    assert.equal(followingPage.status, 200)
    const firstIds = new Set(nextPage.payload.events.map(event => event.id))
    assert.ok(followingPage.payload.events.every(event => !firstIds.has(event.id)))
    const secondIds = new Set(followingPage.payload.events.map(event => event.id))
    const lastPage = await api.request(`/api/teams/${teamId}/audit?limit=3&before=${encodeURIComponent(followingPage.payload.nextBefore)}`, { cookie: admin.cookie })
    assert.equal(lastPage.status, 200)
    assert.ok(lastPage.payload.events.every(event => !firstIds.has(event.id) && !secondIds.has(event.id)))
    assert.equal((await api.request(`/api/teams/${teamId}/audit?limit=3&before=invalid`, { cookie: admin.cookie })).status, 400)
    assert.equal((await api.request(`/api/teams/${teamId}/members?userId=${member.user.id}`, { method: 'DELETE', cookie: admin.cookie })).status, 200)
    assert.equal((await api.request(`/api/documents/${createdDocument.payload.id}`, { cookie: member.cookie })).status, 404)
    assert.equal((await api.request(`/api/teams/${teamId}`, { cookie: member.cookie })).status, 404)
  } finally { await api.close() }
})

test('document and team invite routes use an injected email adapter after storing the invitation', async () => {
  const deliveries = []
  const api = await startApi({ invitationEmailSender: async invitation => { deliveries.push(invitation); return { status: 'sent' } } })
  try {
    const owner = await registerAndLogin(api, 'Email adapter owner', 'email-adapter-owner@example.test')
    const document = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Email project', data: { type: 'design', width: 794, height: 1123, pages: [{ id: 'email-page', elements: [] }] } } })
    const documentInvite = await api.request(`/api/documents/${document.payload.id}/invitations`, { method: 'POST', cookie: owner.cookie, body: { email: 'document-recipient@example.test', role: 'viewer' } })
    assert.equal(documentInvite.status, 201)
    assert.deepEqual(documentInvite.payload.invitation.delivery, { status: 'sent' })
    const team = await api.request('/api/teams', { method: 'POST', cookie: owner.cookie, body: { name: 'Email team' } })
    const teamInvite = await api.request(`/api/teams/${team.payload.team.id}/invitations`, { method: 'POST', cookie: owner.cookie, body: { email: 'team-recipient@example.test' } })
    assert.equal(teamInvite.status, 201)
    assert.deepEqual(teamInvite.payload.invitation.delivery, { status: 'sent' })
    assert.deepEqual(deliveries.map(({ kind, email, targetName, roleLabel }) => ({ kind, email, targetName, roleLabel })), [
      { kind: 'document', email: 'document-recipient@example.test', targetName: 'Email project', roleLabel: 'visualizador' },
      { kind: 'team', email: 'team-recipient@example.test', targetName: 'Email team', roleLabel: 'integrante' },
    ])
    assert.ok(deliveries.every(item => /^[A-Za-z0-9_-]{43}$/.test(item.token)))
  } finally { await api.close() }
})

test('provider exceptions and invalid responses keep persisted invitations usable by link', async () => {
  let attempts = 0
  const api = await startApi({ invitationEmailSender: async () => {
    attempts += 1
    if (attempts === 1) throw new Error('provider outage')
    return { status: 'queued' }
  } })
  try {
    const owner = await registerAndLogin(api, 'Delivery failure owner', 'delivery-failure@example.test')
    const document = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Surviving invite', data: { type: 'design', width: 794, height: 1123, pages: [{ id: 'invite-page', elements: [] }] } } })
    const documentInvite = await api.request(`/api/documents/${document.payload.id}/invitations`, { method: 'POST', cookie: owner.cookie, body: { email: 'document-link@example.test', role: 'viewer' } })
    assert.equal(documentInvite.status, 201)
    assert.deepEqual(documentInvite.payload.invitation.delivery, { status: 'failed', reason: 'provider-unavailable' })
    const documentInvitations = await api.request(`/api/documents/${document.payload.id}/invitations`, { cookie: owner.cookie })
    assert.ok(documentInvitations.payload.invitations.some(invitation => invitation.id === documentInvite.payload.invitation.id))
    const documentRecipient = await registerAndLogin(api, 'Document link recipient', 'document-link@example.test')
    assert.equal((await api.request(`/api/invitations/${documentInvite.payload.invitation.token}`, { cookie: documentRecipient.cookie })).status, 200)

    const team = await api.request('/api/teams', { method: 'POST', cookie: owner.cookie, body: { name: 'Surviving team invite' } })
    const teamInvite = await api.request(`/api/teams/${team.payload.team.id}/invitations`, { method: 'POST', cookie: owner.cookie, body: { email: 'team-link@example.test' } })
    assert.equal(teamInvite.status, 201)
    assert.deepEqual(teamInvite.payload.invitation.delivery, { status: 'failed', reason: 'provider-invalid-response' })
    const teamInvitations = await api.request(`/api/teams/${team.payload.team.id}/invitations`, { cookie: owner.cookie })
    assert.ok(teamInvitations.payload.invitations.some(invitation => invitation.id === teamInvite.payload.invitation.id))
    const teamRecipient = await registerAndLogin(api, 'Team link recipient', 'team-link@example.test')
    assert.equal((await api.request(`/api/team-invitations/${teamInvite.payload.invitation.token}`, { cookie: teamRecipient.cookie })).status, 200)
  } finally { await api.close() }
})

test('team administrators manage roles while safe self-leave preserves an administrator and audit history', async () => {
  const api = await startApi()
  let removedMemberReader
  let memberReader
  try {
    const admin = await registerAndLogin(api, 'Team admin', 'team-admin-roles@example.test')
    const member = await registerAndLogin(api, 'Team member', 'team-member-roles@example.test')
    const removedMember = await registerAndLogin(api, 'Removed member', 'team-removed-member@example.test')
    const createdTeam = await api.request('/api/teams', { method: 'POST', cookie: admin.cookie, body: { name: 'Role management team' } })
    const teamId = createdTeam.payload.team.id
    const invitation = await api.request(`/api/teams/${teamId}/invitations`, { method: 'POST', cookie: admin.cookie, body: { email: member.user.email } })
    assert.equal((await api.request(`/api/team-invitations/${invitation.payload.invitation.token}`, { method: 'POST', cookie: member.cookie })).status, 200)
    const document = await api.request('/api/documents', { method: 'POST', cookie: admin.cookie, body: { name: 'Team project', teamId, data: { type: 'design', width: 794, pages: [{ id: 'page-1', elements: [] }] } } })

    assert.equal((await api.request(`/api/teams/${teamId}/members`, { method: 'PATCH', cookie: admin.cookie, body: { userId: admin.user.id, role: 'member' } })).status, 400, 'last administrator cannot demote themself')
    assert.equal((await api.request(`/api/teams/${teamId}/members`, { method: 'PATCH', cookie: member.cookie, body: { userId: member.user.id, role: 'admin' } })).status, 403, 'members cannot change roles')
    assert.equal((await api.request(`/api/teams/${teamId}/members?userId=${admin.user.id}`, { method: 'DELETE', cookie: member.cookie })).status, 403, 'members cannot remove another member')
    assert.equal((await api.request(`/api/teams/${teamId}/members?userId=${admin.user.id}`, { method: 'DELETE', cookie: admin.cookie })).status, 409, 'the final administrator cannot leave while members remain')

    const memberStream = await fetch(`${api.base}/api/documents/${document.payload.id}/events`, { headers: { cookie: member.cookie } })
    assert.equal(memberStream.status, 200)
    memberReader = memberStream.body.getReader()
    const memberStreamState = { buffer: '' }
    await readSseEvent(memberReader, memberStreamState, 'ready')
    await readSseEvent(memberReader, memberStreamState, 'presence.updated')
    assert.equal((await api.request(`/api/documents/${document.payload.id}/permissions`, {
      method: 'POST', cookie: admin.cookie, body: { email: member.user.email, role: 'editor' },
    })).status, 201)
    const grantedEvent = await readSseEvent(memberReader, memberStreamState, 'access.changed')
    assert.equal(grantedEvent.role, 'editor', 'team membership grants effective editor access over direct permission')
    assert.equal((await api.request(`/api/documents/${document.payload.id}/permissions/${member.user.id}`, { method: 'DELETE', cookie: admin.cookie })).status, 200)
    const permissionRevokedEvent = await readSseEvent(memberReader, memberStreamState, 'access.changed')
    assert.equal(permissionRevokedEvent.role, 'editor', 'revoking a direct permission preserves team-based editor access')
    assert.equal((await api.request(`/api/documents/${document.payload.id}`, { cookie: member.cookie })).status, 200)

    assert.equal((await api.request(`/api/teams/${teamId}/members`, { method: 'PATCH', cookie: admin.cookie, body: { userId: member.user.id, role: 'admin' } })).status, 200)
    const promotedEvent = await readSseEvent(memberReader, memberStreamState, 'access.changed')
    assert.equal(promotedEvent.role, 'owner', 'an open document session receives the updated administrator role')
    const secondInvitation = await api.request(`/api/teams/${teamId}/invitations`, { method: 'POST', cookie: admin.cookie, body: { email: removedMember.user.email } })
    assert.equal((await api.request(`/api/team-invitations/${secondInvitation.payload.invitation.token}`, { method: 'POST', cookie: removedMember.cookie })).status, 200)
    const teamStream = await fetch(`${api.base}/api/documents/${document.payload.id}/events`, { headers: { cookie: removedMember.cookie } })
    assert.equal(teamStream.status, 200)
    removedMemberReader = teamStream.body.getReader()
    const streamState = { buffer: '' }
    await readSseEvent(removedMemberReader, streamState, 'ready')
    await readSseEvent(removedMemberReader, streamState, 'presence.updated')
    assert.equal((await api.request(`/api/teams/${teamId}/members?userId=${removedMember.user.id}`, { method: 'DELETE', cookie: admin.cookie })).status, 200)
    await readSseEvent(removedMemberReader, streamState, 'access.revoked')
    assert.equal((await api.request(`/api/documents/${document.payload.id}`, { cookie: removedMember.cookie })).status, 404, 'team removal revokes a live subscriber and subsequent reads')
    assert.equal((await api.request(`/api/teams/${teamId}/members?userId=${admin.user.id}`, { method: 'DELETE', cookie: admin.cookie })).status, 200, 'an administrator can leave when another administrator remains')
    assert.equal((await api.request(`/api/documents/${document.payload.id}`, { cookie: admin.cookie })).status, 200, 'leaving preserves access to a document the person owns')
    assert.equal((await api.request('/api/teams', { cookie: admin.cookie })).payload.teams.some(team => team.id === teamId), false, 'leaving removes the team from the former administrator account')
    const team = await api.request(`/api/teams/${teamId}`, { cookie: member.cookie })
    assert.equal(team.status, 200)
    assert.equal(team.payload.members.length, 1)
    assert.equal(team.payload.members[0].role, 'admin')
    const audit = await api.request(`/api/teams/${teamId}/audit?limit=100`, { cookie: member.cookie })
    assert.ok(audit.payload.events.some(event => event.action === 'team.member.left' && event.targetId === admin.user.id))
  } finally { await Promise.all([removedMemberReader?.cancel(), memberReader?.cancel()]); await api.close() }
})

test('accounts, roles, comments and revision conflicts are enforced across users', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Owner', 'owner@example.test')
    const viewer = await registerAndLogin(api, 'Viewer', 'viewer@example.test')
    const commenter = await registerAndLogin(api, 'Commenter', 'commenter@example.test')
    const editor = await registerAndLogin(api, 'Editor', 'editor@example.test')

    const ownProfile = await api.request('/api/auth/me', { cookie: owner.cookie })
    assert.equal(ownProfile.payload.user.email, 'owner@example.test')

    const created = await api.request('/api/documents', {
      method: 'POST', cookie: owner.cookie,
      body: { name: 'A4 compartilhado', data: { width: 794, pages: [{ id: 'page-1', elements: [] }] } },
    })
    assert.equal(created.status, 201)
    assert.equal(created.payload.revision, 1)
    const id = created.payload.id

    assert.equal((await api.request(`/api/documents/${id}`, { cookie: viewer.cookie })).status, 404)
    const grantViewer = await api.request(`/api/documents/${id}/permissions`, {
      method: 'POST', cookie: owner.cookie, body: { email: viewer.user.email, role: 'viewer' },
    })
    assert.equal(grantViewer.status, 201)
    assert.equal((await api.request(`/api/documents/${id}`, { cookie: viewer.cookie })).payload.role, 'viewer')
    assert.equal((await api.request(`/api/documents/${id}`, {
      method: 'PUT', cookie: viewer.cookie,
      body: { revision: 1, name: 'Edi????o proibida', data: { width: 794 } },
    })).status, 403)

    await api.request(`/api/documents/${id}/permissions`, {
      method: 'POST', cookie: owner.cookie, body: { email: commenter.user.email, role: 'commenter' },
    })
    const comment = await api.request(`/api/documents/${id}/comments`, {
      method: 'POST', cookie: commenter.cookie, body: { pageId: 'page-1', content: 'Alinhar este t??tulo.' },
    })
    assert.equal(comment.status, 201)
    assert.equal(comment.payload.comment.authorId, commenter.user.id)
    const reply = await api.request(`/api/documents/${id}/comments`, {
      method: 'POST', cookie: owner.cookie, body: { parentId: comment.payload.comment.id, pageId: 'outra-pagina', elementId: 'elemento-arbitr??rio', content: 'Ajustei o t??tulo.' },
    })
    assert.equal(reply.status, 201)
    assert.equal(reply.payload.comment.parentId, comment.payload.comment.id)
    assert.equal(reply.payload.comment.pageId, 'page-1')
    assert.equal(reply.payload.comment.elementId, null)
    assert.equal((await api.request(`/api/documents/${id}/comments`, { cookie: owner.cookie })).payload.comments.length, 2)
    assert.equal((await api.request(`/api/documents/${id}/comments`, {
      method: 'POST', cookie: commenter.cookie, body: { parentId: reply.payload.comment.id, content: 'Resposta aninhada n??o suportada.' },
    })).status, 400)
    const commentStream = await fetch(`${api.base}/api/documents/${id}/events`, { headers: { cookie: owner.cookie } })
    const commentReader = commentStream.body.getReader()
    const commentSseState = { buffer: '' }
    await readSseEvent(commentReader, commentSseState, 'ready')
    await readSseEvent(commentReader, commentSseState, 'presence.updated')
    const resolved = await api.request(`/api/documents/${id}/comments/${comment.payload.comment.id}`, {
      method: 'PATCH', cookie: owner.cookie, body: { resolved: true },
    })
    assert.equal(resolved.status, 200)
    assert.equal(resolved.payload.comment.resolvedBy, owner.user.id)
    const resolvedEvent = await readSseEvent(commentReader, commentSseState, 'comments.updated')
    assert.equal(resolvedEvent.type, 'comments.updated')
    const listedComments = (await api.request(`/api/documents/${id}/comments`, { cookie: owner.cookie })).payload.comments
    assert.ok(listedComments.find(item => item.id === comment.payload.comment.id).resolvedAt)
    assert.equal((await api.request(`/api/documents/${id}/comments/${comment.payload.comment.id}`, {
      method: 'PATCH', cookie: viewer.cookie, body: { resolved: false },
    })).status, 403)
    assert.equal((await api.request(`/api/documents/${id}/comments`, {
      method: 'POST', cookie: viewer.cookie, body: { content: 'N??o posso comentar.' },
    })).status, 403)
    const reopened = await api.request(`/api/documents/${id}/comments/${comment.payload.comment.id}`, { method: 'PATCH', cookie: owner.cookie, body: { resolved: false } })
    assert.equal(reopened.status, 200)
    await commentReader.cancel()

    await api.request(`/api/documents/${id}/permissions`, {
      method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' },
    })
    const saved = await api.request(`/api/documents/${id}`, {
      method: 'PUT', cookie: editor.cookie,
      body: { revision: 1, name: 'A4 revisado', data: { width: 794, pages: [{ id: 'page-1', elements: [{ id: 'text-1' }] }] } },
    })
    assert.equal(saved.status, 200)
    assert.equal(saved.payload.revision, 2)
    assert.equal(saved.payload.role, 'editor')

    const conflict = await api.request(`/api/documents/${id}`, {
      method: 'PUT', cookie: owner.cookie,
      body: { revision: 1, name: 'Vers??o desatualizada', data: { width: 794 } },
    })
    assert.equal(conflict.status, 409)
    assert.equal(conflict.payload.current.revision, 2)
    assert.equal(conflict.payload.current.name, 'A4 revisado')

    const simultaneous = await Promise.all([
      api.request(`/api/documents/${id}`, {
        method: 'PUT', cookie: owner.cookie,
        body: { revision: 2, name: 'Salvo pelo propriet??rio', data: { actor: 'owner' } },
      }),
      api.request(`/api/documents/${id}`, {
        method: 'PUT', cookie: editor.cookie,
        body: { revision: 2, name: 'Salvo pelo editor', data: { actor: 'editor' } },
      }),
    ])
    assert.deepEqual(simultaneous.map(result => result.status).sort(), [200, 409])
    const afterRace = await api.request(`/api/documents/${id}`, { cookie: owner.cookie })
    assert.equal(afterRace.payload.revision, 3)
    assert.ok(['Salvo pelo propriet??rio', 'Salvo pelo editor'].includes(afterRace.payload.name))

    const deniedPermissionList = await api.request(`/api/documents/${id}/permissions`, { cookie: editor.cookie })
    assert.equal(deniedPermissionList.status, 403)
    const updatedRole = await api.request(`/api/documents/${id}/permissions`, {
      method: 'POST', cookie: owner.cookie, body: { email: viewer.user.email, role: 'commenter' },
    })
    assert.equal(updatedRole.payload.permission.role, 'commenter')
    const revoked = await api.request(`/api/documents/${id}/permissions/${viewer.user.id}`, { method: 'DELETE', cookie: owner.cookie })
    assert.equal(revoked.status, 200)
    assert.equal((await api.request(`/api/documents/${id}`, { cookie: viewer.cookie })).status, 404)

    assert.equal((await api.request('/api/auth/logout', { method: 'POST', cookie: owner.cookie })).status, 200)
    assert.equal((await api.request('/api/auth/me', { cookie: owner.cookie })).status, 401)
    assert.equal((await api.request('/api/auth/register', {
      method: 'POST', origin: 'https://unexpected.example', body: { name: 'X', email: 'x@example.test', password: 'Fuse-Studio-Password-42' },
    })).status, 403)
  } finally {
    await api.close()
  }
})

test('comment mentions create private in-app notifications only for document collaborators with read state', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Mention Owner', 'mention-owner@example.test')
    const commenter = await registerAndLogin(api, 'Mention Guest', 'mention-guest@example.test')
    const outsider = await registerAndLogin(api, 'Mention Outsider', 'mention-outsider@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Mentions', data: { width: 794, pages: [{ id: 'page-1', elements: [] }] } } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: commenter.user.email, role: 'commenter' } })
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: outsider.user.email, role: 'viewer' } })
    const collaborators = await api.request(`/api/documents/${id}/collaborators`, { cookie: commenter.cookie })
    assert.equal(collaborators.status, 200)
    assert.equal(collaborators.payload.collaborators.find(item => item.id === commenter.user.id).email, commenter.user.email)
    assert.equal('email' in collaborators.payload.collaborators.find(item => item.id === outsider.user.id), false)
    assert.equal((await api.request(`/api/documents/${id}/collaborators`, { cookie: outsider.cookie })).payload.collaborators.find(item => item.id === commenter.user.id).email, undefined)
    const comment = await api.request(`/api/documents/${id}/comments`, { method: 'POST', cookie: owner.cookie, body: { pageId: 'page-1', content: `Revisar @${commenter.user.email} e @${outsider.user.email}` } })
    assert.equal(comment.status, 201)
    const guestNotifications = await api.request('/api/notifications', { cookie: commenter.cookie })
    assert.equal(guestNotifications.payload.unreadCount, 1)
    assert.equal(guestNotifications.payload.notifications[0].commentId, comment.payload.comment.id)
    assert.equal(guestNotifications.payload.notifications[0].actorId, owner.user.id)
    const viewerNotifications = await api.request('/api/notifications', { cookie: outsider.cookie })
    assert.equal(viewerNotifications.payload.unreadCount, 1, 'a viewer who can read the thread also receives a direct mention')
    assert.equal(viewerNotifications.payload.notifications[0].commentId, comment.payload.comment.id)
    const notificationId = guestNotifications.payload.notifications[0].id
    assert.equal((await api.request(`/api/notifications/${notificationId}`, { method: 'PATCH', cookie: owner.cookie, body: { read: true } })).status, 404)
    assert.equal((await api.request(`/api/notifications/${notificationId}`, { method: 'PATCH', cookie: commenter.cookie, body: { read: true } })).status, 200)
    assert.equal((await api.request('/api/notifications', { cookie: commenter.cookie })).payload.unreadCount, 0)
    assert.equal((await api.request(`/api/notifications/${notificationId}`, { method: 'PATCH', cookie: commenter.cookie, body: { read: false } })).status, 200)
    assert.equal((await api.request('/api/notifications', { cookie: commenter.cookie })).payload.unreadCount, 1)
  } finally { await api.close() }
})

test('revoked-project notifications do not hide older notifications from projects the user can still access', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Notification Owner', 'notification-limit-owner@example.test')
    const recipient = await registerAndLogin(api, 'Notification Recipient', 'notification-limit-recipient@example.test')
    const createDocument = async name => (await api.request('/api/documents', {
      method: 'POST', cookie: owner.cookie,
      body: { name, data: { width: 794, pages: [{ id: 'page-1', elements: [] }] } },
    })).payload.id
    const grantViewer = async documentId => api.request(`/api/documents/${documentId}/permissions`, {
      method: 'POST', cookie: owner.cookie, body: { email: recipient.user.email, role: 'viewer' },
    })
    const mention = async documentId => api.request(`/api/documents/${documentId}/comments`, {
      method: 'POST', cookie: owner.cookie,
      body: { pageId: 'page-1', content: `Acompanhar @${recipient.user.email}` },
    })

    const retainedDocument = await createDocument('Still shared')
    await grantViewer(retainedDocument)
    const retainedComment = await mention(retainedDocument)
    assert.equal(retainedComment.status, 201)

    const revokedDocument = await createDocument('Access revoked')
    await grantViewer(revokedDocument)
    for (let index = 0; index < 101; index += 1) {
      assert.equal((await mention(revokedDocument)).status, 201)
    }
    assert.equal((await api.request(`/api/documents/${revokedDocument}/permissions/${recipient.user.id}`, {
      method: 'DELETE', cookie: owner.cookie,
    })).status, 200)

    const feed = await api.request('/api/notifications', { cookie: recipient.cookie })
    assert.equal(feed.status, 200)
    assert.equal(feed.payload.notifications.some(item => item.commentId === retainedComment.payload.comment.id), true)
    assert.equal(feed.payload.notifications.some(item => item.documentId === revokedDocument), false)
    assert.equal(feed.payload.unreadCount, 1)
  } finally { await api.close() }
})

test('notification SSE is private, authenticated, and replays missed events after reconnect', async () => {
  const api = await startApi()
  const streams = []
  try {
    const owner = await registerAndLogin(api, 'SSE Owner', 'notification-sse-owner@example.test')
    const recipient = await registerAndLogin(api, 'SSE Recipient', 'notification-sse-recipient@example.test')
    const other = await registerAndLogin(api, 'SSE Other', 'notification-sse-other@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Private SSE', data: { width: 794, pages: [{ id: 'page-1', elements: [] }] } } })
    const documentId = created.payload.id
    await api.request(`/api/documents/${documentId}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: recipient.user.email, role: 'commenter' } })
    assert.equal((await api.request('/api/notifications/events')).status, 401)

    const connect = async cookie => {
      const response = await fetch(`${api.base}/api/notifications/events`, { headers: { cookie } })
      streams.push(response.body.getReader())
      return { reader: streams.at(-1), state: { buffer: '' } }
    }
    const recipientStream = await connect(recipient.cookie)
    const otherStream = await connect(other.cookie)
    await readSseEvent(recipientStream.reader, recipientStream.state, 'ready')
    await readSseEvent(otherStream.reader, otherStream.state, 'ready')
    const comment = await api.request(`/api/documents/${documentId}/comments`, { method: 'POST', cookie: owner.cookie, body: { pageId: 'page-1', content: `Veja @${recipient.user.email}` } })
    const delivered = await readSseEventWithId(recipientStream.reader, recipientStream.state, 'notification.created')
    assert.equal(delivered.event.notificationId, (await api.request('/api/notifications', { cookie: recipient.cookie })).payload.notifications[0].id)
    assert.equal(otherStream.state.buffer, '', 'a different authenticated user receives no notification event')

    await recipientStream.reader.cancel()
    streams.splice(streams.indexOf(recipientStream.reader), 1)
    const replayResponse = await fetch(`${api.base}/api/notifications/events`, { headers: { cookie: recipient.cookie, 'last-event-id': '0' } })
    const replayReader = replayResponse.body.getReader()
    streams.push(replayReader)
    const replay = await readSseEventWithId(replayReader, { buffer: '' }, 'notification.created')
    assert.equal(replay.id, delivered.id)
    assert.equal(replay.event.notificationId, delivered.event.notificationId)

    await api.request('/api/auth/logout', { method: 'POST', cookie: recipient.cookie })
    await readSseEvent(replayReader, { buffer: '' }, 'auth.expired')
    assert.equal(comment.status, 201)
  } finally {
    for (const reader of streams) await reader.cancel().catch(() => {})
    await api.close()
  }
})

test('owners can suspend and resume collaborator access without deleting permissions', async () => {
  const api = await startApi()
  let reader
  try {
    const owner = await registerAndLogin(api, 'Access owner', 'suspend-owner@example.test')
    const collaborator = await registerAndLogin(api, 'Collaborator', 'suspend-collaborator@example.test')
    const invitee = await registerAndLogin(api, 'Invitee', 'suspend-invitee@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Temporary lock', data: { type: 'design', width: 794, pages: [{ id: 'p1', elements: [] }] } } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: collaborator.user.email, role: 'editor' } })
    const invitation = await api.request(`/api/documents/${id}/invitations`, { method: 'POST', cookie: owner.cookie, body: { email: invitee.user.email, role: 'viewer' } })
    const stream = await fetch(`${api.base}/api/documents/${id}/events`, { headers: { cookie: collaborator.cookie } })
    reader = stream.body.getReader()
    const state = { buffer: '' }
    await readSseEvent(reader, state, 'ready')
    await readSseEvent(reader, state, 'presence.updated')

    const suspended = await api.request(`/api/documents/${id}/access`, { method: 'PATCH', cookie: owner.cookie, body: { suspended: true } })
    assert.equal(suspended.status, 200)
    assert.equal(suspended.payload.accessSuspended, true)
    assert.equal((await readSseEvent(reader, state, 'access.revoked')).type, 'access.revoked')
    assert.equal((await api.request(`/api/documents/${id}`, { cookie: collaborator.cookie })).status, 404)
    assert.equal((await api.request('/api/documents', { cookie: collaborator.cookie })).payload.documents.some(document => document.id === id), false)
    assert.equal((await api.request(`/api/invitations/${invitation.payload.invitation.token}`, { cookie: invitee.cookie })).status, 404)
    assert.equal((await api.request(`/api/invitations/${invitation.payload.invitation.token}`, { method: 'POST', cookie: invitee.cookie, body: {} })).status, 404)
    assert.equal((await api.request(`/api/documents/${id}`, { cookie: owner.cookie })).payload.accessSuspended, true)

    const resumed = await api.request(`/api/documents/${id}/access`, { method: 'PATCH', cookie: owner.cookie, body: { suspended: false } })
    assert.equal(resumed.status, 200)
    assert.equal(resumed.payload.accessSuspended, false)
    assert.equal((await api.request(`/api/documents/${id}`, { cookie: collaborator.cookie })).payload.role, 'editor')
    assert.equal((await api.request('/api/documents', { cookie: collaborator.cookie })).payload.documents.some(document => document.id === id), true)
    assert.equal((await api.request(`/api/invitations/${invitation.payload.invitation.token}`, { cookie: invitee.cookie })).status, 200)
    assert.equal((await api.request(`/api/invitations/${invitation.payload.invitation.token}`, { method: 'POST', cookie: invitee.cookie, body: {} })).status, 200)
    assert.equal((await api.request(`/api/documents/${id}`, { cookie: invitee.cookie })).payload.role, 'viewer')
    assert.equal((await api.request(`/api/documents/${id}/access`, { method: 'PATCH', cookie: collaborator.cookie, body: { suspended: true } })).status, 403)
  } finally { await reader?.cancel(); await api.close() }
})

test('public view links are anonymous, read-only, rotatable and revocable', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Public owner', 'public-owner@example.test')
    const collaborator = await registerAndLogin(api, 'Public collaborator', 'public-collaborator@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Public preview', data: { type: 'design', width: 794, height: 1123, pages: [{ id: 'public-page', name: 'Page 1', background: '#ffffff', elements: [{ id: 'public-text', type: 'text', name: 'Greeting', x: 20, y: 30, width: 200, height: 40, rotation: 0, text: 'Read only', fontSize: 24, fontFamily: 'Arial', color: '#111111', bold: false }] }] } } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: collaborator.user.email, role: 'editor' } })
    assert.deepEqual((await api.request(`/api/documents/${id}/access`, { cookie: owner.cookie })).payload, { accessSuspended: false, publicLinkEnabled: false })
    assert.equal((await api.request(`/api/documents/${id}/access`, { cookie: collaborator.cookie })).status, 403)
    assert.equal((await api.request(`/api/documents/${id}/access`, { method: 'PATCH', cookie: collaborator.cookie, body: { publicLink: 'enable' } })).status, 403)

    const enabled = await api.request(`/api/documents/${id}/access`, { method: 'PATCH', cookie: owner.cookie, body: { publicLink: 'enable' } })
    assert.equal(enabled.status, 200)
    assert.equal(enabled.payload.publicLinkEnabled, true)
    assert.match(enabled.payload.token, /^[A-Za-z0-9_-]{40,}$/)
    const publicRead = await api.request(`/api/public-shares/${enabled.payload.token}`)
    assert.equal(publicRead.status, 200)
    assert.equal(publicRead.payload.name, 'Public preview')
    assert.equal(publicRead.payload.document.pages[0].elements[0].text, 'Read only')
    assert.equal(Object.hasOwn(publicRead.payload, 'ownerId'), false)
    assert.equal((await api.request(`/api/public-shares/${enabled.payload.token}`, { method: 'PATCH', body: { name: 'Anonymous edit' } })).status, 405)

    const rotated = await api.request(`/api/documents/${id}/access`, { method: 'PATCH', cookie: owner.cookie, body: { publicLink: 'rotate' } })
    assert.equal(rotated.status, 200)
    assert.notEqual(rotated.payload.token, enabled.payload.token)
    assert.equal((await api.request(`/api/public-shares/${enabled.payload.token}`)).status, 404)
    assert.equal((await api.request(`/api/public-shares/${rotated.payload.token}`)).status, 200)
    await api.request(`/api/documents/${id}/access`, { method: 'PATCH', cookie: owner.cookie, body: { suspended: true } })
    assert.equal((await api.request(`/api/public-shares/${rotated.payload.token}`)).status, 404)
    await api.request(`/api/documents/${id}/access`, { method: 'PATCH', cookie: owner.cookie, body: { suspended: false } })
    assert.equal((await api.request(`/api/public-shares/${rotated.payload.token}`)).status, 200)
    const revoked = await api.request(`/api/documents/${id}/access`, { method: 'PATCH', cookie: owner.cookie, body: { publicLink: 'revoke' } })
    assert.equal(revoked.payload.publicLinkEnabled, false)
    assert.equal((await api.request(`/api/public-shares/${rotated.payload.token}`)).status, 404)
  } finally { await api.close() }
})

test('public video links return only timeline-referenced media for playback', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Public video owner', 'public-video-owner@example.test')
    const usedSource = 'data:video/webm;base64,d2ViLXZpZGVvLWRhdGE='
    const unusedSource = 'data:audio/webm;base64,dW51c2VkLWF1ZGlv'
    const clip = { id: 'public-video-clip', assetId: 'video-used', name: 'scene.webm', kind: 'video', startMs: 0, durationMs: 1500, sourceDurationMs: 1500, sourceStartMs: 0, volume: 1 }
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Public video', data: { type: 'video', width: 160, height: 90, videoDurationMs: 3000, pages: [{ id: 'video-page', name: 'Scene', background: '#000000', elements: [], timelineClips: [clip] }] } } })
    const id = created.payload.id
    assert.equal((await api.request(`/api/documents/${id}/media`, { method: 'POST', cookie: owner.cookie, body: { asset: { id: 'video-used', name: 'scene.webm', mimeType: 'video/webm', width: 160, height: 90, src: usedSource } } })).status, 201)
    assert.equal((await api.request(`/api/documents/${id}/media`, { method: 'POST', cookie: owner.cookie, body: { asset: { id: 'not-used', name: 'unused.webm', mimeType: 'audio/webm', width: 1, height: 1, src: unusedSource } } })).status, 201)
    const link = await api.request(`/api/documents/${id}/access`, { method: 'PATCH', cookie: owner.cookie, body: { publicLink: 'enable' } })
    const publicRead = await api.request(`/api/public-shares/${link.payload.token}`)
    assert.equal(publicRead.status, 200)
    assert.deepEqual(Object.keys(publicRead.payload.timelineMedia), ['video-used'])
    assert.equal(publicRead.payload.timelineMedia['video-used'].src, usedSource)
    assert.deepEqual([publicRead.payload.timelineMedia['video-used'].width, publicRead.payload.timelineMedia['video-used'].height], [160, 90], 'public video metadata retains source dimensions required for consistent per-track framing')
    assert.equal(Object.hasOwn(publicRead.payload.timelineMedia, 'not-used'), false)
  } finally { await api.close() }
})

test('anonymous public site views omit hidden sections and presentation notes', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Public site owner', 'public-site-owner@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Public site', data: { type: 'site', width: 1440, height: 900, pages: [{ id: 'visible', name: 'Visible', elements: [], presenterNotes: 'private speaker notes' }, { id: 'hidden', name: 'Hidden', hidden: true, elements: [{ id: 'secret', type: 'text', text: 'Unpublished content', x: 0, y: 0, width: 100, height: 30, rotation: 0, fontSize: 18, fontFamily: 'Arial', color: '#000', bold: false }] }] } } })
    const link = await api.request(`/api/documents/${created.payload.id}/access`, { method: 'PATCH', cookie: owner.cookie, body: { publicLink: 'enable' } })
    const publicRead = await api.request(`/api/public-shares/${link.payload.token}`)
    assert.equal(publicRead.status, 200)
    assert.deepEqual(publicRead.payload.document.pages.map(page => page.id), ['visible'])
    assert.equal(Object.hasOwn(publicRead.payload.document.pages[0], 'presenterNotes'), false)
  } finally { await api.close() }
})

test('shared documents preserve embedded image bytes across authorized reads and edits', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Media owner', 'media-owner@example.test')
    const editor = await registerAndLogin(api, 'Media editor', 'media-editor@example.test')
    const imageSource = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiNmZjAwMDAiLz48L3N2Zz4='
    const firstDocument = {
      id: 'shared-media-design',
      name: 'Design com m??dia',
      type: 'presentation',
      width: 794,
      pages: [{
        id: 'page-1', name: 'P??gina 1', background: '#ffffff', presenterNotes: 'Revelar o dado principal ap??s a pergunta.', blocks: [{ id: 'paragraph-1', type: 'paragraph', text: 'Texto forte', marks: [{ start: 0, end: 5, bold: true, underline: true, strike: true }] }],
        elements: [
          { id: 'image-1', type: 'image', name: 'quadrado.svg', assetId: 'local-owner-asset', src: imageSource, x: 4, y: 8, width: 120, height: 120, rotation: 0 },
          { id: 'note-1', type: 'sticky-note', name: 'Sticky note', text: 'Initial idea', fill: '#fff2a8', color: '#302d20', fontSize: 24, x: 180, y: 90, width: 260, height: 220, rotation: 0 },
          { id: 'stroke-1', type: 'free-draw', name: 'Freehand', points: [0, 0, 20, 30], color: '#29263d', strokeWidth: 8, x: 460, y: 120, width: 20, height: 30, rotation: 0 },
        ],
        connectors: [{ id: 'connector-1', fromId: 'image-1', toId: 'note-1', fromAnchor: { x: 1, y: 0.4 }, toAnchor: { x: 0, y: 0.6 }, color: '#7464e8', strokeWidth: 4 }],
        groups: [{ id: 'group-1', name: 'Ideia', elementIds: ['image-1', 'note-1'] }],
      }],
    }
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: firstDocument.name, data: firstDocument } })
    assert.equal(created.status, 201)
    const documentId = created.payload.id
    assert.equal((await api.request(`/api/documents/${documentId}/permissions`, {
      method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' },
    })).status, 201)

    const openedByEditor = await api.request(`/api/documents/${documentId}`, { cookie: editor.cookie })
    assert.equal(openedByEditor.payload.data.pages[0].elements[0].src, imageSource)
    assert.equal(openedByEditor.payload.data.pages[0].elements[0].assetId, 'local-owner-asset')
    assert.equal(openedByEditor.payload.data.pages[0].presenterNotes, 'Revelar o dado principal ap??s a pergunta.')
    assert.deepEqual(openedByEditor.payload.data.pages[0].blocks[0].marks, [{ start: 0, end: 5, bold: true, underline: true, strike: true }])

    const updatedDocument = structuredClone(openedByEditor.payload.data)
    updatedDocument.pages[0].elements[0].x = 40
    updatedDocument.pages[0].elements[1].text = 'Updated by collaborator'
    assert.equal(openedByEditor.payload.data.pages[0].connectors[0].toId, 'note-1')
    assert.deepEqual(openedByEditor.payload.data.pages[0].connectors[0].fromAnchor, { x: 1, y: 0.4 })
    assert.deepEqual(openedByEditor.payload.data.pages[0].connectors[0].toAnchor, { x: 0, y: 0.6 })
    const saved = await api.request(`/api/documents/${documentId}`, {
      method: 'PUT', cookie: editor.cookie,
      body: { revision: openedByEditor.payload.revision, name: updatedDocument.name, data: updatedDocument },
    })
    assert.equal(saved.status, 200)
    const reopenedByOwner = await api.request(`/api/documents/${documentId}`, { cookie: owner.cookie })
    assert.equal(reopenedByOwner.payload.data.pages[0].elements[0].src, imageSource)
    assert.equal(reopenedByOwner.payload.data.pages[0].elements[0].x, 40)
    assert.equal(reopenedByOwner.payload.data.pages[0].elements[1].text, 'Updated by collaborator')
    assert.equal(reopenedByOwner.payload.data.pages[0].elements[1].fill, '#fff2a8')
    assert.deepEqual(reopenedByOwner.payload.data.pages[0].elements[2].points, [0, 0, 20, 30])
    assert.equal(reopenedByOwner.payload.data.pages[0].connectors[0].fromId, 'image-1')
    assert.deepEqual(reopenedByOwner.payload.data.pages[0].connectors[0].toAnchor, { x: 0, y: 0.6 })
    assert.deepEqual(reopenedByOwner.payload.data.pages[0].groups[0].elementIds, ['image-1', 'note-1'])
    assert.equal(reopenedByOwner.payload.data.pages[0].presenterNotes, 'Revelar o dado principal ap??s a pergunta.')
    assert.deepEqual(reopenedByOwner.payload.data.pages[0].blocks[0].marks, [{ start: 0, end: 5, bold: true, underline: true, strike: true }])
    const invalidMarks = structuredClone(reopenedByOwner.payload.data)
    invalidMarks.pages[0].blocks[0].marks[0].underline = 'yes'
    const invalidMarkWrite = await api.request(`/api/documents/${documentId}`, { method: 'PUT', cookie: owner.cookie, body: { revision: reopenedByOwner.payload.revision, name: reopenedByOwner.payload.name, data: invalidMarks } })
    assert.equal(invalidMarkWrite.status, 400, 'cloud rejects nonboolean underline values')
  } finally {
    await api.close()
  }
})

test('spreadsheet formulas and cell values survive authorized collaboration round trips', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Sheet owner', 'sheet-owner@example.test')
    const editor = await registerAndLogin(api, 'Sheet editor', 'sheet-editor@example.test')
    const data = { id: 'shared-sheet', name: 'Budget', type: 'sheet', width: 1600, height: 900, updatedAt: new Date().toISOString(), pages: [{ id: 'sheet-page', name: 'Planilha 1', background: '#fff', elements: [], cells: [['12', '8', '=SUM(A1:B1)'], ['6', '', '=B2']], cellMerges: [{ row: 1, column: 0, colSpan: 2 }], cellFormats: { '0:0': 'currency' } }] }
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: data.name, data } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const opened = await api.request(`/api/documents/${id}`, { cookie: editor.cookie })
    assert.equal(opened.payload.data.type, 'sheet')
    assert.deepEqual(opened.payload.data.pages[0].cells[0], ['12', '8', '=SUM(A1:B1)'])
    assert.deepEqual(opened.payload.data.pages[0].cellMerges, [{ row: 1, column: 0, colSpan: 2 }])
    assert.deepEqual(opened.payload.data.pages[0].cellFormats, { '0:0': 'currency' })
    const changed = structuredClone(opened.payload.data)
    changed.pages[0].cells[0][1] = '10'
    const saved = await api.request(`/api/documents/${id}`, { method: 'PUT', cookie: editor.cookie, body: { revision: opened.payload.revision, name: changed.name, data: changed } })
    assert.equal(saved.status, 200)
    const reopened = await api.request(`/api/documents/${id}`, { cookie: owner.cookie })
    assert.deepEqual(reopened.payload.data.pages[0].cells[0], ['12', '10', '=SUM(A1:B1)'])
    assert.deepEqual(reopened.payload.data.pages[0].cellMerges, [{ row: 1, column: 0, colSpan: 2 }])
    assert.deepEqual(reopened.payload.data.pages[0].cellFormats, { '0:0': 'currency' })

    const currentForEditor = await api.request(`/api/documents/${id}`, { cookie: editor.cookie })
    const ownerConcurrent = structuredClone(reopened.payload.data)
    const editorConcurrent = structuredClone(currentForEditor.payload.data)
    ownerConcurrent.pages[0].cells[1][0] = 'Owner cell'
    editorConcurrent.pages[0].cells[1][2] = '=A2'
    assert.equal((await api.request(`/api/documents/${id}`, { method: 'PUT', cookie: owner.cookie, body: { revision: reopened.payload.revision, name: ownerConcurrent.name, data: ownerConcurrent } })).status, 200)
    const independentCellSave = await api.request(`/api/documents/${id}`, { method: 'PUT', cookie: editor.cookie, body: { revision: currentForEditor.payload.revision, name: editorConcurrent.name, data: editorConcurrent } })
    assert.equal(independentCellSave.status, 200)
    assert.equal(independentCellSave.payload.data.pages[0].cells[1][0], 'Owner cell')
    assert.equal(independentCellSave.payload.data.pages[0].cells[1][2], '=A2')

    const sameCellOwnerBase = await api.request(`/api/documents/${id}`, { cookie: owner.cookie })
    const sameCellEditorBase = await api.request(`/api/documents/${id}`, { cookie: editor.cookie })
    const ownerSameCell = structuredClone(sameCellOwnerBase.payload.data)
    const editorSameCell = structuredClone(sameCellEditorBase.payload.data)
    ownerSameCell.pages[0].cells[1][0] = 'Owner version'
    editorSameCell.pages[0].cells[1][0] = 'Editor version'
    assert.equal((await api.request(`/api/documents/${id}`, { method: 'PUT', cookie: owner.cookie, body: { revision: sameCellOwnerBase.payload.revision, name: ownerSameCell.name, data: ownerSameCell } })).status, 200)
    const sameCellConflict = await api.request(`/api/documents/${id}`, { method: 'PUT', cookie: editor.cookie, body: { revision: sameCellEditorBase.payload.revision, name: editorSameCell.name, data: editorSameCell } })
    assert.equal(sameCellConflict.status, 409)
    assert.ok(sameCellConflict.payload.conflicts.includes('data.pages[sheet-page].cells[1][0]'))

    const workbookBase = await api.request(`/api/documents/${id}`, { cookie: owner.cookie })
    const secondSheet = { id: 'sheet-page-2', name: 'Planilha 2', background: '#fff', elements: [], cells: [['7']] }
    const insertedSheet = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'sheet-add-tab', baseRevision: workbookBase.payload.revision, pageId: 'sheet-page', type: 'design.page.insert', page: secondSheet, afterPageId: 'sheet-page',
    } })
    assert.equal(insertedSheet.status, 200)
    const crossSheetFormula = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'sheet-cross-reference', baseRevision: insertedSheet.payload.revision, pageId: 'sheet-page', type: 'sheet.cells.set', cells: [{ row: 0, column: 3, value: "='Planilha 2'!A1*3" }],
    } })
    assert.equal(crossSheetFormula.status, 200)
    const renamedSheet = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'sheet-rename-tab', baseRevision: crossSheetFormula.payload.revision, pageId: 'sheet-page-2', type: 'design.page.patch', patch: { name: 'Dados' },
    } })
    assert.equal(renamedSheet.status, 200)
    const renamedReference = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'sheet-rename-reference', baseRevision: renamedSheet.payload.revision, pageId: 'sheet-page', type: 'sheet.cells.set', cells: [{ row: 0, column: 3, value: "='Dados'!A1*3" }],
    } })
    assert.equal(renamedReference.status, 200)
    const sharedWorkbook = await api.request(`/api/documents/${id}`, { cookie: editor.cookie })
    assert.deepEqual(sharedWorkbook.payload.data.pages.map(page => page.name), ['Planilha 1', 'Dados'])
    assert.equal(sharedWorkbook.payload.data.pages[0].cells[0][3], "='Dados'!A1*3")
    assert.equal(sharedWorkbook.payload.data.pages[1].cells[0][0], '7')
  } finally { await api.close() }
})

async function readSseEvent(reader, state, expectedType, predicate = () => true) {
  const decoder = new TextDecoder()
  while (true) {
    const separator = state.buffer.indexOf('\n\n')
    if (separator >= 0) {
      const block = state.buffer.slice(0, separator)
      state.buffer = state.buffer.slice(separator + 2)
      const data = block.split('\n').find(line => line.startsWith('data: '))?.slice(6)
      if (data) {
        const event = JSON.parse(data)
        if (event.type === expectedType && predicate(event)) return event
      }
      continue
    }
    let timer
    const result = await Promise.race([
      reader.read(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for SSE ${expectedType}`)), 2500) }),
    ]).finally(() => clearTimeout(timer))
    if (result.done) throw new Error(`SSE stream closed before ${expectedType}`)
    state.buffer += decoder.decode(result.value, { stream: true })
  }
}

async function readSseEventWithId(reader, state, expectedType) {
  const decoder = new TextDecoder()
  while (true) {
    const separator = state.buffer.indexOf('\n\n')
    if (separator >= 0) {
      const block = state.buffer.slice(0, separator)
      state.buffer = state.buffer.slice(separator + 2)
      const id = block.split('\n').find(line => line.startsWith('id: '))?.slice(4)
      const data = block.split('\n').find(line => line.startsWith('data: '))?.slice(6)
      if (data) {
        const event = JSON.parse(data)
        if (event.type === expectedType) return { id, event }
      }
      continue
    }
    let timer
    const result = await Promise.race([
      reader.read(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for SSE ${expectedType}`)), 2500) }),
    ]).finally(() => clearTimeout(timer))
    if (result.done) throw new Error(`SSE stream closed before ${expectedType}`)
    state.buffer += decoder.decode(result.value, { stream: true })
  }
}

test('authorized collaborators can follow, join late, and stop a live presentation', async () => {
  const api = await startApi()
  let editorStream
  let ownerStream
  let lateViewerStream
  let editorReader
  let ownerReader
  let lateViewerReader
  try {
    const owner = await registerAndLogin(api, 'Presentation owner', 'presentation-owner@example.test')
    const presenter = await registerAndLogin(api, 'Presenter', 'presenter@example.test')
    const viewer = await registerAndLogin(api, 'Late viewer', 'late-viewer@example.test')
    const createdTeam = await api.request('/api/teams', { method: 'POST', cookie: owner.cookie, body: { name: 'Presentation audit team' } })
    const teamId = createdTeam.payload.team.id
    const documentData = { type: 'presentation', width: 1280, height: 720, pages: [{ id: 'slide-1' }, { id: 'slide-2' }] }
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Team presentation', teamId, data: documentData } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: presenter.user.email, role: 'editor' } })
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: viewer.user.email, role: 'viewer' } })

    ownerStream = await fetch(`${api.base}/api/documents/${id}/events`, { headers: { cookie: owner.cookie } })
    ownerReader = ownerStream.body.getReader()
    const ownerState = { buffer: '' }
    await readSseEvent(ownerReader, ownerState, 'ready')
    await readSseEvent(ownerReader, ownerState, 'presence.updated')

    editorStream = await fetch(`${api.base}/api/documents/${id}/events`, { headers: { cookie: presenter.cookie } })
    editorReader = editorStream.body.getReader()
    const editorState = { buffer: '' }
    await readSseEvent(editorReader, editorState, 'ready')
    await readSseEvent(editorReader, editorState, 'presence.updated')

    assert.equal((await api.request(`/api/documents/${id}/presentation`, { method: 'POST', cookie: presenter.cookie, body: { pageIndex: 0 } })).status, 200)
    const started = await readSseEvent(ownerReader, ownerState, 'presentation.updated')
    assert.deepEqual(started, { type: 'presentation.updated', userId: presenter.user.id, name: 'Presenter', presenting: true, pageIndex: 0 })

    lateViewerStream = await fetch(`${api.base}/api/documents/${id}/events`, { headers: { cookie: viewer.cookie } })
    lateViewerReader = lateViewerStream.body.getReader()
    const lateViewerState = { buffer: '' }
    await readSseEvent(lateViewerReader, lateViewerState, 'ready')
    await readSseEvent(lateViewerReader, lateViewerState, 'presence.updated')
    assert.deepEqual(await readSseEvent(lateViewerReader, lateViewerState, 'presentation.updated'), started)
    assert.equal((await api.request(`/api/documents/${id}/presentation`, { method: 'POST', cookie: viewer.cookie, body: { pageIndex: 0 } })).status, 409)

    assert.equal((await api.request(`/api/documents/${id}/presentation`, { method: 'POST', cookie: presenter.cookie, body: { pageIndex: 1 } })).status, 200)
    assert.equal((await readSseEvent(ownerReader, ownerState, 'presentation.updated')).pageIndex, 1)
    assert.equal((await readSseEvent(lateViewerReader, lateViewerState, 'presentation.updated')).pageIndex, 1)
    assert.equal((await api.request(`/api/documents/${id}/presentation`, { method: 'POST', cookie: presenter.cookie, body: { pageIndex: 2 } })).status, 400)

    assert.equal((await api.request(`/api/documents/${id}/presentation`, { method: 'POST', cookie: presenter.cookie, body: { pageIndex: null } })).status, 200)
    assert.equal((await readSseEvent(ownerReader, ownerState, 'presentation.updated')).presenting, false)
    assert.equal((await readSseEvent(lateViewerReader, lateViewerState, 'presentation.updated')).presenting, false)

    const audit = await api.request(`/api/teams/${teamId}/audit?limit=100`, { cookie: owner.cookie })
    const presentationActions = audit.payload.events.filter(event => event.action.startsWith('document.presentation.')).map(event => event.action)
    assert.deepEqual(presentationActions.slice(0, 3), ['document.presentation.ended', 'document.presentation.slide_changed', 'document.presentation.started'])
    assert.equal(presentationActions.includes('document.presentation.started') && presentationActions.filter(action => action === 'document.presentation.started').length, 1, 'rejected viewer start must not be audited')

    await api.request(`/api/documents/${id}/presentation`, { method: 'POST', cookie: presenter.cookie, body: { pageIndex: 0 } })
    await readSseEvent(ownerReader, ownerState, 'presentation.updated')
    await editorReader.cancel()
    assert.equal((await readSseEvent(ownerReader, ownerState, 'presentation.updated')).presenting, false)
  } finally {
    await Promise.all([editorReader?.cancel().catch(() => {}), ownerReader?.cancel().catch(() => {}), lateViewerReader?.cancel().catch(() => {})])
    await api.close()
  }
})

test('stale independent document snapshots merge on the server while same-field edits conflict', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Merge Owner', 'merge-owner@example.test')
    const editor = await registerAndLogin(api, 'Merge Editor', 'merge-editor@example.test')
    const base = { type: 'design', name: 'Base', width: 794, pages: [{ id: 'page-1', elements: [
      { id: 'text-1', type: 'text', text: 'Base title' },
      { id: 'shape-1', type: 'shape', fill: '#ffffff' },
    ] }] }
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Design', data: base } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })

    const ownerEdit = structuredClone(base)
    ownerEdit.pages[0].elements[0].text = 'Owner title'
    assert.equal((await api.request(`/api/documents/${id}`, { method: 'PUT', cookie: owner.cookie, body: { revision: 1, name: 'Design', data: ownerEdit } })).status, 200)

    const independentEdit = structuredClone(base)
    independentEdit.pages[0].elements[1].fill = '#00aaff'
    const merged = await api.request(`/api/documents/${id}`, { method: 'PUT', cookie: editor.cookie, body: { revision: 1, name: 'Design', data: independentEdit } })
    assert.equal(merged.status, 200)
    assert.equal(merged.payload.revision, 3)
    assert.equal(merged.payload.data.pages[0].elements[0].text, 'Owner title')
    assert.equal(merged.payload.data.pages[0].elements[1].fill, '#00aaff')

    const overlappingEdit = structuredClone(base)
    overlappingEdit.pages[0].elements[0].text = 'Editor title'
    const conflict = await api.request(`/api/documents/${id}`, { method: 'PUT', cookie: editor.cookie, body: { revision: 1, name: 'Design', data: overlappingEdit } })
    assert.equal(conflict.status, 409)
    assert.ok(conflict.payload.conflicts.some(path => path.includes('text-1') && path.endsWith('.text')))
  } finally {
    await api.close()
  }
})

test('collaborators combine non-overlapping edits in the same text block', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Text owner', 'text-merge-owner@example.test')
    const editor = await registerAndLogin(api, 'Text editor', 'text-merge-editor@example.test')
    const base = { type: 'doc', width: 794, pages: [{ id: 'page-1', elements: [], blocks: [{ id: 'paragraph-1', type: 'paragraph', text: 'Open tasks', marks: [{ start: 0, end: 4, bold: true }] }] }] }
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Collaborative paragraph', data: base } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })

    const ownerEdit = structuredClone(base)
    ownerEdit.pages[0].blocks[0].text = 'Team: Open tasks urgent'
    ownerEdit.pages[0].blocks[0].marks = [{ start: 0, end: 6, italic: true }, { start: 6, end: 10, bold: true }, { start: 17, end: 23, italic: true }]
    assert.equal((await api.request(`/api/documents/${id}`, { method: 'PUT', cookie: owner.cookie, body: { revision: 1, name: 'Collaborative paragraph', data: ownerEdit } })).status, 200)

    const editorEdit = structuredClone(base)
    editorEdit.pages[0].blocks[0].text = 'Open team tasks'
    editorEdit.pages[0].blocks[0].marks = [{ start: 0, end: 4, bold: true }, { start: 5, end: 9, italic: true }]
    const merged = await api.request(`/api/documents/${id}`, { method: 'PUT', cookie: editor.cookie, body: { revision: 1, name: 'Collaborative paragraph', data: editorEdit } })
    assert.equal(merged.status, 200)
    assert.equal(merged.payload.data.pages[0].blocks[0].text, 'Team: Open team tasks urgent')
    assert.deepEqual(merged.payload.data.pages[0].blocks[0].marks, [
      { start: 0, end: 6, italic: true },
      { start: 6, end: 10, bold: true },
      { start: 11, end: 15, italic: true },
      { start: 22, end: 28, italic: true },
    ])
    assert.equal(merged.payload.revision, 3)
  } finally {
    await api.close()
  }
})

test('document table cell operations merge stale independent writes and reject concurrent edits to the same cell', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Table owner', 'doc-table-owner@example.test')
    const editor = await registerAndLogin(api, 'Table editor', 'doc-table-editor@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Collaborative table', data: { type: 'doc', width: 794, pages: [{ id: 'page-1', elements: [], blocks: [{ id: 'table-1', type: 'table', text: '', cells: [['A', 'B'], ['C', 'D']] }] }] },
    } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const response = await fetch(`${api.base}/api/documents/${id}/events`, { headers: { cookie: owner.cookie } })
    const reader = response.body.getReader()
    const streamState = { buffer: '' }
    await readSseEvent(reader, streamState, 'ready')
    await readSseEvent(reader, streamState, 'presence.updated')
    const operation = (operationId, baseRevision, row, column, value) => ({ operationId, baseRevision, pageId: 'page-1', blockId: 'table-1', row, column, value, type: 'doc.table.cell.set' })
    const ownerWrite = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('doc-cell-owner', 1, 0, 0, 'Owner value') })
    assert.equal(ownerWrite.status, 200)
    await readSseEvent(reader, streamState, 'document.updated')
    const event = await readSseEvent(reader, streamState, 'document.operation.updated')
    assert.equal(event.operation, 'doc.table.cell.set')
    const editorWrite = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: operation('doc-cell-editor', 1, 0, 1, 'Editor value') })
    assert.equal(editorWrite.status, 200)
    assert.deepEqual(editorWrite.payload.document.pages[0].blocks[0].cells[0], ['Owner value', 'Editor value'])
    const current = await api.request(`/api/documents/${id}`, { cookie: owner.cookie })
    const styledData = current.payload.data
    styledData.pages[0].blocks[0].cellPadding = 20
    styledData.pages[0].blocks[0].tableSpacing = 0
    styledData.pages[0].blocks[0].cellBorders = { '0:0': { top: { style: 'none', width: 2 }, right: { style: 'long-dashes', width: 2 }, bottom: { style: 'dashes', width: 2 }, left: { style: 'dots', width: 2 } } }
    const styledSave = await api.request(`/api/documents/${id}`, { method: 'PUT', cookie: owner.cookie, body: { revision: current.payload.revision, name: current.payload.name, data: styledData } })
    assert.equal(styledSave.status, 200, JSON.stringify(styledSave.payload))
    const styledReload = await api.request(`/api/documents/${id}`, { cookie: editor.cookie })
    assert.deepEqual({ cellPadding: styledReload.payload.data.pages[0].blocks[0].cellPadding, tableSpacing: styledReload.payload.data.pages[0].blocks[0].tableSpacing, a1: styledReload.payload.data.pages[0].blocks[0].cellBorders['0:0'] }, { cellPadding: 20, tableSpacing: 0, a1: styledData.pages[0].blocks[0].cellBorders['0:0'] })
    assert.deepEqual(Object.values(styledReload.payload.data.pages[0].blocks[0].cellBorders['0:0']).map(border => border.style), ['none', 'long-dashes', 'dashes', 'dots'], 'all new border styles survive authorized server round trips')
    const conflict = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: operation('doc-cell-conflict', 1, 0, 0, 'Conflicting value') })
    assert.equal(conflict.status, 409)
    assert.deepEqual(conflict.payload.conflicts, ['pages[page-1].blocks[table-1].cells[0][0]'])
    const duplicate = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('doc-cell-owner', 1, 0, 0, 'Owner value') })
    assert.equal(duplicate.payload.duplicate, true)
    assert.deepEqual(duplicate.payload.document.pages[0].blocks[0].cells[0], ['Owner value', 'Editor value'])
    await reader.cancel()
  } finally { await api.close() }
})

test('Docs table structure operations rebase independent edits and preserve cells, merges, and border coordinates', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Table structure owner', 'doc-table-structure-owner@example.test')
    const editor = await registerAndLogin(api, 'Table structure editor', 'doc-table-structure-editor@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Collaborative table structure', data: {
      type: 'doc', width: 794, pages: [{ id: 'page-1', elements: [], blocks: [{ id: 'table-1', type: 'table', text: '', cells: [['A', 'B', 'C'], ['D', 'E', 'F'], ['G', 'H', 'I']], cellImages: { '0:0': [{ src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7s8AAAAASUVORK5CYII=', alt: 'Header image', width: 1, height: 1 }], '1:1': [{ src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7s8AAAAASUVORK5CYII=', alt: 'Body image', width: 1, height: 1 }], '2:2': [{ src: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7s8AAAAASUVORK5CYII=', alt: 'Footer image', width: 1, height: 1 }] }, cellBorders: { '1:0': { top: { style: 'solid', width: 1 } }, '2:2': { right: { style: 'dots', width: 2 } } } }] }],
    } } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const operation = (cookie, operationId, baseRevision, action, details = {}) => api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie, body: { operationId, baseRevision, pageId: 'page-1', blockId: 'table-1', type: 'doc.table.structure', action, ...details } })

    const appendedRow = await operation(editor.cookie, 'doc-table-row-append', 1, 'row.append')
    assert.equal(appendedRow.status, 200)
    const appendedColumn = await operation(owner.cookie, 'doc-table-column-append', 1, 'column.append')
    assert.equal(appendedColumn.status, 200)
    assert.equal(appendedColumn.payload.document.pages[0].blocks[0].cells.length, 4)
    assert.ok(appendedColumn.payload.document.pages[0].blocks[0].cells.every(row => row.length === 4), 'stale row and column appends commute without dropping the original matrix')
    assert.deepEqual(Object.keys(appendedColumn.payload.document.pages[0].blocks[0].cellImages).sort(), ['0:0', '1:1', '2:2'], 'appending rows and columns preserves existing image coordinates')

    const independentCell = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: { operationId: 'doc-table-structure-cell', baseRevision: 3, pageId: 'page-1', blockId: 'table-1', type: 'doc.table.cell.set', row: 0, column: 0, value: 'Independent edit' } })
    assert.equal(independentCell.status, 200)
    const merged = await operation(editor.cookie, 'doc-table-merge', 3, 'merge', { row: 1, column: 0, colSpan: 2 })
    assert.equal(merged.status, 200, 'a stale merge rebases over a cell edit outside its range')
    const mergedTable = merged.payload.document.pages[0].blocks[0]
    assert.equal(mergedTable.cells[0][0], 'Independent edit')
    assert.deepEqual(mergedTable.cells[1].slice(0, 2), ['D\nE', ''])
    assert.ok(mergedTable.merges.some(item => item.row === 1 && item.column === 0 && item.colSpan === 2))
    const unmerged = await operation(owner.cookie, 'doc-table-unmerge', merged.payload.revision, 'unmerge', { row: 1, column: 1 })
    assert.equal(unmerged.status, 200)
    assert.equal(unmerged.payload.document.pages[0].blocks[0].merges.length, 0)

    const deletedRow = await operation(owner.cookie, 'doc-table-row-delete', unmerged.payload.revision, 'row.delete', { row: 1 })
    assert.equal(deletedRow.status, 200)
    const afterRowDelete = deletedRow.payload.document.pages[0].blocks[0]
    assert.deepEqual(afterRowDelete.cells[1].slice(0, 3), ['G', 'H', 'I'])
    assert.deepEqual(Object.keys(afterRowDelete.cellBorders).sort(), ['1:2'], 'row deletion removes deleted borders and shifts surviving row coordinates')
    assert.deepEqual(Object.keys(afterRowDelete.cellImages).sort(), ['0:0', '1:2'], 'row deletion removes images in the deleted row and shifts images below it')

    const deletedColumn = await operation(editor.cookie, 'doc-table-column-delete', deletedRow.payload.revision, 'column.delete', { column: 1 })
    assert.equal(deletedColumn.status, 200)
    const afterColumnDelete = deletedColumn.payload.document.pages[0].blocks[0]
    assert.deepEqual(afterColumnDelete.cells[0].slice(0, 2), ['Independent edit', 'C'])
    assert.deepEqual(Object.keys(afterColumnDelete.cellBorders), ['1:1'], 'column deletion shifts surviving border coordinates')
    assert.deepEqual(Object.keys(afterColumnDelete.cellImages), ['0:0', '1:1'], 'column deletion removes images in the deleted column and shifts images to its right')
    assert.equal(afterColumnDelete.cellImages['1:1'][0].alt, 'Footer image')
    const concurrentCell = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: { operationId: 'doc-table-structure-overlap-cell', baseRevision: deletedColumn.payload.revision, pageId: 'page-1', blockId: 'table-1', type: 'doc.table.cell.set', row: 1, column: 0, value: 'Changed row' } })
    assert.equal(concurrentCell.status, 200)
    const conflict = await operation(editor.cookie, 'doc-table-delete-conflict', deletedColumn.payload.revision, 'row.delete', { row: 1 })
    assert.equal(conflict.status, 409)
    assert.deepEqual(conflict.payload.conflicts, ['pages[page-1].blocks[table-1].cells[1]'])
  } finally { await api.close() }
})

test('Docs row move persists the adjacent cell-record order in both directions', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Row move owner', 'doc-row-move-owner@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Persistent row move', data: {
      type: 'doc', width: 794, pages: [{ id: 'page-1', elements: [], blocks: [{ id: 'table-1', type: 'table', text: '', cells: [['Header A', 'Header B'], ['Body A', 'Body B'], ['Footer A', 'Footer B']], cellImages: { '0:0': [{ src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7s8AAAAASUVORK5CYII=', alt: 'Header image', width: 1, height: 1 }], '1:1': [{ src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7s8AAAAASUVORK5CYII=', alt: 'Body image', width: 1, height: 1 }], '2:1': [{ src: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7s8AAAAASUVORK5CYII=', alt: 'Footer image', width: 1, height: 1 }] }, merges: [{ row: 1, column: 0, colSpan: 2 }], cellBorders: { '0:0': { top: { style: 'solid', width: 1 } }, '1:1': { bottom: { style: 'dots', width: 2 } } } }] }],
    } } })
    const id = created.payload.id
    const move = (baseRevision, operationId, from, to) => api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: { operationId, baseRevision, pageId: 'page-1', blockId: 'table-1', type: 'doc.table.structure', action: 'row.move', from, to } })
    const down = await move(1, 'doc-row-move-down', 0, 1)
    assert.equal(down.status, 200)
    assert.deepEqual(down.payload.document.pages[0].blocks[0].cells, [['Body A', 'Body B'], ['Header A', 'Header B'], ['Footer A', 'Footer B']])
    assert.deepEqual(down.payload.document.pages[0].blocks[0].merges, [{ row: 0, column: 0, colSpan: 2 }], 'merge metadata follows the row content')
    assert.deepEqual(down.payload.document.pages[0].blocks[0].cellBorders, { '1:0': { top: { style: 'solid', width: 1 } }, '0:1': { bottom: { style: 'dots', width: 2 } } }, 'cell borders follow their rows')
    assert.deepEqual(down.payload.document.pages[0].blocks[0].cellImages, { '1:0': [{ src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7s8AAAAASUVORK5CYII=', alt: 'Header image', width: 1, height: 1 }], '0:1': [{ src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7s8AAAAASUVORK5CYII=', alt: 'Body image', width: 1, height: 1 }], '2:1': [{ src: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7s8AAAAASUVORK5CYII=', alt: 'Footer image', width: 1, height: 1 }] }, 'images follow their rows during move')
    const afterReload = await api.request(`/api/documents/${id}`, { cookie: owner.cookie })
    assert.deepEqual(afterReload.payload.data.pages[0].blocks[0].cells, down.payload.document.pages[0].blocks[0].cells, 'a fresh read returns the persisted moved row order')
    const up = await move(down.payload.revision, 'doc-row-move-up', 1, 0)
    assert.equal(up.status, 200)
    assert.deepEqual(up.payload.document.pages[0].blocks[0].cells, [['Header A', 'Header B'], ['Body A', 'Body B'], ['Footer A', 'Footer B']], 'moving back restores the source order')
    assert.deepEqual(up.payload.document.pages[0].blocks[0].cellImages, { '0:0': [{ src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7s8AAAAASUVORK5CYII=', alt: 'Header image', width: 1, height: 1 }], '1:1': [{ src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7s8AAAAASUVORK5CYII=', alt: 'Body image', width: 1, height: 1 }], '2:1': [{ src: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7s8AAAAASUVORK5CYII=', alt: 'Footer image', width: 1, height: 1 }] }, 'moving the row back restores each image coordinate')
  } finally { await api.close() }
})

test('document text operations rebase disjoint edits and report overlapping edits', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Block owner', 'doc-block-owner@example.test')
    const editor = await registerAndLogin(api, 'Block editor', 'doc-block-editor@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Collaborative text', data: { type: 'doc', width: 794, pages: [{ id: 'page-1', elements: [], blocks: [{ id: 'paragraph-1', type: 'paragraph', text: 'Open tasks', marks: [{ start: 0, end: 4, bold: true }] }] }] },
    } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const response = await fetch(`${api.base}/api/documents/${id}/events`, { headers: { cookie: owner.cookie } })
    const reader = response.body.getReader()
    const streamState = { buffer: '' }
    await readSseEvent(reader, streamState, 'ready')
    await readSseEvent(reader, streamState, 'presence.updated')
    const operation = (operationId, text, marks) => ({ operationId, baseRevision: 1, pageId: 'page-1', blockId: 'paragraph-1', type: 'doc.block.text.set', text, marks })
    const ownerWrite = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('doc-text-owner', 'Open tasks urgent', [{ start: 0, end: 4, bold: true }]) })
    assert.equal(ownerWrite.status, 200)
    await readSseEvent(reader, streamState, 'document.updated')
    const event = await readSseEvent(reader, streamState, 'document.operation.updated')
    assert.equal(event.operation, 'doc.block.text.set')
    const editorWrite = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: operation('doc-text-editor', 'Team: Open tasks', [{ start: 6, end: 10, bold: true }]) })
    assert.equal(editorWrite.status, 200)
    assert.equal(editorWrite.payload.document.pages[0].blocks[0].text, 'Team: Open tasks urgent')
    assert.deepEqual(editorWrite.payload.document.pages[0].blocks[0].marks, [{ start: 6, end: 10, bold: true }])
    const conflict = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: operation('doc-text-conflict', 'Close tasks', []) })
    assert.equal(conflict.status, 409)
    assert.ok(conflict.payload.conflicts.some(path => path.endsWith('.text')))
    const duplicate = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('doc-text-owner', 'Open tasks urgent', [{ start: 0, end: 4, bold: true }]) })
    assert.equal(duplicate.payload.duplicate, true)
    assert.equal(duplicate.payload.document.pages[0].blocks[0].text, 'Team: Open tasks urgent')
    await reader.cancel()
  } finally { await api.close() }
})

test('document block structure operations insert, restyle, and delete with stale revision conflict checks', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Structure owner', 'doc-structure-owner@example.test')
    const editor = await registerAndLogin(api, 'Structure editor', 'doc-structure-editor@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Collaborative structure', data: { type: 'doc', width: 794, pages: [{ id: 'page-1', elements: [], blocks: [
        { id: 'paragraph-1', type: 'paragraph', text: 'Introduction', marks: [] },
        { id: 'paragraph-2', type: 'paragraph', text: 'Body', marks: [] },
      ] }] },
    } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const operation = (cookie, operationId, baseRevision, body) => api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie, body: { operationId, baseRevision, pageId: 'page-1', ...body } })

    const ownerInsert = await operation(owner.cookie, 'doc-insert-owner', 1, { type: 'doc.block.insert', afterBlockId: 'paragraph-1', block: { id: 'owner-block', type: 'quote', text: 'Owner note', marks: [] } })
    assert.equal(ownerInsert.status, 200)
    const editorInsert = await operation(editor.cookie, 'doc-insert-editor', 1, { type: 'doc.block.insert', afterBlockId: 'paragraph-1', block: { id: 'editor-block', type: 'bullet', text: 'Editor note', marks: [] } })
    assert.equal(editorInsert.status, 200)
    assert.deepEqual(editorInsert.payload.document.pages[0].blocks.map(block => block.id), ['paragraph-1', 'editor-block', 'owner-block', 'paragraph-2'])

    const ownerType = await operation(owner.cookie, 'doc-type-owner', 1, { type: 'doc.block.type.set', blockId: 'paragraph-1', blockType: 'heading' })
    assert.equal(ownerType.status, 200)
    assert.equal(ownerType.payload.document.pages[0].blocks[0].type, 'heading')
    const typeConflict = await operation(editor.cookie, 'doc-type-editor-conflict', 1, { type: 'doc.block.type.set', blockId: 'paragraph-1', blockType: 'quote' })
    assert.equal(typeConflict.status, 409)
    assert.deepEqual(typeConflict.payload.conflicts, ['pages[page-1].blocks[paragraph-1].type'])

    const ownerText = await operation(owner.cookie, 'doc-structure-text-edit', 4, { type: 'doc.block.text.set', blockId: 'editor-block', text: 'Edited note', marks: [] })
    assert.equal(ownerText.status, 200)
    const deleteConflict = await operation(editor.cookie, 'doc-delete-stale', 3, { type: 'doc.block.delete', blockId: 'editor-block' })
    assert.equal(deleteConflict.status, 409)
    const deleted = await operation(editor.cookie, 'doc-delete-fresh', 5, { type: 'doc.block.delete', blockId: 'editor-block' })
    assert.equal(deleted.status, 200)
    assert.deepEqual(deleted.payload.document.pages[0].blocks.map(block => block.id), ['paragraph-1', 'owner-block', 'paragraph-2'])
  } finally { await api.close() }
})

test('document block reordering rebases unrelated text edits and rejects concurrent structure changes', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Order owner', 'doc-order-owner@example.test')
    const editor = await registerAndLogin(api, 'Order editor', 'doc-order-editor@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Ordered document', data: { type: 'doc', width: 794, pages: [{ id: 'page-1', elements: [], blocks: [
        { id: 'block-1', type: 'heading', text: 'One', marks: [] },
        { id: 'block-2', type: 'paragraph', text: 'Two', marks: [] },
        { id: 'block-3', type: 'quote', text: 'Three', marks: [] },
      ] }] },
    } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const operation = (cookie, operationId, baseRevision, body) => api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie, body: { operationId, baseRevision, pageId: 'page-1', ...body } })
    const textEdit = await operation(owner.cookie, 'doc-order-text-edit', 1, { type: 'doc.block.text.set', blockId: 'block-1', text: 'One updated', marks: [] })
    assert.equal(textEdit.status, 200)
    const reorder = await operation(editor.cookie, 'doc-order-reorder', 1, { type: 'doc.blocks.reorder', blockIds: ['block-3', 'block-1', 'block-2'] })
    assert.equal(reorder.status, 200)
    assert.deepEqual(reorder.payload.document.pages[0].blocks.map(block => block.id), ['block-3', 'block-1', 'block-2'])
    assert.equal(reorder.payload.document.pages[0].blocks[1].text, 'One updated')
    const nextOrder = await operation(owner.cookie, 'doc-order-next', 3, { type: 'doc.blocks.reorder', blockIds: ['block-1', 'block-2', 'block-3'] })
    assert.equal(nextOrder.status, 200)
    const stale = await operation(editor.cookie, 'doc-order-stale', 3, { type: 'doc.blocks.reorder', blockIds: ['block-3', 'block-1', 'block-2'] })
    assert.equal(stale.status, 409)
    assert.deepEqual(stale.payload.conflicts, ['pages[page-1].blocks.order'])
  } finally { await api.close() }
})

test('concurrent Docs table merges reject rectangles that overlap through rowSpan', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Vertical merge owner', 'doc-vmerge-owner@example.test')
    const editor = await registerAndLogin(api, 'Horizontal merge editor', 'doc-vmerge-editor@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Crossed table merge', data: {
      type: 'doc', width: 794, pages: [{ id: 'page-1', elements: [], blocks: [{ id: 'table-1', type: 'table', text: '', cells: [['', ''], ['', '']] }] }],
    } } })
    assert.equal(created.status, 201)
    const id = created.payload.id
    assert.equal((await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })).status, 201)
    const operation = (cookie, operationId, baseRevision, details) => api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie, body: { operationId, baseRevision, pageId: 'page-1', blockId: 'table-1', type: 'doc.table.structure', action: 'merge', ...details } })

    const vertical = await operation(owner.cookie, 'owner-vertical-merge', 1, { row: 0, column: 0, colSpan: 1, rowSpan: 2 })
    assert.equal(vertical.status, 200)
    assert.deepEqual(vertical.payload.document.pages[0].blocks[0].merges, [{ row: 0, column: 0, colSpan: 1, rowSpan: 2 }])

    const crossed = await operation(editor.cookie, 'editor-crossed-horizontal-merge', 1, { row: 1, column: 0, colSpan: 2 })
    assert.equal(crossed.status, 409, 'stale horizontal merge cannot intersect a newer vertical merge')
    assert.ok(crossed.payload.conflicts.includes('pages[page-1].blocks[table-1].merges'))
    const canonical = await api.request(`/api/documents/${id}`, { cookie: owner.cookie })
    assert.equal(canonical.payload.revision, 2)
    assert.deepEqual(canonical.payload.data.pages[0].blocks[0].merges, [{ row: 0, column: 0, colSpan: 1, rowSpan: 2 }], 'the rejected operation does not alter canonical table topology')
  } finally { await api.close() }
})

test('DOCX block batch inserts are atomic and replace only an unchanged blank paragraph', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Import owner', 'docx-batch-owner@example.test')
    const editor = await registerAndLogin(api, 'Import editor', 'docx-batch-editor@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Atomic import', data: { type: 'doc', width: 794, pages: [{ id: 'page-1', elements: [], blocks: [{ id: 'start', type: 'heading', text: 'Existing', marks: [] }] }] },
    } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const operation = (cookie, operationId, baseRevision, body) => api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie, body: { operationId, baseRevision, pageId: 'page-1', ...body } })
    const batch = await operation(editor.cookie, 'docx-batch-insert', 1, { type: 'doc.blocks.insert', afterBlockId: 'start', blocks: [
      { id: 'import-heading', type: 'heading', text: 'Imported heading', marks: [] },
      { id: 'import-table', type: 'table', text: '', cells: [['A', 'B'], ['', 'C']], merges: [{ row: 0, column: 0, colSpan: 1, rowSpan: 2 }], cellImages: { '0:1': [{ src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7s8AAAAASUVORK5CYII=', alt: 'Cell logo', width: 1, height: 1 }] } },
    ] })
    assert.equal(batch.status, 200)
    assert.deepEqual(batch.payload.document.pages[0].blocks.map(block => block.id), ['start', 'import-heading', 'import-table'])
    assert.deepEqual(batch.payload.document.pages[0].blocks[2].merges, [{ row: 0, column: 0, colSpan: 1, rowSpan: 2 }], 'vertical table merges are persisted for collaborators')
    assert.equal(batch.payload.document.pages[0].blocks[2].cellImages['0:1'][0].alt, 'Cell logo', 'embedded table image is persisted with its accessible description')
    const invalidCellImage = await operation(editor.cookie, 'docx-batch-invalid-cell-image', 2, { type: 'doc.blocks.insert', afterBlockId: 'import-table', blocks: [
      { id: 'invalid-image-table', type: 'table', text: '', cells: [['Only cell']], cellImages: { '1:0': [{ src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7s8AAAAASUVORK5CYII=', alt: 'Out of bounds', width: 1, height: 1 }] } },
    ] })
    assert.equal(invalidCellImage.status, 400, 'cell image coordinates must point to an existing table cell')
    const afterInvalidCellImage = await api.request(`/api/documents/${id}`, { cookie: owner.cookie })
    assert.deepEqual(afterInvalidCellImage.payload.data.pages[0].blocks.map(block => block.id), ['start', 'import-heading', 'import-table'], 'invalid cell image input rejects the whole batch')
    const collision = await operation(editor.cookie, 'docx-batch-collision', 2, { type: 'doc.blocks.insert', afterBlockId: 'start', blocks: [
      { id: 'should-not-partially-insert', type: 'paragraph', text: 'First', marks: [] },
      { id: 'import-heading', type: 'paragraph', text: 'Duplicate', marks: [] },
    ] })
    assert.equal(collision.status, 409)
    assert.deepEqual(collision.payload.current.data.pages[0].blocks.map(block => block.id), ['start', 'import-heading', 'import-table'], 'a collision does not apply part of the batch')

    const blank = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Blank import', data: { type: 'doc', width: 794, pages: [{ id: 'blank-page', elements: [], blocks: [{ id: 'blank', type: 'paragraph', text: '' }] }] },
    } })
    const replace = await api.request(`/api/documents/${blank.payload.id}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'docx-replace-blank', baseRevision: 1, pageId: 'blank-page', type: 'doc.blocks.insert', afterBlockId: null, replaceEmptyBlockId: 'blank',
      blocks: [{ id: 'first-imported', type: 'heading', text: 'First', marks: [] }, { id: 'second-imported', type: 'paragraph', text: 'Second', marks: [] }],
    } })
    assert.equal(replace.status, 200)
    assert.deepEqual(replace.payload.document.pages[0].blocks.map(block => block.id), ['first-imported', 'second-imported'])

    const concurrentBlank = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Concurrent blank import', data: { type: 'doc', width: 794, pages: [{ id: 'concurrent-page', elements: [], blocks: [{ id: 'concurrent-blank', type: 'paragraph', text: '' }] }] },
    } })
    const edit = await api.request(`/api/documents/${concurrentBlank.payload.id}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'docx-placeholder-edit', baseRevision: 1, pageId: 'concurrent-page', blockId: 'concurrent-blank', type: 'doc.block.text.set', text: 'Keep this text', marks: [],
    } })
    assert.equal(edit.status, 200)
    const staleReplace = await api.request(`/api/documents/${concurrentBlank.payload.id}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'docx-stale-placeholder', baseRevision: 1, pageId: 'concurrent-page', type: 'doc.blocks.insert', afterBlockId: null, replaceEmptyBlockId: 'concurrent-blank',
      blocks: [{ id: 'lost-import', type: 'paragraph', text: 'Imported', marks: [] }],
    } })
    assert.equal(staleReplace.status, 409)
    assert.deepEqual(staleReplace.payload.current.data.pages[0].blocks.map(block => block.text), ['Keep this text'], 'a concurrent edit prevents replacement of the starter paragraph')
  } finally { await api.close() }
})

test('Docs replace-all applies text and table-cell patches atomically across stale independent edits', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Replace owner', 'doc-replace-owner@example.test')
    const editor = await registerAndLogin(api, 'Replace editor', 'doc-replace-editor@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Replace all document', data: { type: 'doc', width: 794, pages: [{ id: 'page-1', elements: [], blocks: [
        { id: 'text-1', type: 'paragraph', text: 'Draft one', marks: [{ start: 0, end: 5, bold: true }] },
        { id: 'text-2', type: 'heading', text: 'Draft two', marks: [] },
        { id: 'table-1', type: 'table', text: '', cells: [['Draft cell', 'Other'], ['More', 'Draft again']] },
      ] }] },
    } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const operation = (cookie, operationId, baseRevision, body) => api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie, body: { operationId, baseRevision, pageId: 'page-1', ...body } })
    const editorText = await operation(editor.cookie, 'doc-replace-other-text', 1, { type: 'doc.block.text.set', blockId: 'text-2', text: 'Draft two updated', marks: [] })
    assert.equal(editorText.status, 200)
    const editorCell = await operation(editor.cookie, 'doc-replace-other-cell', 2, { type: 'doc.table.cell.set', blockId: 'table-1', row: 1, column: 0, value: 'More updated' })
    assert.equal(editorCell.status, 200)
    const replaced = await operation(owner.cookie, 'doc-replace-all-owner', 1, { type: 'doc.replace.apply',
      blocks: [{ blockId: 'text-1', text: 'Plan one', marks: [{ start: 0, end: 4, bold: true }] }, { blockId: 'text-2', text: 'Plan two', marks: [] }],
      cells: [{ blockId: 'table-1', row: 0, column: 0, value: 'Plan cell' }, { blockId: 'table-1', row: 1, column: 1, value: 'Plan again' }],
    })
    assert.equal(replaced.status, 200)
    assert.equal(replaced.payload.document.pages[0].blocks[0].text, 'Plan one')
    assert.equal(replaced.payload.document.pages[0].blocks[1].text, 'Plan two updated')
    assert.equal(replaced.payload.document.pages[0].blocks[2].cells[0][0], 'Plan cell')
    assert.equal(replaced.payload.document.pages[0].blocks[2].cells[1][0], 'More updated')
    assert.equal(replaced.payload.document.pages[0].blocks[2].cells[1][1], 'Plan again')
    assert.deepEqual(replaced.payload.document.pages[0].blocks[0].marks, [{ start: 0, end: 4, bold: true }])
    const conflict = await operation(editor.cookie, 'doc-replace-all-conflict', 1, { type: 'doc.replace.apply', blocks: [], cells: [{ blockId: 'table-1', row: 0, column: 0, value: 'Conflicting cell' }] })
    assert.equal(conflict.status, 409)
    assert.deepEqual(conflict.payload.conflicts, ['pages[page-1].blocks[table-1].cells[0][0]'])
  } finally { await api.close() }
})

test('design element operations combine independent property edits and reject concurrent writes to the same property', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Design owner', 'design-op-owner@example.test')
    const editor = await registerAndLogin(api, 'Design editor', 'design-op-editor@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Collaborative design', data: { type: 'design', width: 794, height: 1123, pages: [{ id: 'page-1', elements: [{ id: 'text-1', type: 'text', name: 'Texto', x: 100, y: 100, width: 200, height: 60, rotation: 0, text: 'Hello', fontSize: 24, fontFamily: 'Arial', color: '#222222', bold: false }, { id: 'line-1', type: 'shape', shape: 'line', name: 'Linha', x: 80, y: 220, width: 300, height: 8, rotation: 0, fill: '#222222', cornerRadius: 0, strokeWidth: 4, endArrow: true }] }] },
    } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const operation = (operationId, patch, baseRevision = 1) => ({ operationId, baseRevision, pageId: 'page-1', elementId: 'text-1', type: 'design.element.patch', patch })
    const ownerWrite = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('design-owner-x', { x: 120 }) })
    assert.equal(ownerWrite.status, 200)
    const editorWrite = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: operation('design-editor-y', { y: 140 }) })
    assert.equal(editorWrite.status, 200)
    assert.deepEqual({ x: editorWrite.payload.document.pages[0].elements[0].x, y: editorWrite.payload.document.pages[0].elements[0].y }, { x: 120, y: 140 })
    const ownerText = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('design-owner-text', { text: 'Hello there' }, 3) })
    assert.equal(ownerText.status, 200)
    const editorText = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: operation('design-editor-text', { text: 'Team Hello' }, 3) })
    assert.equal(editorText.status, 200)
    assert.equal(editorText.payload.document.pages[0].elements[0].text, 'Team Hello there')
    const conflict = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: operation('design-editor-conflict', { x: 300 }) })
    assert.equal(conflict.status, 409)
    assert.deepEqual(conflict.payload.conflicts, ['pages[page-1].elements[text-1].x'])
    const ownerColor = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('design-owner-color', { color: '#ff0000' }, 5) })
    assert.equal(ownerColor.status, 200)
    const colorConflict = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: operation('design-editor-color-conflict', { color: '#0000ff' }, 5) })
    assert.equal(colorConflict.status, 409)
    assert.deepEqual(colorConflict.payload.conflicts, ['pages[page-1].elements[text-1].color'])
    const markerSwap = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: { operationId: 'design-line-marker-swap', baseRevision: 6, pageId: 'page-1', elementId: 'line-1', type: 'design.element.patch', patch: { startArrow: true, endArrow: false } } })
    assert.equal(markerSwap.status, 200)
    assert.deepEqual({ startArrow: markerSwap.payload.document.pages[0].elements[1].startArrow, endArrow: markerSwap.payload.document.pages[0].elements[1].endArrow }, { startArrow: true, endArrow: false })
    const curveLine = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: { operationId: 'design-line-curve', baseRevision: 7, pageId: 'page-1', elementId: 'line-1', type: 'design.element.patch', patch: { curveOffset: -96 } } })
    assert.equal(curveLine.status, 200)
    assert.equal(curveLine.payload.document.pages[0].elements[1].curveOffset, -96)
    const invalidMarker = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: { operationId: 'design-line-marker-invalid', baseRevision: 8, pageId: 'page-1', elementId: 'line-1', type: 'design.element.patch', patch: { endArrow: 'arrow' } } })
    assert.equal(invalidMarker.status, 400)
    const duplicate = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('design-owner-x', { x: 120 }) })
    assert.equal(duplicate.payload.duplicate, true)
    assert.deepEqual({ x: duplicate.payload.document.pages[0].elements[0].x, y: duplicate.payload.document.pages[0].elements[0].y }, { x: 120, y: 140 })
  } finally { await api.close() }
})

test('video layer timing persists through authorized collaborative operations and rejects invalid durations', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Video owner', 'video-owner@example.test')
    const editor = await registerAndLogin(api, 'Video editor', 'video-editor@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Motion design', data: { type: 'video', width: 1920, height: 1080, videoDurationMs: 10_000, pages: [{ id: 'scene-1', name: 'Cena 1', background: '#ffffff', elements: [
        { id: 'title-1', type: 'text', name: 'T??tulo', x: 100, y: 100, width: 400, height: 80, rotation: 0, text: 'Abertura', fontSize: 48, fontFamily: 'Arial', color: '#111111', bold: true, startMs: 0, durationMs: 10_000 },
      ] }] },
    } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const timing = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'video-title-timing', baseRevision: 1, pageId: 'scene-1', elementId: 'title-1', type: 'design.element.patch', patch: { startMs: 1500, durationMs: 3500 },
    } })
    assert.equal(timing.status, 200, JSON.stringify(timing.payload))
    assert.deepEqual({ startMs: timing.payload.document.pages[0].elements[0].startMs, durationMs: timing.payload.document.pages[0].elements[0].durationMs }, { startMs: 1500, durationMs: 3500 })
    const invalid = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'video-invalid-duration', baseRevision: 2, pageId: 'scene-1', elementId: 'title-1', type: 'design.element.patch', patch: { durationMs: 1.5 },
    } })
    assert.equal(invalid.status, 400)
    const uploaded = await api.request(`/api/documents/${id}/media`, { method: 'POST', cookie: editor.cookie, body: { asset: {
      id: 'audio-source-1', name: 'Trilha.wav', mimeType: 'audio/wav', width: 1, height: 1, src: 'data:audio/wav;base64,UklGRg==', fingerprint: 'a'.repeat(64), createdAt: new Date().toISOString(),
    } } })
    assert.equal(uploaded.status, 201)
    const clip = { id: 'audio-clip-1', assetId: 'audio-source-1', name: 'Trilha.wav', kind: 'audio', startMs: 500, durationMs: 4000, sourceDurationMs: 8000, sourceStartMs: 1000, volume: 0.75 }
    const clipPatch = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'video-audio-clip-add', baseRevision: 2, pageId: 'scene-1', type: 'design.video.clip.create', clip,
    } })
    assert.equal(clipPatch.status, 200, JSON.stringify(clipPatch.payload))
    assert.deepEqual(clipPatch.payload.document.pages[0].timelineClips, [clip])
    const legacyListReplacement = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'video-audio-legacy-list-patch', baseRevision: 3, pageId: 'scene-1', type: 'design.page.patch', patch: { timelineClips: [clip] },
    } })
    assert.equal(legacyListReplacement.status, 400, 'timeline changes must use clip-level operations rather than replacing the complete clip list')
    const secondClip = { ...clip, id: 'audio-clip-2', name: 'Efeitos.wav', startMs: 1000, trackIndex: 1 }
    const concurrentCreate = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'video-audio-clip-add-concurrent', baseRevision: 2, pageId: 'scene-1', type: 'design.video.clip.create', clip: secondClip,
    } })
    assert.equal(concurrentCreate.status, 200, JSON.stringify(concurrentCreate.payload))
    assert.deepEqual(concurrentCreate.payload.document.pages[0].timelineClips.map(item => item.id), ['audio-clip-1', 'audio-clip-2'], 'distinct clip insertions rebase from the same revision')
    assert.equal(concurrentCreate.payload.document.pages[0].timelineClips[1].trackIndex, 1, 'video tracks persist as an optional clip-level lane index')
    const trackChange = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'video-audio-clip-track', baseRevision: 4, pageId: 'scene-1', type: 'design.video.clip.patch', clipId: secondClip.id, patch: { trackIndex: 2 },
    } })
    assert.equal(trackChange.status, 200, JSON.stringify(trackChange.payload))
    assert.equal(trackChange.payload.document.pages[0].timelineClips[1].trackIndex, 2)
    const invalidTrack = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'video-audio-clip-track-invalid', baseRevision: trackChange.payload.revision, pageId: 'scene-1', type: 'design.video.clip.patch', clipId: secondClip.id, patch: { trackIndex: 1000 },
    } })
    assert.equal(invalidTrack.status, 400, 'track indexes are bounded')
    const volume = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'video-audio-clip-volume', baseRevision: 4, pageId: 'scene-1', type: 'design.video.clip.patch', clipId: clip.id, patch: { volume: 0.5, fadeInMs: 600, fadeOutMs: 700 },
    } })
    assert.equal(volume.status, 200)
    assert.deepEqual({ fadeInMs: volume.payload.document.pages[0].timelineClips[0].fadeInMs, fadeOutMs: volume.payload.document.pages[0].timelineClips[0].fadeOutMs }, { fadeInMs: 600, fadeOutMs: 700 }, 'audio fade envelope patches persist through collaboration')
    const invalidFade = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'video-audio-clip-fade-invalid', baseRevision: volume.payload.revision, pageId: 'scene-1', type: 'design.video.clip.patch', clipId: clip.id, patch: { fadeInMs: 4001 },
    } })
    assert.equal(invalidFade.status, 400, 'fade duration cannot exceed its clip')
    const secondStart = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'video-audio-clip-two-start', baseRevision: 4, pageId: 'scene-1', type: 'design.video.clip.patch', clipId: secondClip.id, patch: { startMs: 1500 },
    } })
    assert.equal(secondStart.status, 200, 'edits to different clips rebase from a shared revision')
    const trimmedClip = { ...clip, durationMs: 3000, sourceStartMs: 2000, volume: 0.5, fadeInMs: 600, fadeOutMs: 700 }
    const sourceTrim = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'video-audio-source-trim', baseRevision: 4, pageId: 'scene-1', type: 'design.video.clip.patch', clipId: clip.id, patch: { sourceStartMs: 2000, durationMs: 3000 },
    } })
    assert.equal(sourceTrim.status, 200, JSON.stringify(sourceTrim.payload))
    assert.deepEqual(sourceTrim.payload.document.pages[0].timelineClips[0], trimmedClip, 'independent volume and source trim edits merge on the same clip')
    const sameField = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'video-audio-clip-volume-conflict', baseRevision: 4, pageId: 'scene-1', type: 'design.video.clip.patch', clipId: clip.id, patch: { volume: 0.8 },
    } })
    assert.equal(sameField.status, 409, 'overlapping edits to the same clip property surface a conflict')
    assert.deepEqual(sameField.payload.conflicts, [`pages[scene-1].timelineClips[${clip.id}].volume`])
    const staleDelete = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'video-audio-clip-stale-delete', baseRevision: 4, pageId: 'scene-1', type: 'design.video.clip.delete', clipId: clip.id,
    } })
    assert.equal(staleDelete.status, 409, 'a clip cannot be deleted after another user has edited it')
    const sourceOverrun = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'video-audio-source-overrun', baseRevision: sourceTrim.payload.revision, pageId: 'scene-1', type: 'design.video.clip.patch', clipId: clip.id, patch: { durationMs: 6500 },
    } })
    assert.equal(sourceOverrun.status, 400, 'server rejects a source trim that runs beyond the uploaded media')
    const deletedClip = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'video-audio-clip-delete', baseRevision: 7, pageId: 'scene-1', type: 'design.video.clip.delete', clipId: secondClip.id,
    } })
    assert.equal(deletedClip.status, 200)
    assert.deepEqual(deletedClip.payload.document.pages[0].timelineClips, [trimmedClip])
    const media = await api.request(`/api/documents/${id}/media`, { cookie: editor.cookie })
    assert.equal(media.payload.assets.find(asset => asset.id === 'audio-source-1').mimeType, 'audio/wav')
    const hidden = await api.request(`/api/documents/${id}/media/audio-source-1`, { method: 'DELETE', cookie: editor.cookie })
    assert.equal(hidden.status, 200)
    assert.equal((await api.request(`/api/documents/${id}/media`, { cookie: editor.cookie })).payload.assets.some(asset => asset.id === 'audio-source-1'), false, 'hidden assets stay out of the visible library')
    const referenced = await api.request(`/api/documents/${id}/media?includeReferenced=1`, { cookie: editor.cookie })
    assert.equal(referenced.payload.assets.find(asset => asset.id === 'audio-source-1').libraryVisible, 0, 'assets remain retrievable while the timeline references them')
  } finally { await api.close() }
})

test('video clip opacity persists collaboratively, defaults legacy clips to full opacity and rejects invalid values', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Video Opacity Owner', 'video-opacity-owner@example.test')
    const editor = await registerAndLogin(api, 'Video Opacity Editor', 'video-opacity-editor@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Video opacity', data: { type: 'video', width: 160, height: 90, videoDurationMs: 5000, pages: [{ id: 'opacity-page', elements: [], timelineClips: [{ id: 'legacy-video', assetId: 'video-asset', name: 'Video antigo', kind: 'video', startMs: 0, durationMs: 1000, sourceDurationMs: 1000, sourceStartMs: 0, volume: 0 }] }] },
    } })
    await api.request(`/api/documents/${created.payload.id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const clip = { id: 'opacity-video-clip', assetId: 'video-asset', name: 'Sobreposi????o', kind: 'video', startMs: 0, durationMs: 1000, sourceDurationMs: 1000, sourceStartMs: 0, volume: 0, trackIndex: 1 }
    const inserted = await api.request(`/api/documents/${created.payload.id}/operations`, { method: 'POST', cookie: owner.cookie, body: { operationId: 'opacity-clip-insert', baseRevision: 1, pageId: 'opacity-page', type: 'design.video.clip.create', clip } })
    assert.equal(inserted.status, 200)
    const changed = await api.request(`/api/documents/${created.payload.id}/operations`, { method: 'POST', cookie: editor.cookie, body: { operationId: 'opacity-clip-change', baseRevision: inserted.payload.revision, pageId: 'opacity-page', type: 'design.video.clip.patch', clipId: clip.id, patch: { opacity: 37, fitMode: 'cover', scale: 125, offsetX: 10, offsetY: -5 } } })
    assert.equal(changed.status, 200, JSON.stringify(changed.payload))
    assert.equal(changed.payload.document.pages[0].timelineClips[0].opacity, undefined, 'legacy clips keep their optional full-opacity default')
    assert.equal(changed.payload.document.pages[0].timelineClips[1].opacity, 37)
    assert.deepEqual(Object.fromEntries(['fitMode', 'scale', 'offsetX', 'offsetY'].map(key => [key, changed.payload.document.pages[0].timelineClips[1][key]])), { fitMode: 'cover', scale: 125, offsetX: 10, offsetY: -5 }, 'fit, scale, and framing offsets persist in the same collaborative patch')
    const animated = await api.request(`/api/documents/${created.payload.id}/operations`, { method: 'POST', cookie: editor.cookie, body: { operationId: 'opacity-keyframes-change', baseRevision: changed.payload.revision, pageId: 'opacity-page', type: 'design.video.clip.patch', clipId: clip.id, patch: { opacityKeyframes: [{ timeMs: 0, opacity: 0, easing: 'ease-in' }, { timeMs: 1000, opacity: 100 }] } } })
    assert.equal(animated.status, 200, JSON.stringify(animated.payload))
    assert.deepEqual(animated.payload.document.pages[0].timelineClips[1].opacityKeyframes, [{ timeMs: 0, opacity: 0, easing: 'ease-in' }, { timeMs: 1000, opacity: 100 }])
    const framed = await api.request(`/api/documents/${created.payload.id}/operations`, { method: 'POST', cookie: editor.cookie, body: { operationId: 'framing-keyframes-change', baseRevision: animated.payload.revision, pageId: 'opacity-page', type: 'design.video.clip.patch', clipId: clip.id, patch: { transformKeyframes: [{ timeMs: 0, scale: 100, offsetX: 0, offsetY: 0, easing: 'ease-out' }, { timeMs: 1000, scale: 200, offsetX: 50, offsetY: -50 }] } } })
    assert.equal(framed.status, 200, JSON.stringify(framed.payload))
    assert.deepEqual(framed.payload.document.pages[0].timelineClips[1].transformKeyframes, [{ timeMs: 0, scale: 100, offsetX: 0, offsetY: 0, easing: 'ease-out' }, { timeMs: 1000, scale: 200, offsetX: 50, offsetY: -50 }])
    const eased = await api.request(`/api/documents/${created.payload.id}/operations`, { method: 'POST', cookie: editor.cookie, body: { operationId: 'framing-animation-easing', baseRevision: framed.payload.revision, pageId: 'opacity-page', type: 'design.video.clip.patch', clipId: clip.id, patch: { animationEasing: 'ease-in-out' } } })
    assert.equal(eased.status, 200, 'valid easing is a collaborative clip field')
    assert.equal(eased.payload.document.pages[0].timelineClips[1].animationEasing, 'ease-in-out')
    const restored = await api.request(`/api/documents/${created.payload.id}`, { cookie: owner.cookie })
    assert.equal(restored.payload.data.pages[0].timelineClips[1].opacity, 37, 'opacity is persisted in the shared document')
    assert.deepEqual(restored.payload.data.pages[0].timelineClips[1].opacityKeyframes, [{ timeMs: 0, opacity: 0, easing: 'ease-in' }, { timeMs: 1000, opacity: 100 }], 'keyframes and their outgoing curves persist in the shared document')
    assert.deepEqual(restored.payload.data.pages[0].timelineClips[1].transformKeyframes, [{ timeMs: 0, scale: 100, offsetX: 0, offsetY: 0, easing: 'ease-out' }, { timeMs: 1000, scale: 200, offsetX: 50, offsetY: -50 }], 'framing keyframes and their outgoing curves persist in the shared document')
    assert.equal(restored.payload.data.pages[0].timelineClips[1].animationEasing, 'ease-in-out', 'animation curve persists in the shared document')
    const invalidEasing = await api.request(`/api/documents/${created.payload.id}/operations`, { method: 'POST', cookie: editor.cookie, body: { operationId: 'framing-animation-easing-invalid', baseRevision: eased.payload.revision, pageId: 'opacity-page', type: 'design.video.clip.patch', clipId: clip.id, patch: { animationEasing: 'bounce' } } })
    assert.equal(invalidEasing.status, 400, 'unknown easing names are rejected')
    const invalidKeyframeEasing = await api.request(`/api/documents/${created.payload.id}/operations`, { method: 'POST', cookie: editor.cookie, body: { operationId: 'framing-keyframe-easing-invalid', baseRevision: eased.payload.revision, pageId: 'opacity-page', type: 'design.video.clip.patch', clipId: clip.id, patch: { opacityKeyframes: [{ timeMs: 0, opacity: 0, easing: 'bounce' }, { timeMs: 1000, opacity: 100 }] } } })
    assert.equal(invalidKeyframeEasing.status, 400, 'unknown per-keyframe curves are rejected')
    const invalid = await api.request(`/api/documents/${created.payload.id}/operations`, { method: 'POST', cookie: editor.cookie, body: { operationId: 'opacity-clip-invalid', baseRevision: animated.payload.revision, pageId: 'opacity-page', type: 'design.video.clip.patch', clipId: clip.id, patch: { opacity: 101 } } })
    assert.equal(invalid.status, 400, 'opacity is limited to 0???100 percent')
    const invalidScale = await api.request(`/api/documents/${created.payload.id}/operations`, { method: 'POST', cookie: editor.cookie, body: { operationId: 'opacity-clip-invalid-scale', baseRevision: changed.payload.revision, pageId: 'opacity-page', type: 'design.video.clip.patch', clipId: clip.id, patch: { scale: 301 } } })
    assert.equal(invalidScale.status, 400, 'visual clip scale is bounded to 50???300 percent')
    const invalidFraming = await api.request(`/api/documents/${created.payload.id}/operations`, { method: 'POST', cookie: editor.cookie, body: { operationId: 'opacity-clip-invalid-mode', baseRevision: changed.payload.revision, pageId: 'opacity-page', type: 'design.video.clip.patch', clipId: clip.id, patch: { fitMode: 'stretch' } } })
    assert.equal(invalidFraming.status, 400, 'fit mode only accepts contain or cover')
    const invalidKeyframes = await api.request(`/api/documents/${created.payload.id}/operations`, { method: 'POST', cookie: editor.cookie, body: { operationId: 'opacity-keyframes-invalid', baseRevision: eased.payload.revision, pageId: 'opacity-page', type: 'design.video.clip.patch', clipId: clip.id, patch: { opacityKeyframes: [{ timeMs: 900, opacity: 100 }, { timeMs: 100, opacity: 0 }] } } })
    assert.equal(invalidKeyframes.status, 400, 'out-of-order keyframes are rejected')
    const outOfDurationKeyframes = await api.request(`/api/documents/${created.payload.id}/operations`, { method: 'POST', cookie: editor.cookie, body: { operationId: 'opacity-keyframes-out-of-range', baseRevision: eased.payload.revision, pageId: 'opacity-page', type: 'design.video.clip.patch', clipId: clip.id, patch: { opacityKeyframes: [{ timeMs: 1001, opacity: 50 }] } } })
    assert.equal(outOfDurationKeyframes.status, 400, 'keyframes outside the clip duration are rejected')
    const invalidTransformKeyframes = await api.request(`/api/documents/${created.payload.id}/operations`, { method: 'POST', cookie: editor.cookie, body: { operationId: 'framing-keyframes-invalid', baseRevision: eased.payload.revision, pageId: 'opacity-page', type: 'design.video.clip.patch', clipId: clip.id, patch: { transformKeyframes: [{ timeMs: 0, scale: 20, offsetX: 0, offsetY: 0 }] } } })
    assert.equal(invalidTransformKeyframes.status, 400, 'animated framing limits are enforced')
    const outOfDurationTransformKeyframes = await api.request(`/api/documents/${created.payload.id}/operations`, { method: 'POST', cookie: editor.cookie, body: { operationId: 'framing-keyframes-out-of-range', baseRevision: eased.payload.revision, pageId: 'opacity-page', type: 'design.video.clip.patch', clipId: clip.id, patch: { transformKeyframes: [{ timeMs: 1001, scale: 100, offsetX: 0, offsetY: 0 }] } } })
    assert.equal(outOfDurationTransformKeyframes.status, 400, 'animated framing points are bounded by clip duration')
    const invalidTransformOffset = await api.request(`/api/documents/${created.payload.id}/operations`, { method: 'POST', cookie: editor.cookie, body: { operationId: 'framing-keyframes-invalid-offset', baseRevision: eased.payload.revision, pageId: 'opacity-page', type: 'design.video.clip.patch', clipId: clip.id, patch: { transformKeyframes: [{ timeMs: 0, scale: 100, offsetX: 101, offsetY: 0 }] } } })
    assert.equal(invalidTransformOffset.status, 400, 'animated framing offsets are bounded to ??100 percent')
    const audio = { ...clip, id: 'opacity-audio-clip', name: '??udio', kind: 'audio', trackIndex: undefined }
    const audioClip = await api.request(`/api/documents/${created.payload.id}/operations`, { method: 'POST', cookie: owner.cookie, body: { operationId: 'opacity-audio-insert', baseRevision: eased.payload.revision, pageId: 'opacity-page', type: 'design.video.clip.create', clip: audio } })
    assert.equal(audioClip.status, 200)
    const invalidAudio = await api.request(`/api/documents/${created.payload.id}/operations`, { method: 'POST', cookie: editor.cookie, body: { operationId: 'opacity-audio-invalid', baseRevision: audioClip.payload.revision, pageId: 'opacity-page', type: 'design.video.clip.patch', clipId: audio.id, patch: { opacity: 50 } } })
    assert.equal(invalidAudio.status, 400, 'audio clips cannot be assigned visual opacity')
  } finally { await api.close() }
})

test('design element create and delete operations rebase safe structural changes and reject stale deletions', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Structure owner', 'structure-owner@example.test')
    const editor = await registerAndLogin(api, 'Structure editor', 'structure-editor@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Collaborative structure', data: { type: 'whiteboard', width: 1600, height: 1000, pages: [{ id: 'page-1', elements: [{ id: 'base-shape', type: 'shape', name: 'Base', shape: 'rect', x: 0, y: 0, width: 100, height: 100, rotation: 0, fill: '#fff', cornerRadius: 0 }] }] },
    } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const shape = elementId => ({ id: elementId, type: 'shape', name: elementId, shape: 'line', x: 40, y: 50, width: 80, height: 8, rotation: 0, fill: '#f00', cornerRadius: 0, strokeWidth: 6 })
    const operation = (operationId, baseRevision, type, payload) => ({ operationId, baseRevision, pageId: 'page-1', type, ...payload })
    const ownerCreate = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('structure-create-owner', 1, 'design.elements.create', { elements: [shape('owner-shape')] }) })
    assert.equal(ownerCreate.status, 200)
    const editorCreate = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: operation('structure-create-editor', 1, 'design.elements.create', { elements: [shape('editor-shape')] }) })
    assert.equal(editorCreate.status, 200)
    assert.deepEqual(editorCreate.payload.document.pages[0].elements.map(element => element.id), ['base-shape', 'owner-shape', 'editor-shape'])

    const ownerPatch = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('structure-patch-owner', 3, 'design.element.patch', { elementId: 'owner-shape', patch: { x: 90 } }) })
    assert.equal(ownerPatch.status, 200)
    const changeVectorShape = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: operation('structure-vector-shape', 4, 'design.element.patch', { elementId: 'owner-shape', patch: { shape: 'arrow', strokeWidth: 12 } }) })
    assert.equal(changeVectorShape.status, 200, JSON.stringify(changeVectorShape.payload))
    assert.deepEqual({ shape: changeVectorShape.payload.document.pages[0].elements[1].shape, strokeWidth: changeVectorShape.payload.document.pages[0].elements[1].strokeWidth }, { shape: 'arrow', strokeWidth: 12 })
    const invalidVectorStroke = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('structure-invalid-vector-stroke', 5, 'design.element.patch', { elementId: 'owner-shape', patch: { strokeWidth: 0 } }) })
    assert.equal(invalidVectorStroke.status, 400)
    const staleDelete = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: operation('structure-stale-delete', 3, 'design.elements.delete', { elementIds: ['owner-shape'] }) })
    assert.equal(staleDelete.status, 409)
    assert.deepEqual(staleDelete.payload.conflicts, ['pages[page-1].elements[owner-shape]'])

    const currentDelete = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: operation('structure-current-delete', 5, 'design.elements.delete', { elementIds: ['editor-shape'] }) })
    assert.equal(currentDelete.status, 200)
    assert.deepEqual(currentDelete.payload.document.pages[0].elements.map(element => element.id), ['base-shape', 'owner-shape'])
    assert.deepEqual(currentDelete.payload.document.pages[0].groups, [])
    assert.deepEqual(currentDelete.payload.document.pages[0].connectors, [])
  } finally { await api.close() }
})

test('site publication and print checkout stay disabled until a provider is injected or configured', async () => {
  let networkCalls = 0
  const api = await startApi({
    externalProviderEnv: {},
    externalProviderFetch: async () => { networkCalls++; throw new Error('tests must never reach a network') },
  })
  try {
    const owner = await registerAndLogin(api, 'External provider owner', 'external-provider-owner@example.test')
    const site = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Local site', data: { type: 'site', width: 1366, height: 768, pages: [{ id: 'home', name: 'Home', elements: [] }] } } })
    const design = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Print card', data: { type: 'design', width: 1050, height: 600, pages: [{ id: 'front', name: 'Front', elements: [] }] } } })
    assert.equal(site.status, 201)
    assert.equal(design.status, 201)

    const providerStatus = await api.request('/api/providers/status')
    assert.deepEqual(providerStatus.payload.sitePublication, { configured: false, missing: ['SITE_PUBLISHER_URL', 'SITE_PUBLISHER_TOKEN'] })
    assert.deepEqual(providerStatus.payload.printCheckout, { configured: false, missing: ['PRINT_CHECKOUT_URL', 'PRINT_CHECKOUT_TOKEN'] })
    assert.equal(JSON.stringify(providerStatus.payload).includes('secret'), false, 'provider status contains no credentials')
    assert.equal((await api.request(`/api/sites/${site.payload.id}/publish`, { method: 'POST', cookie: owner.cookie, body: { slug: 'local-site' } })).status, 503)
    assert.equal((await api.request('/api/print/checkout', { method: 'POST', cookie: owner.cookie, body: { documentId: design.payload.id, options: { format: 'vertical-standard', paper: 'premium', finish: 'matte', quantity: 150 } } })).status, 503)
    assert.equal(networkCalls, 0, 'disabled provider routes never invoke fetch')
  } finally { await api.close() }
})

test('site publication and print checkout use injected adapters with owner checks and audited payload boundaries', async () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'fuse-site-publication-state-'))
  const databasePath = join(temporaryRoot, 'studio.sqlite')
  const siteRequests = []
  const checkoutRequests = []
  const apiOptions = {
    databasePath,
    externalProviderEnv: {},
    externalProviderFetch: async () => { throw new Error('injected adapters must be used instead of network fetch') },
    sitePublisher: { publish: async request => { siteRequests.push(request); return { url: 'https://sites.example.test/launch', deploymentId: 'deploy-test-1' } } },
    printCheckoutProvider: { createCheckout: async request => { checkoutRequests.push(request); return { checkoutUrl: 'https://checkout.example.test/session', sessionId: 'session-test-1' } } },
  }
  let api = await startApi(apiOptions)
  try {
    const owner = await registerAndLogin(api, 'Injected provider owner', 'injected-provider-owner@example.test')
    const outsider = await registerAndLogin(api, 'Provider outsider', 'provider-outsider@example.test')
    const site = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Launch', data: { type: 'site', width: 1366, height: 768, pages: [
      { id: 'public-home', name: 'Home', elements: [], presenterNotes: 'private notes' },
      { id: 'hidden-draft', name: 'Draft', hidden: true, elements: [{ id: 'private-copy', type: 'text', text: 'draft only' }] },
    ] } } })
    const design = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Card', data: { type: 'design', width: 1050, height: 600, pages: [{ id: 'front', name: 'Front', elements: [] }] } } })
    assert.equal(site.status, 201)
    assert.equal(design.status, 201)
    assert.deepEqual((await api.request(`/api/sites/${site.payload.id}/publication`, { cookie: owner.cookie })).payload, { publication: null, currentRevision: 1, isOutdated: false })
    assert.deepEqual((await api.request('/api/providers/status')).payload, {
      sitePublication: { configured: true, missing: [] }, printCheckout: { configured: true, missing: [] },
    })

    assert.equal((await api.request(`/api/sites/${site.payload.id}/publish`, { method: 'POST', cookie: outsider.cookie, body: { slug: 'launch' } })).status, 404, 'non-collaborators cannot publish another account site')
    assert.equal((await api.request('/api/print/checkout', { method: 'POST', cookie: outsider.cookie, body: { documentId: design.payload.id, options: { format: 'vertical-standard', paper: 'premium', finish: 'matte', quantity: 150 } } })).status, 404, 'non-collaborators cannot start checkout for another account design')
    assert.equal(siteRequests.length, 0)
    assert.equal(checkoutRequests.length, 0)

    const published = await api.request(`/api/sites/${site.payload.id}/publish`, { method: 'POST', cookie: owner.cookie, body: { slug: 'Launch-2026' } })
    assert.equal(published.status, 200)
    assert.equal(published.payload.publication.slug, 'launch-2026')
    assert.equal(published.payload.publication.url, 'https://sites.example.test/launch')
    assert.equal(published.payload.publication.deploymentId, 'deploy-test-1')
    assert.ok(Number.isFinite(Date.parse(published.payload.publication.publishedAt)))
    assert.equal(published.payload.publication.publishedRevision, 1)
    assert.equal(siteRequests[0].slug, 'launch-2026', 'site slugs are normalized before provider handoff')
    assert.equal(siteRequests[0].site.pages.length, 1, 'hidden site sections are excluded from publication')
    assert.equal(Object.hasOwn(siteRequests[0].site.pages[0], 'presenterNotes'), false, 'private presenter notes are excluded')
    assert.equal((await api.request(`/api/sites/${site.payload.id}/publish`, { method: 'POST', cookie: owner.cookie, body: { slug: '../invalid' } })).status, 400)
    assert.equal(siteRequests.length, 1, 'invalid site slugs never reach the provider')

    await api.close()
    api = await startApi(apiOptions)
    const persistedPublication = await api.request(`/api/sites/${site.payload.id}/publication`, { cookie: owner.cookie })
    assert.equal(persistedPublication.status, 200)
    assert.deepEqual(persistedPublication.payload.publication, published.payload.publication, 'latest deployment metadata and captured revision survive server restart')
    assert.equal(persistedPublication.payload.currentRevision, 1)
    assert.equal(persistedPublication.payload.isOutdated, false)
    assert.equal((await api.request(`/api/sites/${site.payload.id}/publication`, { cookie: outsider.cookie })).status, 404, 'publication state is owner-only')

    const editedSite = structuredClone(site.payload.data)
    editedSite.pages[0].name = 'Updated Home'
    const edited = await api.request(`/api/documents/${site.payload.id}`, { method: 'PUT', cookie: owner.cookie, body: { revision: 1, name: 'Launch', data: editedSite } })
    assert.equal(edited.status, 200)
    const outdatedPublication = await api.request(`/api/sites/${site.payload.id}/publication`, { cookie: owner.cookie })
    assert.equal(outdatedPublication.payload.currentRevision, 2)
    assert.equal(outdatedPublication.payload.publication.publishedRevision, 1)
    assert.equal(outdatedPublication.payload.isOutdated, true, 'editing the Site marks its saved publication as stale')
    assert.equal(siteRequests.length, 1, 'reading stale publication state does not republish the Site')

    const invalidOptions = await api.request('/api/print/checkout', { method: 'POST', cookie: owner.cookie, body: { documentId: design.payload.id, options: { format: 'vertical-standard', paper: 'premium', finish: 'matte', quantity: 123 } } })
    assert.equal(invalidOptions.status, 400)
    assert.equal(checkoutRequests.length, 0, 'invalid print quantities never reach the checkout provider')
    const checkout = await api.request('/api/print/checkout', { method: 'POST', cookie: owner.cookie, body: { documentId: design.payload.id, options: { format: 'vertical-standard', paper: 'premium', finish: 'matte', quantity: 150 } } })
    assert.equal(checkout.status, 200)
    assert.deepEqual(checkout.payload.checkout, { checkoutUrl: 'https://checkout.example.test/session', sessionId: 'session-test-1' })
    assert.equal(checkoutRequests[0].product, 'business-card')
    assert.deepEqual(checkoutRequests[0].options, { format: 'vertical-standard', paper: 'premium', finish: 'matte', quantity: 150 })
  } finally { await api.close(); rmSync(temporaryRoot, { recursive: true, force: true }) }
})

test('site sections accept collaborative element and page operations for authorized editors', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Site owner', 'site-owner@example.test')
    const editor = await registerAndLogin(api, 'Site editor', 'site-editor@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Portfolio site', data: { type: 'site', width: 1440, height: 900, pages: [{ id: 'home', name: 'In??cio', background: '#ffffff', elements: [{ id: 'hero', type: 'text', name: 'Hero', x: 100, y: 100, width: 500, height: 100, rotation: 0, text: 'Ol??', href: '#about', fontSize: 48, fontFamily: 'Arial', color: '#222222', bold: true }] }] },
    } })
    assert.equal(created.status, 201)
    const unsafeSnapshot = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Unsafe site', data: { type: 'site', width: 1440, height: 900, pages: [{ id: 'unsafe-home', elements: [{ id: 'unsafe-link', type: 'text', name: 'Unsafe link', x: 0, y: 0, width: 100, height: 40, rotation: 0, text: 'No', href: 'javascript:alert(1)', fontSize: 20, fontFamily: 'Arial', color: '#000000', bold: false }] }] },
    } })
    assert.equal(unsafeSnapshot.status, 400)
    const documentId = created.payload.id
    await api.request(`/api/documents/${documentId}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const patch = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'site-hero-copy', baseRevision: 1, pageId: 'home', type: 'design.element.patch', elementId: 'hero', patch: { text: 'Ol?? do editor', href: '#sobre' },
    } })
    assert.equal(patch.status, 200, JSON.stringify(patch.payload))
    assert.equal(patch.payload.document.pages[0].elements[0].text, 'Ol?? do editor')
    assert.equal(patch.payload.document.pages[0].elements[0].href, '#sobre')
    const unsafeLink = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'site-unsafe-href', baseRevision: 2, pageId: 'home', type: 'design.element.patch', elementId: 'hero', patch: { href: 'javascript:alert(1)' },
    } })
    assert.equal(unsafeLink.status, 400)
    const section = { id: 'about', name: 'Sobre', background: '#f5f4fa', elements: [] }
    const inserted = await api.request(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'site-section-insert', baseRevision: 2, pageId: 'home', type: 'design.page.insert', afterPageId: 'home', page: section,
    } })
    assert.equal(inserted.status, 200, JSON.stringify(inserted.payload))
    assert.deepEqual(inserted.payload.document.pages.map(page => page.name), ['In??cio', 'Sobre'])
  } finally { await api.close() }
})

test('image opacity and flips persist through validated collaborative operations', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Image owner', 'image-effects-owner@example.test')
    const editor = await registerAndLogin(api, 'Image editor', 'image-effects-editor@example.test')
    const image = { id: 'image-1', type: 'image', name: 'Raster', src: 'data:image/png;base64,AA==', x: 12, y: 20, width: 80, height: 60, rotation: 0 }
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Image effects', data: { type: 'design', width: 320, height: 240, pages: [{ id: 'page-1', name: 'Page 1', background: '#ffffff', elements: [image] }] },
    } })
    assert.equal(created.status, 201)
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const operation = (operationId, baseRevision, patch) => ({ operationId, baseRevision, pageId: 'page-1', type: 'design.element.patch', elementId: image.id, patch })
    const opacity = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('image-opacity-50', 1, { opacity: 50 }) })
    assert.equal(opacity.status, 200, JSON.stringify(opacity.payload))
    const horizontal = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('image-flip-x', 2, { flipX: true }) })
    assert.equal(horizontal.status, 200)
    const vertical = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('image-flip-y', 3, { flipY: true }) })
    assert.equal(vertical.status, 200)
    const brightness = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('image-brightness-20', 4, { brightness: 20 }) })
    assert.equal(brightness.status, 200)
    const maskStrokes = [{ mode: 'erase', size: 0.0025, points: [0.2, 0.3, 0.4, 0.5] }, { mode: 'restore', size: 0.05, points: [0.3, 0.4, 0.32, 0.42] }]
    const vintage = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('image-filter-vintage', 5, { filterPreset: 'vintage', maskStrokes }) })
    assert.equal(vintage.status, 200, JSON.stringify(vintage.payload))
    const colorAdjustments = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('image-color-adjustments', 6, { contrast: 35, saturation: -20 }) })
    assert.equal(colorAdjustments.status, 200, JSON.stringify(colorAdjustments.payload))
    assert.deepEqual({ contrast: colorAdjustments.payload.document.pages[0].elements[0].contrast, saturation: colorAdjustments.payload.document.pages[0].elements[0].saturation }, { contrast: 35, saturation: -20 }, 'contrast and saturation are stored in the shared image model')
    const replacementSrc = `data:image/png;base64,${'A'.repeat(250_000)}`
    const mediaUpload = await api.request(`/api/documents/${id}/media`, { method: 'POST', cookie: owner.cookie, body: { asset: { id: 'media-2', name: 'Novo arquivo', mimeType: 'image/png', width: 80, height: 60, src: replacementSrc, fingerprint: 'c'.repeat(64) } } })
    assert.equal(mediaUpload.status, 201)
    const replacement = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: { operationId: 'image-replace-editor', baseRevision: 7, pageId: 'page-1', type: 'design.element.patch', elementId: image.id, patch: { name: 'Novo arquivo', assetId: 'media-2', src: replacementSrc } } })
    assert.equal(replacement.status, 200, JSON.stringify(replacement.payload))
    const replacedImage = replacement.payload.document.pages[0].elements[0]
    assert.deepEqual({ name: replacedImage.name, assetId: replacedImage.assetId, srcLength: replacedImage.src.length, x: replacedImage.x, y: replacedImage.y, width: replacedImage.width, height: replacedImage.height, rotation: replacedImage.rotation, opacity: replacedImage.opacity, flipX: replacedImage.flipX, flipY: replacedImage.flipY, brightness: replacedImage.brightness, contrast: replacedImage.contrast, saturation: replacedImage.saturation, filterPreset: replacedImage.filterPreset, maskStrokes: replacedImage.maskStrokes }, { name: 'Novo arquivo', assetId: 'media-2', srcLength: replacementSrc.length, x: 12, y: 20, width: 80, height: 60, rotation: 0, opacity: 50, flipX: true, flipY: true, brightness: 20, contrast: 35, saturation: -20, filterPreset: 'vintage', maskStrokes })
    const hydrated = await api.request(`/api/documents/${id}`, { cookie: editor.cookie })
    assert.equal(hydrated.payload.data.pages[0].elements[0].src, replacementSrc, 'media bytes hydrate from the shared asset reference after persistence')
    const invalid = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('image-invalid-opacity', 8, { opacity: 101 }) })
    assert.equal(invalid.status, 400)
    const invalidBrightness = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('image-invalid-brightness', 8, { brightness: 101 }) })
    assert.equal(invalidBrightness.status, 400)
    const invalidContrast = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('image-invalid-contrast', 8, { contrast: 101 }) })
    assert.equal(invalidContrast.status, 400)
    const invalidSaturation = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('image-invalid-saturation', 8, { saturation: -101 }) })
    assert.equal(invalidSaturation.status, 400)
    const invalidFilter = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('image-invalid-filter', 8, { filterPreset: 'not-a-filter' }) })
    assert.equal(invalidFilter.status, 400)
    const invalidMask = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: operation('image-invalid-mask', 8, { maskStrokes: [{ mode: 'erase', size: .001, points: [.2, .5] }] }) })
    assert.equal(invalidMask.status, 400)
  } finally { await api.close() }
})

test('document media library is shared with authorized readers and protects referenced assets', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Media owner', 'media-owner@example.test')
    const editor = await registerAndLogin(api, 'Media editor', 'media-editor@example.test')
    const viewer = await registerAndLogin(api, 'Media viewer', 'media-viewer@example.test')
    const image = { id: 'used-image', type: 'image', name: 'Shared portrait', src: 'data:image/png;base64,AA==', assetId: 'media-used', x: 20, y: 30, width: 80, height: 60, rotation: 0 }
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Shared media', data: { type: 'design', width: 320, height: 240, pages: [{ id: 'page-1', name: 'Page 1', background: '#ffffff', elements: [image] }] },
    } })
    assert.equal(created.status, 201)
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: viewer.user.email, role: 'viewer' } })
    const media = { id: 'media-used', name: 'Shared portrait', mimeType: 'image/png', width: 80, height: 60, src: 'data:image/png;base64,AA==', fingerprint: 'a'.repeat(64), createdAt: new Date().toISOString() }
    const upload = await api.request(`/api/documents/${id}/media`, { method: 'POST', cookie: owner.cookie, body: { asset: media } })
    assert.equal(upload.status, 201, JSON.stringify(upload.payload))
    const editorLibrary = await api.request(`/api/documents/${id}/media`, { cookie: editor.cookie })
    assert.equal(editorLibrary.status, 200)
    assert.deepEqual(editorLibrary.payload.assets.map(asset => asset.id), ['media-used'])
    const viewerLibrary = await api.request(`/api/documents/${id}/media`, { cookie: viewer.cookie })
    assert.equal(viewerLibrary.payload.assets[0].src, media.src)
    const deniedUpload = await api.request(`/api/documents/${id}/media`, { method: 'POST', cookie: viewer.cookie, body: { asset: { ...media, id: 'viewer-upload', fingerprint: 'b'.repeat(64) } } })
    assert.equal(deniedUpload.status, 403)
    const duplicate = await api.request(`/api/documents/${id}/media`, { method: 'POST', cookie: editor.cookie, body: { asset: { ...media, id: 'duplicate-id' } } })
    assert.equal(duplicate.status, 200)
    assert.equal(duplicate.payload.asset.id, 'media-used')
    const retained = await api.request(`/api/documents/${id}/media/media-used`, { method: 'DELETE', cookie: editor.cookie })
    assert.equal(retained.payload.retained, true)
    assert.equal((await api.request(`/api/documents/${id}/media`, { cookie: editor.cookie })).payload.assets.length, 0)
    assert.equal((await api.request(`/api/documents/${id}`, { cookie: editor.cookie })).payload.data.pages[0].elements[0].assetId, 'media-used')
    const restored = await api.request(`/api/documents/${id}/media`, { method: 'POST', cookie: editor.cookie, body: { asset: { ...media, id: 'media-restored' } } })
    assert.equal(restored.status, 200)
    assert.equal(restored.payload.asset.id, 'media-used', 're-adding a known fingerprint restores the referenced shared asset without duplicating it')
    assert.equal((await api.request(`/api/documents/${id}/media`, { cookie: editor.cookie })).payload.assets.length, 1)
    const deniedDelete = await api.request(`/api/documents/${id}/media/media-used`, { method: 'DELETE', cookie: viewer.cookie })
    assert.equal(deniedDelete.status, 403)
  } finally { await api.close() }
})

test('team media library shares uploads across members with scoped access and admin removal', async () => {
  const api = await startApi()
  try {
    const admin = await registerAndLogin(api, 'Media team admin', 'media-team-admin@example.test')
    const outsider = await registerAndLogin(api, 'Media outsider', 'media-team-outsider@example.test')
    const createdTeam = await api.request('/api/teams', { method: 'POST', cookie: admin.cookie, body: { name: 'Shared assets' } })
    const teamId = createdTeam.payload.team.id
    const invite = await api.request(`/api/teams/${teamId}/invitations`, { method: 'POST', cookie: admin.cookie, body: { email: 'media-team-member@example.test' } })
    const member = await registerAndLogin(api, 'Media team member', 'media-team-member@example.test')
    assert.equal((await api.request(`/api/team-invitations/${invite.payload.invitation.token}`, { method: 'POST', cookie: member.cookie })).status, 200)
    const asset = { id: 'team-logo', name: 'Team logo', mimeType: 'image/png', width: 32, height: 32, src: 'data:image/png;base64,AA==', fingerprint: 'c'.repeat(64) }
    const uploaded = await api.request(`/api/teams/${teamId}/media`, { method: 'POST', cookie: admin.cookie, body: { asset } })
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.payload))
    assert.equal(uploaded.payload.asset.scope, 'team')
    const memberLibrary = await api.request(`/api/teams/${teamId}/media`, { cookie: member.cookie })
    assert.equal(memberLibrary.status, 200)
    assert.deepEqual(memberLibrary.payload.assets.map(item => item.id), ['team-logo'])
    assert.equal((await api.request(`/api/teams/${teamId}/media`, { cookie: outsider.cookie })).status, 404)
    const duplicate = await api.request(`/api/teams/${teamId}/media`, { method: 'POST', cookie: member.cookie, body: { asset: { ...asset, id: 'same-image-different-id' } } })
    assert.equal(duplicate.status, 200)
    assert.equal(duplicate.payload.asset.id, 'team-logo')
    assert.equal((await api.request(`/api/teams/${teamId}/media/team-logo`, { method: 'DELETE', cookie: member.cookie })).status, 403)
    assert.equal((await api.request(`/api/teams/${teamId}/media/team-logo`, { method: 'DELETE', cookie: admin.cookie })).status, 200)
    assert.deepEqual((await api.request(`/api/teams/${teamId}/media`, { cookie: member.cookie })).payload.assets, [])
  } finally { await api.close() }
})

test('team upload scope is persisted per team and enforced for members', async () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'fuse-team-brand-designers-'))
  const databasePath = join(temporaryRoot, 'studio.sqlite')
  let api = await startApi({ databasePath })
  try {
    const admin = await registerAndLogin(api, 'Policy team admin', 'policy-team-admin@example.test')
    const outsider = await registerAndLogin(api, 'Policy outsider', 'policy-outsider@example.test')
    const team = (await api.request('/api/teams', { method: 'POST', cookie: admin.cookie, body: { name: 'Upload policy team' } })).payload.team
    const otherTeam = (await api.request('/api/teams', { method: 'POST', cookie: admin.cookie, body: { name: 'Independent policy team' } })).payload.team
    const invite = await api.request(`/api/teams/${team.id}/invitations`, { method: 'POST', cookie: admin.cookie, body: { email: 'policy-team-member@example.test' } })
    const member = await registerAndLogin(api, 'Policy team member', 'policy-team-member@example.test')
    assert.equal((await api.request(`/api/team-invitations/${invite.payload.invitation.token}`, { method: 'POST', cookie: member.cookie })).status, 200)

    assert.deepEqual((await api.request(`/api/teams/${team.id}/policies`, { cookie: member.cookie })).payload.policies, {})
    assert.equal((await api.request(`/api/teams/${team.id}/policies`, { cookie: outsider.cookie })).status, 404)
    assert.equal((await api.request(`/api/teams/${team.id}/policies`, { method: 'PUT', cookie: member.cookie, body: { policies: { uploadScope: 'Admins e designers de marca da equipe' } } })).status, 403)
    assert.equal((await api.request(`/api/teams/${team.id}/policies`, { method: 'PUT', cookie: admin.cookie, body: { policies: { uploadScope: 'Nobody' } } })).status, 400)

    const savedPolicy = await api.request(`/api/teams/${team.id}/policies`, { method: 'PUT', cookie: admin.cookie, body: { policies: { uploadScope: 'Admins e designers de marca da equipe' } } })
    assert.equal(savedPolicy.status, 200)
    assert.deepEqual(savedPolicy.payload.policies, { uploadScope: 'Admins e designers de marca da equipe' })
    assert.deepEqual((await api.request(`/api/teams/${team.id}/policies`, { cookie: member.cookie })).payload.policies, savedPolicy.payload.policies)
    assert.deepEqual((await api.request(`/api/teams/${otherTeam.id}/policies`, { cookie: admin.cookie })).payload.policies, {}, 'team policy does not leak into another team')

    assert.equal((await api.request(`/api/teams/${team.id}/policies`, { method: 'PUT', cookie: member.cookie, body: { policies: { enabledIntegrations: '["drive"]' } } })).status, 403, 'only admins can change shared integration preferences')
    const enabledIntegrations = await api.request(`/api/teams/${team.id}/policies`, { method: 'PUT', cookie: admin.cookie, body: { policies: { enabledIntegrations: '["drive","figma"]' } } })
    assert.equal(enabledIntegrations.status, 200, JSON.stringify(enabledIntegrations.payload))
    assert.deepEqual(enabledIntegrations.payload.policies, { enabledIntegrations: '["drive","figma"]' })
    assert.equal((await api.request(`/api/teams/${team.id}/policies`, { cookie: member.cookie })).payload.policies.enabledIntegrations, '["drive","figma"]', 'all team members can read the shared preference')
    assert.equal((await api.request(`/api/teams/${otherTeam.id}/policies`, { cookie: admin.cookie })).payload.policies.enabledIntegrations, undefined, 'integration preference is scoped to its team')
    const duplicateIntegrations = await api.request(`/api/teams/${team.id}/policies`, { method: 'PUT', cookie: admin.cookie, body: { policies: { enabledIntegrations: '["drive","drive"]' } } })
    assert.equal(duplicateIntegrations.status, 400, 'duplicate integration IDs are rejected')
    const unknownIntegration = await api.request(`/api/teams/${team.id}/policies`, { method: 'PUT', cookie: admin.cookie, body: { policies: { enabledIntegrations: '["unknown"]' } } })
    assert.equal(unknownIntegration.status, 400, 'unrecognized integration IDs are rejected')

    const asset = { id: 'member-upload-blocked', name: 'Member upload', mimeType: 'image/png', width: 32, height: 32, src: 'data:image/png;base64,AA==' }
    assert.equal((await api.request(`/api/teams/${team.id}/media`, { method: 'POST', cookie: member.cookie, body: { asset } })).status, 403)
    assert.equal((await api.request(`/api/teams/${team.id}/media`, { method: 'POST', cookie: admin.cookie, body: { asset: { ...asset, id: 'admin-upload-allowed' } } })).status, 201)
    const memberId = member.user.id
    assert.equal((await api.request(`/api/teams/${team.id}/members`, { method: 'PATCH', cookie: member.cookie, body: { userId: memberId, brandDesigner: true } })).status, 403, 'only a team admin can assign the brand-designer designation')
    assert.equal((await api.request(`/api/teams/${team.id}/members`, { method: 'PATCH', cookie: member.cookie, body: { userId: memberId, role: 'admin' } })).status, 403, 'a brand designer cannot promote themselves to team admin')
    assert.equal((await api.request(`/api/teams/${team.id}/members`, { method: 'PATCH', cookie: admin.cookie, body: { userId: outsider.user.id, brandDesigner: true } })).status, 404, 'a designation cannot be assigned outside the team')
    const assigned = await api.request(`/api/teams/${team.id}/members`, { method: 'PATCH', cookie: admin.cookie, body: { userId: memberId, brandDesigner: true } })
    assert.equal(assigned.status, 200)
    assert.equal(assigned.payload.brandDesigner, true)
    const roster = await api.request(`/api/teams/${team.id}`, { cookie: member.cookie })
    const designatedMember = roster.payload.members.find(item => item.id === memberId)
    assert.equal(designatedMember.role, 'member', 'brand-designer status does not promote document/team administration role')
    assert.equal(designatedMember.brandDesigner, true)
    assert.equal((await api.request(`/api/teams/${team.id}/audit`, { cookie: member.cookie })).status, 403, 'brand designers do not gain admin-only audit access')
    assert.equal((await api.request(`/api/teams/${team.id}/policies`, { method: 'PUT', cookie: member.cookie, body: { policies: { uploadScope: 'Todo mundo' } } })).status, 403, 'brand designers cannot change team upload policy')

    await api.close()
    api = await startApi({ databasePath })
    const persistedRoster = await api.request(`/api/teams/${team.id}`, { cookie: member.cookie })
    assert.equal(persistedRoster.status, 200)
    assert.equal(persistedRoster.payload.members.find(item => item.id === memberId)?.brandDesigner, true, 'designation survives a server restart')
    assert.equal((await api.request(`/api/teams/${team.id}/media`, { method: 'POST', cookie: member.cookie, body: { asset: { ...asset, id: 'designer-upload-allowed' } } })).status, 201, 'brand designers can upload when policy allows admins and brand designers')
    const unassigned = await api.request(`/api/teams/${team.id}/members`, { method: 'PATCH', cookie: admin.cookie, body: { userId: memberId, brandDesigner: false } })
    assert.equal(unassigned.status, 200)
    assert.equal((await api.request(`/api/teams/${team.id}`, { cookie: member.cookie })).payload.members.find(item => item.id === memberId)?.brandDesigner, false, 'revocation is reflected in the roster')
    assert.equal((await api.request(`/api/teams/${team.id}/members`, { method: 'PATCH', cookie: admin.cookie, body: { userId: memberId, brandDesigner: 'yes' } })).status, 400, 'brand-designer assignment must be boolean')
    assert.equal((await api.request(`/api/teams/${team.id}/media`, { method: 'POST', cookie: member.cookie, body: { asset: { ...asset, id: 'designer-upload-blocked-after-unassign' } } })).status, 403)

    const reset = await api.request(`/api/teams/${team.id}/policies`, { method: 'PUT', cookie: admin.cookie, body: { policies: { uploadScope: 'Todo mundo' } } })
    assert.equal(reset.status, 200)
    assert.equal((await api.request(`/api/teams/${team.id}/media`, { method: 'POST', cookie: member.cookie, body: { asset: { ...asset, id: 'member-upload-restored' } } })).status, 201)

    await api.request(`/api/teams/${team.id}/policies`, { method: 'PUT', cookie: admin.cookie, body: { policies: { uploadScope: 'Admins e designers de marca da equipe' } } })
    assert.equal((await api.request(`/api/teams/${team.id}/members`, { method: 'PATCH', cookie: admin.cookie, body: { userId: memberId, brandDesigner: true } })).status, 200)
    assert.equal((await api.request(`/api/teams/${team.id}/members?userId=${memberId}`, { method: 'DELETE', cookie: admin.cookie })).status, 200, 'admin removal also removes the designation')
    const reinvite = await api.request(`/api/teams/${team.id}/invitations`, { method: 'POST', cookie: admin.cookie, body: { email: 'policy-team-member@example.test' } })
    assert.equal(reinvite.status, 201)
    assert.equal((await api.request(`/api/team-invitations/${reinvite.payload.invitation.token}`, { method: 'POST', cookie: member.cookie })).status, 200)
    const rejoined = await api.request(`/api/teams/${team.id}`, { cookie: member.cookie })
    assert.equal(rejoined.payload.members.find(item => item.id === memberId)?.brandDesigner, false, 'removal and rejoin do not resurrect a stale designation')
    const rejoinedUpload = await api.request(`/api/teams/${team.id}/media`, {
      method: 'POST', cookie: member.cookie, body: { asset: { ...asset, id: 'rejoined-member-upload-blocked' } },
    })
    assert.equal(rejoinedUpload.status, 403, 'a rejoined member must be explicitly designated again')
  } finally { await api.close(); rmSync(temporaryRoot, { recursive: true, force: true }) }
})

test('persistent media bytes use content-addressed files and migrate legacy inline rows', async () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'fuse-media-objects-'))
  const databasePath = join(temporaryRoot, 'studio.sqlite')
  const mediaObjectDir = join(temporaryRoot, 'objects')
  const serverOptions = { databasePath, mediaObjectDir }
  let api
  try {
    api = await startApi(serverOptions)
    const owner = await registerAndLogin(api, 'Object media owner', 'object-media-owner@example.test')
    const src = 'data:image/png;base64,AA=='
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'File-backed image', data: { type: 'design', width: 320, height: 240, pages: [{ id: 'file-page', name: 'Page', background: '#fff', elements: [{ id: 'file-image', type: 'image', name: 'File image', assetId: 'file-asset', src, x: 10, y: 10, width: 32, height: 24, rotation: 0 }] }] } } })
    const documentId = created.payload.id
    assert.equal((await api.request(`/api/documents/${documentId}/media`, { method: 'POST', cookie: owner.cookie, body: { asset: { id: 'file-asset', name: 'File image', mimeType: 'image/png', width: 32, height: 24, src } } })).status, 201)

    let database = new DatabaseSync(databasePath)
    let stored = database.prepare('SELECT src, object_key FROM document_media WHERE document_id = ? AND asset_id = ?').get(documentId, 'file-asset')
    assert.equal(stored.src, '', 'persistent SQLite metadata does not contain the base64 bytes')
    assert.match(stored.object_key, /^[a-f0-9]{64}$/)
    assert.equal(readFileSync(join(mediaObjectDir, `${stored.object_key}.blob`)).toString('base64'), 'AA==')
    database.close()

    const library = await api.request(`/api/documents/${documentId}/media`, { cookie: owner.cookie })
    assert.equal(library.payload.assets[0].src, src, 'API keeps the existing data-URI response contract')
    const copy = await api.request(`/api/documents/${documentId}/versions/1/copy`, { method: 'POST', cookie: owner.cookie })
    assert.equal(copy.status, 201)
    assert.equal((await api.request(`/api/documents/${copy.payload.id}/media`, { cookie: owner.cookie })).payload.assets[0].src, src, 'historical copies reuse the same file-backed object')

    await api.close()
    api = null
    database = new DatabaseSync(databasePath)
    database.prepare('UPDATE document_media SET src = ?, object_key = NULL WHERE document_id = ? AND asset_id = ?').run(src, documentId, 'file-asset')
    database.close()
    api = await startApi(serverOptions)
    database = new DatabaseSync(databasePath)
    stored = database.prepare('SELECT src, object_key FROM document_media WHERE document_id = ? AND asset_id = ?').get(documentId, 'file-asset')
    database.close()
    assert.equal(stored.src, '', 'startup migration moves a legacy inline media row into the object directory')
    assert.equal((await api.request(`/api/documents/${documentId}/media`, { cookie: owner.cookie })).payload.assets[0].src, src, 'legacy asset remains readable after migration')
  } finally {
    if (api) await api.close()
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('media referenced only by a restorable document version remains available', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'History media owner', 'history-media-owner@example.test')
    const src = 'data:image/png;base64,AA=='
    const image = { id: 'history-image', type: 'image', name: 'History image', assetId: 'history-asset', src, x: 10, y: 10, width: 32, height: 24, rotation: 0 }
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Historical media', data: { type: 'design', width: 320, height: 240, pages: [{ id: 'history-page', elements: [image] }] } } })
    const id = created.payload.id
    assert.equal((await api.request(`/api/documents/${id}/media`, { method: 'POST', cookie: owner.cookie, body: { asset: { id: 'history-asset', name: image.name, mimeType: 'image/png', width: 32, height: 24, src } } })).status, 201)
    const updated = await api.request(`/api/documents/${id}`, { method: 'PUT', cookie: owner.cookie, body: { revision: 1, name: created.payload.name, data: { ...created.payload.data, pages: [{ id: 'history-page', elements: [] }] } } })
    assert.equal(updated.status, 200)
    const hidden = await api.request(`/api/documents/${id}/media/history-asset`, { method: 'DELETE', cookie: owner.cookie })
    assert.deepEqual(hidden.payload, { ok: true, retained: true })
    const restored = await api.request(`/api/documents/${id}/versions/1/restore`, { method: 'POST', cookie: owner.cookie, body: { revision: 2 } })
    assert.equal(restored.status, 200)
    assert.equal(restored.payload.document.data.pages[0].elements[0].src, src, 'restoring the historical design still hydrates its image')
  } finally { await api.close() }
})

test('whiteboard group, duplicate relations and layer-order operations synchronize atomically', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Whiteboard owner', 'whiteboard-owner@example.test')
    const editor = await registerAndLogin(api, 'Whiteboard editor', 'whiteboard-editor@example.test')
    const shape = id => ({ id, type: 'shape', name: id, shape: 'rect', x: 0, y: 0, width: 50, height: 50, rotation: 0, fill: '#fff', cornerRadius: 0 })
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Whiteboard structure', data: { type: 'whiteboard', width: 1600, height: 1000, pages: [{ id: 'page-1', elements: [shape('shape-1'), shape('shape-2')], groups: [], connectors: [] }] },
    } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const op = (operationId, baseRevision, type, payload) => ({ operationId, baseRevision, pageId: 'page-1', type, ...payload })
    const group = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: op('whiteboard-group', 1, 'design.groups.set', { groups: [{ id: 'group-1', name: 'Grupo 1', elementIds: ['shape-1', 'shape-2'] }] }) })
    assert.equal(group.status, 200)
    const reorder = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: op('whiteboard-reorder', 1, 'design.elements.reorder', { elementIds: ['shape-2', 'shape-1'] }) })
    assert.equal(reorder.status, 200)
    assert.deepEqual(reorder.payload.document.pages[0].elements.map(element => element.id), ['shape-2', 'shape-1'])
    const ownerReorder = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: op('whiteboard-owner-reorder', 3, 'design.elements.reorder', { elementIds: ['shape-1', 'shape-2'] }) })
    assert.equal(ownerReorder.status, 200)
    const orderConflict = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: op('whiteboard-stale-reorder', 3, 'design.elements.reorder', { elementIds: ['shape-2', 'shape-1'] }) })
    assert.equal(orderConflict.status, 409)
    assert.deepEqual(orderConflict.payload.conflicts, ['pages[page-1].elements.order'])

    const relationCreate = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: op('whiteboard-duplicate-relations', 4, 'design.elements.create', {
      elements: [shape('shape-3'), shape('shape-4')],
      groups: [{ id: 'group-2', name: 'Grupo 1 ??? c??pia', elementIds: ['shape-3', 'shape-4'] }],
      connectors: [{ id: 'connector-2', fromId: 'shape-3', toId: 'shape-4', color: '#222', strokeWidth: 4 }],
    }) })
    assert.equal(relationCreate.status, 200)
    assert.deepEqual(relationCreate.payload.document.pages[0].groups.map(item => item.id), ['group-1', 'group-2'])
    assert.deepEqual(relationCreate.payload.document.pages[0].connectors.map(item => item.id), ['connector-2'])
    assert.deepEqual(relationCreate.payload.document.pages[0].elements.map(element => element.id), ['shape-1', 'shape-2', 'shape-3', 'shape-4'])
  } finally { await api.close() }
})

test('page insert, duplicate, reorder and delete operations rebase independent work and reject stale structure', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Pages owner', 'pages-owner@example.test')
    const editor = await registerAndLogin(api, 'Pages editor', 'pages-editor@example.test')
    const shape = id => ({ id, type: 'shape', name: id, shape: 'rect', x: 0, y: 0, width: 50, height: 50, rotation: 0, fill: '#fff', cornerRadius: 0 })
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Page operations', data: { type: 'presentation', width: 1920, height: 1080, pages: [
        { id: 'page-1', name: 'Slide 1', background: '#fff', elements: [shape('shape-1')], presenterNotes: 'Original notes' },
        { id: 'page-2', name: 'Slide 2', background: '#000', elements: [shape('shape-2')] },
      ] },
    } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const op = (operationId, baseRevision, pageId, type, payload) => ({ operationId, baseRevision, pageId, type, ...payload })
    const blankPage = { id: 'page-owner', name: 'Slide 2', background: '#ffffff', elements: [] }
    const ownerInsert = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: op('page-insert-owner', 1, 'page-1', 'design.page.insert', { page: blankPage, afterPageId: 'page-1' }) })
    assert.equal(ownerInsert.status, 200)
    const duplicatePage = { ...structuredClone(created.payload.data.pages[0]), id: 'page-editor', name: 'Slide 1 (c??pia)', elements: [shape('shape-editor-copy')] }
    const staleDuplicate = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: op('page-insert-editor', 1, 'page-1', 'design.page.insert', { page: duplicatePage, afterPageId: 'page-1', sourcePageId: 'page-1' }) })
    assert.equal(staleDuplicate.status, 200)
    assert.deepEqual(staleDuplicate.payload.document.pages.map(page => page.id), ['page-1', 'page-editor', 'page-owner', 'page-2'])
    assert.equal(staleDuplicate.payload.document.pages[1].presenterNotes, 'Original notes')

    const reorder = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: op('page-reorder', 3, 'page-1', 'design.pages.reorder', { pageIds: ['page-2', 'page-1', 'page-owner', 'page-editor'] }) })
    assert.equal(reorder.status, 200)
    const staleReorder = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: op('page-reorder-stale', 3, 'page-1', 'design.pages.reorder', { pageIds: ['page-1', 'page-editor', 'page-owner', 'page-2'] }) })
    assert.equal(staleReorder.status, 409)
    assert.deepEqual(staleReorder.payload.conflicts, ['pages.order'])

    const pagePatch = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: op('page-2-patch', 4, 'page-2', 'design.element.patch', { elementId: 'shape-2', patch: { x: 80 } }) })
    assert.equal(pagePatch.status, 200)
    const staleSourceDuplicate = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: op('page-duplicate-stale-source', 4, 'page-2', 'design.page.insert', {
      page: { id: 'stale-copy', name: 'Stale copy', background: '#000', elements: [shape('stale-copy-shape')] }, afterPageId: 'page-2', sourcePageId: 'page-2',
    }) })
    assert.equal(staleSourceDuplicate.status, 409)
    assert.deepEqual(staleSourceDuplicate.payload.conflicts, ['pages[page-2]'])
    const staleDelete = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: op('page-delete-stale', 4, 'page-1', 'design.page.delete', { targetPageId: 'page-2' }) })
    assert.equal(staleDelete.status, 409)
    assert.deepEqual(staleDelete.payload.conflicts, ['pages[page-2]'])
    const deletePage = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: op('page-delete', 5, 'page-1', 'design.page.delete', { targetPageId: 'page-2' }) })
    assert.equal(deletePage.status, 200)
    assert.deepEqual(deletePage.payload.document.pages.map(page => page.id), ['page-1', 'page-owner', 'page-editor'])
  } finally { await api.close() }
})

test('presenter note operations combine disjoint stale edits and reject overlapping edits', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Presenter owner', 'presenter-owner@example.test')
    const editor = await registerAndLogin(api, 'Presenter editor', 'presenter-editor@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Presenter notes', data: { type: 'presentation', width: 1920, height: 1080, pages: [{ id: 'slide-1', name: 'Slide 1', background: '#fff', elements: [], presenterNotes: 'Start middle finish' }] },
    } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const op = (operationId, baseRevision, notes) => ({ operationId, baseRevision, pageId: 'slide-1', type: 'design.page.notes.set', notes })
    const ownerEnd = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: op('notes-owner-end', 1, 'Start middle finish for audience') })
    assert.equal(ownerEnd.status, 200)
    const editorStart = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: op('notes-editor-start', 1, 'For audience: Start middle finish') })
    assert.equal(editorStart.status, 200)
    assert.equal(editorStart.payload.document.pages[0].presenterNotes, 'For audience: Start middle finish for audience')

    const ownerOverlap = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: op('notes-owner-overlap', 3, 'For audience: Start center finish for audience') })
    assert.equal(ownerOverlap.status, 200)
    const editorOverlap = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: op('notes-editor-overlap', 3, 'For audience: Start across finish for audience') })
    assert.equal(editorOverlap.status, 409)
    assert.deepEqual(editorOverlap.payload.conflicts, ['pages[slide-1].presenterNotes'])
  } finally { await api.close() }
})

test('page name and background patches combine independent fields and conflict on the same field', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Page fields owner', 'page-fields-owner@example.test')
    const editor = await registerAndLogin(api, 'Page fields editor', 'page-fields-editor@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Page fields', data: { type: 'presentation', width: 1920, height: 1080, pages: [{ id: 'slide-1', name: 'Slide 1', background: '#ffffff', elements: [] }] },
    } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const op = (operationId, baseRevision, patch) => ({ operationId, baseRevision, pageId: 'slide-1', type: 'design.page.patch', patch })
    const rename = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: op('page-fields-name', 1, { name: 'Opening' }) })
    assert.equal(rename.status, 200)
    const recolor = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: op('page-fields-background', 1, { background: '#223344' }) })
    assert.equal(recolor.status, 200)
    const hidePage = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: op('page-fields-hidden', 1, { hidden: true }) })
    assert.equal(hidePage.status, 200)
    assert.deepEqual({ name: hidePage.payload.document.pages[0].name, background: hidePage.payload.document.pages[0].background, hidden: hidePage.payload.document.pages[0].hidden }, { name: 'Opening', background: '#223344', hidden: true })
    const invalidVisibility = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: op('page-fields-invalid-hidden', 4, { hidden: 'yes' }) })
    assert.equal(invalidVisibility.status, 400)
    const ownerRename = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: op('page-fields-name-owner', 4, { name: 'Title by owner' }) })
    assert.equal(ownerRename.status, 200)
    const nameConflict = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: op('page-fields-name-editor', 4, { name: 'Title by editor' }) })
    assert.equal(nameConflict.status, 409)
    assert.deepEqual(nameConflict.payload.conflicts, ['pages[slide-1].name'])
  } finally { await api.close() }
})

test('Site section visibility collaborates over SSE, preserves content, and rejects conflicting concurrent toggles', async () => {
  const api = await startApi()
  let ownerStream
  let editorStream
  let ownerReader
  let editorReader
  try {
    const owner = await registerAndLogin(api, 'Site owner', 'site-visibility-owner@example.test')
    const editor = await registerAndLogin(api, 'Site editor', 'site-visibility-editor@example.test')
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Shared Site', data: { type: 'site', width: 1440, height: 900, pages: [
        { id: 'site-home', name: 'In??cio', background: '#ffffff', elements: [{ id: 'home-title', type: 'text', text: 'Home continua edit??vel' }] },
        { id: 'site-contact', name: 'Contato', background: '#f5f5f5', elements: [{ id: 'contact-title', type: 'text', text: 'Contato continua edit??vel' }] },
      ] },
    } })
    const id = created.payload.id
    assert.equal(created.status, 201)
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })

    ownerStream = await fetch(`${api.base}/api/documents/${id}/events`, { headers: { cookie: owner.cookie } })
    editorStream = await fetch(`${api.base}/api/documents/${id}/events`, { headers: { cookie: editor.cookie } })
    ownerReader = ownerStream.body.getReader()
    editorReader = editorStream.body.getReader()
    const ownerState = { buffer: '' }
    const editorState = { buffer: '' }
    await readSseEvent(ownerReader, ownerState, 'ready')
    await readSseEvent(editorReader, editorState, 'ready')
    await readSseEvent(ownerReader, ownerState, 'presence.updated')
    await readSseEvent(editorReader, editorState, 'presence.updated')

    const patch = (operationId, baseRevision, hidden) => ({ operationId, baseRevision, pageId: 'site-home', type: 'design.page.patch', patch: { hidden } })
    const hide = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: patch('site-hide-owner', 1, true) })
    assert.equal(hide.status, 200)
    assert.equal(hide.payload.document.pages[0].hidden, true)
    await readSseEvent(editorReader, editorState, 'document.updated', event => event.revision === 2)
    const hideOperation = await readSseEvent(editorReader, editorState, 'document.operation.updated', event => event.operationId === 'site-hide-owner')
    assert.equal(hideOperation.operation, 'design.page.patch')

    const conflictingShow = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: patch('site-show-editor-stale', 1, false) })
    assert.equal(conflictingShow.status, 409)
    assert.deepEqual(conflictingShow.payload.conflicts, ['pages[site-home].hidden'])

    const show = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: patch('site-show-editor-current', 2, false) })
    assert.equal(show.status, 200)
    assert.equal(show.payload.document.pages[0].hidden, false)
    await readSseEvent(ownerReader, ownerState, 'document.updated', event => event.revision === 3)
    const showOperation = await readSseEvent(ownerReader, ownerState, 'document.operation.updated', event => event.operationId === 'site-show-editor-current')
    assert.equal(showOperation.userId, editor.user.id)

    const reopened = await api.request(`/api/documents/${id}`, { cookie: owner.cookie })
    assert.equal(reopened.payload.data.pages[0].elements[0].text, 'Home continua edit??vel')
    assert.equal(reopened.payload.data.pages[1].elements[0].text, 'Contato continua edit??vel')
    assert.equal(reopened.payload.data.pages[0].hidden, false)
  } finally {
    await ownerReader?.cancel().catch(() => {})
    await editorReader?.cancel().catch(() => {})
    await api.close()
  }
})

test('whiteboard connector operations preserve anchors across safe concurrent moves and reject missing endpoints', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Connector owner', 'connector-owner@example.test')
    const editor = await registerAndLogin(api, 'Connector editor', 'connector-editor@example.test')
    const shape = (id, x) => ({ id, type: 'shape', name: id, shape: 'rect', x, y: 100, width: 100, height: 80, rotation: 0, fill: '#7464e8', cornerRadius: 8 })
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Connectors', data: { type: 'whiteboard', width: 1600, height: 1000, pages: [{ id: 'page-1', elements: [shape('shape-1', 100), shape('shape-2', 400)], connectors: [] }] },
    } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    const move = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'connector-endpoint-move', baseRevision: 1, pageId: 'page-1', type: 'design.element.patch', elementId: 'shape-1', patch: { x: 150 },
    } })
    assert.equal(move.status, 200)
    const connector = { id: 'connector-1', fromId: 'shape-1', toId: 'shape-2', fromAnchor: { x: 1, y: 0.4 }, toAnchor: { x: 0, y: 0.6 }, color: '#7464e8', strokeWidth: 4 }
    const addConnector = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'connector-create-stale', baseRevision: 1, pageId: 'page-1', type: 'design.connector.create', connector,
    } })
    assert.equal(addConnector.status, 200)
    assert.deepEqual(addConnector.payload.document.pages[0].connectors, [connector])
    assert.equal(addConnector.payload.document.pages[0].elements[0].x, 150)
    const deleteEndpoint = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'connector-delete-endpoint', baseRevision: 3, pageId: 'page-1', type: 'design.elements.delete', elementIds: ['shape-2'],
    } })
    assert.equal(deleteEndpoint.status, 200)
    assert.deepEqual(deleteEndpoint.payload.document.pages[0].connectors, [])
    const staleConnector = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'connector-create-missing-endpoint', baseRevision: 3, pageId: 'page-1', type: 'design.connector.create', connector: { ...connector, id: 'connector-2' },
    } })
    assert.equal(staleConnector.status, 409)
  } finally { await api.close() }
})

test('whiteboard connector patches round-trip, merge independent endpoint fields, and reject overlapping edits or unauthorized writes', async () => {
  const api = await startApi()
  try {
    const owner = await registerAndLogin(api, 'Connector patch owner', 'connector-patch-owner@example.test')
    const editor = await registerAndLogin(api, 'Connector patch editor', 'connector-patch-editor@example.test')
    const viewer = await registerAndLogin(api, 'Connector patch viewer', 'connector-patch-viewer@example.test')
    const shape = id => ({ id, type: 'shape', name: id, shape: 'rect', x: 100, y: 100, width: 100, height: 80, rotation: 0, fill: '#7464e8', cornerRadius: 8 })
    const connector = { id: 'connector-1', fromId: 'shape-1', toId: 'shape-2', fromAnchor: { x: 1, y: 0.5 }, toAnchor: { x: 0, y: 0.5 }, color: '#7464e8', strokeWidth: 4 }
    const created = await api.request('/api/documents', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Connector patch round trip', data: { type: 'whiteboard', width: 1600, height: 1000, pages: [{ id: 'page-1', elements: [shape('shape-1'), shape('shape-2'), shape('shape-3')], connectors: [connector] }] },
    } })
    const id = created.payload.id
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' } })
    await api.request(`/api/documents/${id}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: viewer.user.email, role: 'viewer' } })

    const moveTarget = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'connector-patch-independent-element-move', baseRevision: 1, pageId: 'page-1', type: 'design.element.patch', elementId: 'shape-1', patch: { x: 240 },
    } })
    assert.equal(moveTarget.status, 200)
    const anchorPatch = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'connector-patch-anchor', baseRevision: 1, pageId: 'page-1', type: 'design.connector.patch', connectorId: 'connector-1', patch: { fromAnchor: { x: 1, y: 0.25 } },
    } })
    assert.equal(anchorPatch.status, 200)
    assert.deepEqual(anchorPatch.payload.document.pages[0].connectors[0].fromAnchor, { x: 1, y: 0.25 })
    assert.equal(anchorPatch.payload.document.pages[0].elements[0].x, 240, 'the stale connector patch rebases over an independent endpoint element move')

    const independentAnchorPatch = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: owner.cookie, body: {
      operationId: 'connector-patch-other-anchor', baseRevision: 2, pageId: 'page-1', type: 'design.connector.patch', connectorId: 'connector-1', patch: { toAnchor: { x: 0, y: 0.75 }, color: '#333333' },
    } })
    assert.equal(independentAnchorPatch.status, 200)
    const staleOverlap = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'connector-patch-overlap', baseRevision: 2, pageId: 'page-1', type: 'design.connector.patch', connectorId: 'connector-1', patch: { toAnchor: { x: 0, y: 0.25 } },
    } })
    assert.equal(staleOverlap.status, 409)
    assert.deepEqual(staleOverlap.payload.conflicts, ['pages[page-1].connectors[connector-1].toAnchor'])

    const clearAnchor = await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'connector-patch-clear-anchor', baseRevision: 3, pageId: 'page-1', type: 'design.connector.patch', connectorId: 'connector-1', patch: { fromAnchor: null },
    } })
    assert.equal(clearAnchor.status, 200)
    assert.equal(Object.hasOwn(clearAnchor.payload.document.pages[0].connectors[0], 'fromAnchor'), false)
    assert.equal((await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: viewer.cookie, body: {
      operationId: 'connector-patch-viewer-denied', baseRevision: 4, pageId: 'page-1', type: 'design.connector.patch', connectorId: 'connector-1', patch: { color: '#000000' },
    } })).status, 403)
    assert.equal((await api.request(`/api/documents/${id}/operations`, { method: 'POST', cookie: editor.cookie, body: {
      operationId: 'connector-patch-invalid-anchor', baseRevision: 4, pageId: 'page-1', type: 'design.connector.patch', connectorId: 'connector-1', patch: { toAnchor: { x: 1.2, y: 0.5 } },
    } })).status, 400)
    const reopened = await api.request(`/api/documents/${id}`, { cookie: owner.cookie })
    assert.equal(reopened.status, 200)
    assert.equal(reopened.payload.revision, 5)
    assert.equal(reopened.payload.data.pages[0].connectors[0].color, '#333333')
    assert.deepEqual(reopened.payload.data.pages[0].connectors[0].toAnchor, { x: 0, y: 0.75 })
    assert.equal(Object.hasOwn(reopened.payload.data.pages[0].connectors[0], 'fromAnchor'), false)
  } finally { await api.close() }
})

test('authorized document sessions receive revisions and access revocation over SSE', async () => {
  const api = await startApi()
  let stream
  let ownerStream
  try {
    const owner = await registerAndLogin(api, 'Owner', 'sse-owner@example.test')
    const editor = await registerAndLogin(api, 'Editor', 'sse-editor@example.test')
    const created = await api.request('/api/documents', {
      method: 'POST', cookie: owner.cookie,
      body: { name: 'Documento em tempo real', data: { type: 'doc', width: 794, pages: [{ id: 'page-1', elements: [{ id: 'shape-1' }], blocks: [{ id: 'block-1', type: 'heading', text: 'Relat??rio' }, { id: 'table-1', type: 'table', cells: [['A', 'B']] }] }] } },
    })
    const id = created.payload.id
    assert.equal(created.payload.data.type, 'doc')
    assert.equal(created.payload.data.pages[0].blocks[0].text, 'Relat??rio')
    assert.equal((await api.request(`/api/documents/${id}/events`)).status, 401)
    await api.request(`/api/documents/${id}/permissions`, {
      method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'editor' },
    })

    stream = await fetch(`${api.base}/api/documents/${id}/events`, { headers: { cookie: editor.cookie } })
    assert.equal(stream.status, 200)
    assert.match(stream.headers.get('content-type'), /text\/event-stream/)
    const reader = stream.body.getReader()
    const state = { buffer: '' }
    const ready = await readSseEvent(reader, state, 'ready')
    assert.equal(ready.revision, 1)
    const editorPresence = await readSseEvent(reader, state, 'presence.updated')
    assert.deepEqual(editorPresence.users.map(user => user.id), [editor.user.id])

    ownerStream = await fetch(`${api.base}/api/documents/${id}/events`, { headers: { cookie: owner.cookie } })
    const presenceOwnerReader = ownerStream.body.getReader()
    const presenceOwnerState = { buffer: '' }
    await readSseEvent(presenceOwnerReader, presenceOwnerState, 'ready')
    const ownerPresence = await readSseEvent(presenceOwnerReader, presenceOwnerState, 'presence.updated')
    assert.deepEqual(ownerPresence.users.map(user => user.id).sort(), [editor.user.id, owner.user.id].sort())
    assert.deepEqual(ownerPresence.users.map(user => user.connections), [1, 1])
    await api.request(`/api/documents/${id}/cursor`, { method: 'POST', cookie: editor.cookie, body: { cursor: { pageId: 'page-1', x: 0.25, y: 0.75 } } })
    const cursorEvent = await readSseEvent(presenceOwnerReader, presenceOwnerState, 'cursor.updated')
    assert.deepEqual(cursorEvent, { type: 'cursor.updated', userId: editor.user.id, cursor: { pageId: 'page-1', x: 0.25, y: 0.75 }, name: 'Editor' })
    assert.equal((await api.request(`/api/documents/${id}/cursor`, { method: 'POST', cookie: editor.cookie, body: { cursor: { pageId: 'page-1', x: 2, y: 0.75 } } })).status, 400)
    await api.request(`/api/documents/${id}/cursor`, { method: 'POST', cookie: editor.cookie, body: { cursor: null } })
    assert.equal((await readSseEvent(presenceOwnerReader, presenceOwnerState, 'cursor.updated')).cursor, null)
    await api.request(`/api/documents/${id}/selection`, { method: 'POST', cookie: editor.cookie, body: { selection: { pageId: 'page-1', elementId: 'shape-1' } } })
    assert.deepEqual(await readSseEvent(presenceOwnerReader, presenceOwnerState, 'selection.updated'), { type: 'selection.updated', userId: editor.user.id, selection: { pageId: 'page-1', elementId: 'shape-1', kind: 'element' }, name: 'Editor' })
    assert.equal((await api.request(`/api/documents/${id}/selection`, { method: 'POST', cookie: editor.cookie, body: { selection: { pageId: 'page-1', elementId: 'missing' } } })).status, 404)
    await api.request(`/api/documents/${id}/selection`, { method: 'POST', cookie: editor.cookie, body: { selection: null } })
    assert.equal((await readSseEvent(presenceOwnerReader, presenceOwnerState, 'selection.updated')).selection, null)
    await api.request(`/api/documents/${id}/selection`, { method: 'POST', cookie: editor.cookie, body: { selection: { pageId: 'page-1', elementId: 'block-1', kind: 'doc-block' } } })
    assert.equal((await readSseEvent(presenceOwnerReader, presenceOwnerState, 'selection.updated')).selection.kind, 'doc-block')
    await api.request(`/api/documents/${id}/selection`, { method: 'POST', cookie: editor.cookie, body: { selection: { pageId: 'page-1', elementId: 'table-1', kind: 'table-cell', row: 0, column: 1 } } })
    assert.deepEqual((await readSseEvent(presenceOwnerReader, presenceOwnerState, 'selection.updated')).selection, { pageId: 'page-1', elementId: 'table-1', kind: 'table-cell', row: 0, column: 1 })
    assert.equal((await api.request(`/api/documents/${id}/selection`, { method: 'POST', cookie: editor.cookie, body: { selection: { pageId: 'page-1', elementId: 'table-1', kind: 'table-cell', row: 0, column: 2 } } })).status, 404)
    await presenceOwnerReader.cancel()
    const afterOwnerLeaves = await readSseEvent(reader, state, 'presence.updated', event => event.users.length === 1)
    assert.deepEqual(afterOwnerLeaves.users.map(user => user.id), [editor.user.id])

    await api.request(`/api/documents/${id}`, {
      method: 'PUT', cookie: owner.cookie,
      body: { revision: 1, name: 'Nova revis??o', data: { width: 794, version: 2 } },
    })
    const updated = await readSseEvent(reader, state, 'document.updated')
    assert.equal(updated.revision, 2)

    await api.request(`/api/documents/${id}/permissions`, {
      method: 'POST', cookie: owner.cookie, body: { email: editor.user.email, role: 'commenter' },
    })
    const roleChanged = await readSseEvent(reader, state, 'access.changed')
    assert.equal(roleChanged.role, 'commenter')
    const liveComment = await api.request(`/api/documents/${id}/comments`, {
      method: 'POST', cookie: editor.cookie, body: { pageId: 'page-1', content: 'Coment??rio em tempo real' },
    })
    await readSseEvent(reader, state, 'comments.updated')
    const liveReply = await api.request(`/api/documents/${id}/comments`, {
      method: 'POST', cookie: owner.cookie, body: { parentId: liveComment.payload.comment.id, content: 'Resposta em tempo real' },
    })
    assert.equal(liveReply.payload.comment.parentId, liveComment.payload.comment.id)
    await readSseEvent(reader, state, 'comments.updated')
    const resolveLive = await api.request(`/api/documents/${id}/comments/${liveComment.payload.comment.id}`, {
      method: 'PATCH', cookie: editor.cookie, body: { resolved: true },
    })
    assert.equal(resolveLive.status, 200)
    await readSseEvent(reader, state, 'comments.updated')

    await api.request(`/api/documents/${id}/permissions/${editor.user.id}`, { method: 'DELETE', cookie: owner.cookie })
    await readSseEvent(reader, state, 'access.revoked')
    await reader.cancel()

    ownerStream = await fetch(`${api.base}/api/documents/${id}/events`, { headers: { cookie: owner.cookie } })
    const ownerLogoutReader = ownerStream.body.getReader()
    const ownerLogoutState = { buffer: '' }
    await readSseEvent(ownerLogoutReader, ownerLogoutState, 'ready')
    await api.request('/api/auth/logout', { method: 'POST', cookie: owner.cookie })
    await readSseEvent(ownerLogoutReader, ownerLogoutState, 'auth.expired')
    await ownerLogoutReader.cancel()
  } finally {
    if (stream?.body && !stream.body.locked) await stream.body.cancel().catch(() => {})
    if (ownerStream?.body && !ownerStream.body.locked) await ownerStream.body.cancel().catch(() => {})
    await api.close()
  }
})
