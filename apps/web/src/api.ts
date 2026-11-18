import type { DesignDocument, DesignElement, DesignPage, MediaAsset, ProjectFolder, SheetChart, VideoTimelineClip, WhiteboardConnector, WhiteboardGroup } from './model'
import { createPageEventStream, type PageEventStream } from './sse-lifecycle.mjs'

export type StudioUser = { id: string; name: string; email: string }
export type AccessRole = 'owner' | 'editor' | 'commenter' | 'viewer'
export type RemoteDocument = {
  id: string
  name: string
  data: DesignDocument
  revision: number
  role: AccessRole
  accessSuspended: boolean
  ownerId: string
  teamId?: string | null
  createdAt: string
  updatedAt: string
}
export type RemoteDocumentVersion = { revision: number; name: string; createdAt: string; createdBy: string; createdByName: string | null }
export type RemotePermission = StudioUser & { role: Exclude<AccessRole, 'owner'>; createdAt: string }
export type RemoteTeam = { id: string; name: string; role: 'admin' | 'member'; memberCount: number; createdAt: string }
export type RemoteProjectFolder = ProjectFolder & { teamId: string | null }
export type RemoteTeamMember = StudioUser & { role: 'admin' | 'member'; joinedAt: string; brandDesigner?: boolean }
export type RemoteTeamGroup = { id: string; name: string; createdAt: string; updatedAt: string; members: RemoteTeamMember[] }
export type PrintCheckoutOptions = { format: 'vertical-standard' | 'horizontal-standard' | 'vertical-slim' | 'horizontal-slim'; paper: 'standard' | 'premium'; finish: 'matte' | 'gloss'; quantity: number }
export type ExternalProviderStatus = {
  sitePublication: { configured: boolean; missing: string[] }
  printCheckout: { configured: boolean; missing: string[] }
}
export type RemotePrintCheckout = { checkoutUrl: string; sessionId: string }
export type RemoteSitePublication = { slug: string; url: string; deploymentId: string; publishedAt: string; publishedRevision: number }
export type RemoteSitePublicationState = { publication: RemoteSitePublication | null; currentRevision: number; isOutdated: boolean }
export type RemoteTeamInvitation = { id: string; email: string; role: 'admin' | 'member'; createdAt: string; expiresAt: string; acceptedAt: string | null; revokedAt: string | null; expired: boolean }
export type RemoteAuditEvent = { id: string; actorId: string | null; actorName: string; action: string; targetType: string; targetId: string | null; details: Record<string, unknown>; createdAt: string; documentId: string | null }
export type ReceivedTeamInvitation = { id: string; teamId: string; teamName: string; inviterName: string; email: string; role: 'admin' | 'member'; expiresAt: string }
export type RemoteInvitation = { id: string; email: string; role: Exclude<AccessRole, 'owner'>; createdAt: string; expiresAt: string; acceptedAt: string | null; revokedAt: string | null; expired: boolean }
export type InvitationDelivery = { status: 'sent' | 'link-only' | 'failed'; reason?: string }
export type CreatedRemoteInvitation = Pick<RemoteInvitation, 'id' | 'email' | 'role' | 'createdAt' | 'expiresAt'> & { token: string; delivery: InvitationDelivery }
export type ReceivedRemoteInvitation = Pick<RemoteInvitation, 'id' | 'email' | 'role' | 'createdAt' | 'expiresAt'> & { documentName: string; ownerName: string }
export type RemoteComment = { id: string; parentId: string | null; pageId: string | null; elementId: string | null; content: string; createdAt: string; authorId: string; authorName: string; resolvedAt: string | null; resolvedBy: string | null }
export type RemoteCollaborator = { id: string; name: string; role: AccessRole; email?: string }
export type RemoteNotification = { id: string; documentId: string; documentName: string; commentId: string; commentContent: string; actorId: string; actorName: string; createdAt: string; readAt: string | null }
export type RemoteNotificationEvent = { type: 'notification.created'; notificationId: string } | { type: 'ready' | 'auth.expired' }
export type SheetOperation =
  | { type: 'sheet.cells.set'; cells: Array<{ row: number; column: number; value: string }> }
  | { type: 'sheet.formats.set'; formats: Array<{ row: number; column: number; value: 'default' | 'currency' | 'percentage' | 'date' | 'time' | 'datetime' }> }
  | { type: 'sheet.merge.set'; merge: { row: number; column: number; colSpan: number; rowSpan?: number } }
  | { type: 'sheet.merge.remove'; row: number; column: number }
  | { type: 'sheet.rows.append' }
  | { type: 'sheet.columns.append' }
  | { type: 'sheet.chart.set'; chart: SheetChart | null; chartId: string }
export type DocTableCellOperation = { type: 'doc.table.cell.set'; blockId: string; row: number; column: number; value: string }
export type DocTableStructureOperation =
  | { type: 'doc.table.structure'; blockId: string; action: 'row.append' | 'column.append' }
  | { type: 'doc.table.structure'; blockId: string; action: 'row.move'; from: number; to: number }
  | { type: 'doc.table.structure'; blockId: string; action: 'row.delete'; row: number }
  | { type: 'doc.table.structure'; blockId: string; action: 'column.delete'; column: number }
  | { type: 'doc.table.structure'; blockId: string; action: 'unmerge'; row: number; column: number }
  | { type: 'doc.table.structure'; blockId: string; action: 'merge'; row: number; column: number; colSpan: number }
export type DocBlockTextOperation = { type: 'doc.block.text.set'; blockId: string; text: string; marks: Array<{ start: number; end: number; bold?: boolean; italic?: boolean }> }
export type DocBlockStructureOperation =
  | DocTableStructureOperation
  | { type: 'doc.block.insert'; block: import('./model').DocBlock; afterBlockId: string | null }
  | { type: 'doc.blocks.insert'; blocks: import('./model').DocBlock[]; afterBlockId: string | null; replaceEmptyBlockId?: string }
  | { type: 'doc.block.delete'; blockId: string }
  | { type: 'doc.block.type.set'; blockId: string; blockType: Exclude<import('./model').DocBlock['type'], 'table'> }
  | { type: 'doc.blocks.reorder'; blockIds: string[] }
  | { type: 'doc.replace.apply'; blocks: Array<{ blockId: string; text: string; marks: Array<{ start: number; end: number; bold?: boolean; italic?: boolean }> }>; cells: Array<{ blockId: string; row: number; column: number; value: string }> }
export type DesignElementPatchOperation = { type: 'design.element.patch'; elementId: string; patch: Partial<DesignElement> }
export type DesignElementsCreateOperation = { type: 'design.elements.create'; elements: DesignElement[]; groups?: WhiteboardGroup[]; connectors?: NonNullable<DesignDocument['pages'][number]['connectors']> }
export type DesignElementsDeleteOperation = { type: 'design.elements.delete'; elementIds: string[] }
export type DesignGroupsSetOperation = { type: 'design.groups.set'; groups: WhiteboardGroup[] }
export type DesignElementsReorderOperation = { type: 'design.elements.reorder'; elementIds: string[] }
export type DesignPageInsertOperation = { type: 'design.page.insert'; page: DesignPage; afterPageId: string; sourcePageId?: string }
export type DesignPageDeleteOperation = { type: 'design.page.delete'; targetPageId: string }
export type DesignPagesReorderOperation = { type: 'design.pages.reorder'; pageIds: string[] }
export type DesignPageNotesSetOperation = { type: 'design.page.notes.set'; notes: string }
export type DesignPagePatchOperation = { type: 'design.page.patch'; patch: Partial<Pick<DesignPage, 'name' | 'background' | 'hidden'>> }
export type DesignConnectorCreateOperation = { type: 'design.connector.create'; connector: WhiteboardConnector }
export type DesignConnectorPatchOperation = { type: 'design.connector.patch'; connectorId: string; patch: Partial<Pick<WhiteboardConnector, 'fromId' | 'toId' | 'fromAnchor' | 'toAnchor' | 'color' | 'strokeWidth'>> & { fromAnchor?: WhiteboardConnector['fromAnchor'] | null; toAnchor?: WhiteboardConnector['toAnchor'] | null } }
export type VideoTimelineClipPatch = Partial<Pick<VideoTimelineClip, 'startMs' | 'durationMs' | 'sourceStartMs' | 'volume' | 'fadeInMs' | 'fadeOutMs' | 'trackIndex' | 'opacity' | 'fitMode' | 'scale' | 'offsetX' | 'offsetY' | 'opacityKeyframes' | 'transformKeyframes' | 'animationEasing'>>
export type VideoTimelineClipOperation =
  | { type: 'design.video.clip.create'; clip: VideoTimelineClip }
  | { type: 'design.video.clip.patch'; clipId: string; patch: VideoTimelineClipPatch }
  | { type: 'design.video.clip.delete'; clipId: string }
export type CollaborativeOperation = SheetOperation | DocTableCellOperation | DocTableStructureOperation | DocBlockTextOperation | DocBlockStructureOperation | DesignElementPatchOperation | DesignElementsCreateOperation | DesignElementsDeleteOperation | DesignGroupsSetOperation | DesignElementsReorderOperation | DesignPageInsertOperation | DesignPageDeleteOperation | DesignPagesReorderOperation | DesignPageNotesSetOperation | DesignPagePatchOperation | DesignConnectorCreateOperation | DesignConnectorPatchOperation | VideoTimelineClipOperation
export type RemoteSelection = { pageId: string; elementId: string; kind?: 'element' | 'doc-block' | 'table-cell'; row?: number; column?: number }
export type RemotePresence = { id: string; name: string; connections: number; cursor?: { pageId: string; x: number; y: number } | null; selection?: RemoteSelection | null }
export type RemotePresentation = { userId: string; name: string; pageIndex: number; presenting: true }

export class StudioApiError extends Error {
  readonly status: number
  readonly payload: Record<string, unknown>

  constructor(status: number, message: string, payload: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.payload = payload
    this.name = 'StudioApiError'
  }
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new StudioApiError(response.status, typeof payload.error === 'string' ? payload.error : 'Falha ao falar com o serviço.', payload)
  return payload as T
}

export async function getExternalProviderStatus(): Promise<ExternalProviderStatus> {
  return request('/api/providers/status')
}

export async function publishRemoteSite(documentId: string, slug: string): Promise<RemoteSitePublication> {
  const result = await request<{ publication: RemoteSitePublication }>(`/api/sites/${encodeURIComponent(documentId)}/publish`, 'POST', { slug })
  return result.publication
}

export async function createRemotePrintCheckout(documentId: string, options: PrintCheckoutOptions): Promise<RemotePrintCheckout> {
  return (await request<{ checkout: RemotePrintCheckout }>('/api/print/checkout', 'POST', { documentId, options })).checkout
}

export async function getRemoteSitePublication(documentId: string): Promise<RemoteSitePublicationState> {
  return request(`/api/sites/${encodeURIComponent(documentId)}/publication`)
}

export async function getSession(): Promise<StudioUser> {
  const result = await request<{ user: StudioUser }>('/api/auth/me')
  return result.user
}

export async function signIn(email: string, password: string): Promise<StudioUser> {
  const result = await request<{ user: StudioUser }>('/api/auth/login', 'POST', { email, password })
  return result.user
}

export async function signUp(name: string, email: string, password: string): Promise<StudioUser> {
  await request<{ user: StudioUser }>('/api/auth/register', 'POST', { name, email, password })
  return signIn(email, password)
}

export async function requestPasswordReset(email: string): Promise<void> {
  await request<{ message: string }>('/api/auth/password-reset/request', 'POST', { email })
}

export async function completePasswordReset(token: string, password: string): Promise<void> {
  await request<{ ok: boolean }>('/api/auth/password-reset/complete', 'POST', { token, password })
}

export async function signOut(): Promise<void> {
  await request<{ ok: boolean }>('/api/auth/logout', 'POST', {})
}

export async function listRemoteDocuments(): Promise<RemoteDocument[]> {
  const result = await request<{ documents: RemoteDocument[] }>('/api/documents')
  return result.documents
}

export async function createRemoteDocument(document: DesignDocument, teamId?: string): Promise<RemoteDocument> {
  return request<RemoteDocument>('/api/documents', 'POST', { name: document.name, data: document, ...(teamId ? { teamId } : {}) })
}

export async function listRemoteProjectFolders(teamId?: string): Promise<RemoteProjectFolder[]> {
  const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''
  return (await request<{ folders: RemoteProjectFolder[] }>(`/api/project-folders${query}`)).folders
}

export async function createRemoteProjectFolder(name: string, teamId?: string): Promise<RemoteProjectFolder> {
  return (await request<{ folder: RemoteProjectFolder }>('/api/project-folders', 'POST', { name, ...(teamId ? { teamId } : {}) })).folder
}

export async function updateRemoteProjectFolder(id: string, patch: { name?: string; favorite?: boolean }): Promise<RemoteProjectFolder> {
  return (await request<{ folder: RemoteProjectFolder }>(`/api/project-folders/${encodeURIComponent(id)}`, 'PATCH', patch)).folder
}

export async function deleteRemoteProjectFolder(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/project-folders/${encodeURIComponent(id)}`, 'DELETE')
}

export async function moveRemoteDocumentToFolder(document: RemoteDocument, folderId: string | null): Promise<RemoteDocument> {
  return request<RemoteDocument>(`/api/documents/${encodeURIComponent(document.id)}/folder`, 'PATCH', { folderId, revision: document.revision })
}

export async function createRemoteTeam(name: string): Promise<RemoteTeam> {
  return (await request<{ team: RemoteTeam }>('/api/teams', 'POST', { name })).team
}

export async function updateRemoteTeam(teamId: string, name: string): Promise<RemoteTeam> {
  return (await request<{ team: RemoteTeam }>(`/api/teams/${encodeURIComponent(teamId)}`, 'PATCH', { name })).team
}

export async function listRemoteTeams(): Promise<RemoteTeam[]> {
  return (await request<{ teams: RemoteTeam[] }>('/api/teams')).teams
}

export async function getRemoteTeam(id: string): Promise<{ team: RemoteTeam; members: RemoteTeamMember[] }> {
  return request(`/api/teams/${encodeURIComponent(id)}`)
}

export async function listRemoteTeamGroups(teamId: string): Promise<RemoteTeamGroup[]> {
  return (await request<{ groups: RemoteTeamGroup[] }>(`/api/teams/${encodeURIComponent(teamId)}/groups`)).groups
}

export async function createRemoteTeamGroup(teamId: string, name: string): Promise<RemoteTeamGroup> {
  return (await request<{ group: RemoteTeamGroup }>(`/api/teams/${encodeURIComponent(teamId)}/groups`, 'POST', { name })).group
}

export async function updateRemoteTeamGroup(teamId: string, groupId: string, name: string): Promise<RemoteTeamGroup> {
  return (await request<{ group: RemoteTeamGroup }>(`/api/teams/${encodeURIComponent(teamId)}/groups/${encodeURIComponent(groupId)}`, 'PATCH', { name })).group
}

export async function deleteRemoteTeamGroup(teamId: string, groupId: string): Promise<void> {
  await request(`/api/teams/${encodeURIComponent(teamId)}/groups/${encodeURIComponent(groupId)}`, 'DELETE')
}

export async function setRemoteTeamGroupMembers(teamId: string, groupId: string, userIds: string[]): Promise<RemoteTeamGroup> {
  return (await request<{ group: RemoteTeamGroup }>(`/api/teams/${encodeURIComponent(teamId)}/groups/${encodeURIComponent(groupId)}/members`, 'PUT', { userIds })).group
}

export async function getRemoteTeamPolicies(teamId: string): Promise<Record<string, string>> {
  return (await request<{ policies: Record<string, string> }>(`/api/teams/${encodeURIComponent(teamId)}/policies`)).policies
}

export async function saveRemoteTeamPolicies(teamId: string, policies: Record<string, string>): Promise<Record<string, string>> {
  return (await request<{ policies: Record<string, string> }>(`/api/teams/${encodeURIComponent(teamId)}/policies`, 'PUT', { policies })).policies
}

export async function getRemoteTeamIntegrationIds(teamId: string): Promise<string[] | null> {
  const policies = await getRemoteTeamPolicies(teamId)
  if (policies.enabledIntegrations === undefined) return null
  try {
    const ids: unknown = JSON.parse(policies.enabledIntegrations)
    return Array.isArray(ids) && ids.every(id => typeof id === 'string') ? ids : null
  } catch {
    return null
  }
}

export async function saveRemoteTeamIntegrationIds(teamId: string, ids: string[]): Promise<string[]> {
  const policies = await saveRemoteTeamPolicies(teamId, { enabledIntegrations: JSON.stringify(ids) })
  try {
    const saved: unknown = JSON.parse(policies.enabledIntegrations ?? 'null')
    return Array.isArray(saved) && saved.every(id => typeof id === 'string') ? saved : ids
  } catch {
    return ids
  }
}

export async function setRemoteTeamMemberRole(teamId: string, userId: string, role: RemoteTeamMember['role']): Promise<void> {
  await request(`/api/teams/${encodeURIComponent(teamId)}/members`, 'PATCH', { userId, role })
}

export async function setRemoteTeamMemberBrandDesigner(teamId: string, userId: string, brandDesigner: boolean): Promise<void> {
  await request(`/api/teams/${encodeURIComponent(teamId)}/members`, 'PATCH', { userId, brandDesigner })
}

export async function removeRemoteTeamMember(teamId: string, userId: string): Promise<void> {
  const query = new URLSearchParams({ userId })
  await request(`/api/teams/${encodeURIComponent(teamId)}/members?${query.toString()}`, 'DELETE')
}

export async function listRemoteTeamInvitations(teamId: string): Promise<RemoteTeamInvitation[]> {
  return (await request<{ invitations: RemoteTeamInvitation[] }>(`/api/teams/${encodeURIComponent(teamId)}/invitations`)).invitations.map(invitation => ({
    ...invitation,
    expired: !invitation.acceptedAt && !invitation.revokedAt && Date.parse(invitation.expiresAt) <= Date.now(),
  }))
}

export async function revokeRemoteTeamInvitation(teamId: string, invitationId: string): Promise<void> {
  await request(`/api/teams/${encodeURIComponent(teamId)}/invitations/${encodeURIComponent(invitationId)}`, 'DELETE')
}

export async function listRemoteTeamMediaAssets(teamId: string): Promise<MediaAsset[]> {
  return (await request<{ assets: MediaAsset[] }>(`/api/teams/${encodeURIComponent(teamId)}/media`)).assets
}

export async function saveRemoteTeamMediaAsset(teamId: string, asset: MediaAsset): Promise<MediaAsset> {
  return (await request<{ asset: MediaAsset }>(`/api/teams/${encodeURIComponent(teamId)}/media`, 'POST', { asset })).asset
}

export async function deleteRemoteTeamMediaAsset(teamId: string, assetId: string): Promise<void> {
  await request(`/api/teams/${encodeURIComponent(teamId)}/media/${encodeURIComponent(assetId)}`, 'DELETE')
}

export async function getRemoteTeamAudit(id: string, limit = 50, before?: string): Promise<{ events: RemoteAuditEvent[]; nextBefore: string | null }> {
  const query = new URLSearchParams({ limit: String(limit) })
  if (before) query.set('before', before)
  return request(`/api/teams/${encodeURIComponent(id)}/audit?${query.toString()}`)
}

export async function createRemoteTeamInvitation(teamId: string, email: string, role: 'admin' | 'member' = 'member') {
  return (await request<{ invitation: { id: string; email: string; role: 'admin' | 'member'; token: string; createdAt: string; expiresAt: string; delivery: InvitationDelivery } }>(`/api/teams/${encodeURIComponent(teamId)}/invitations`, 'POST', { email, role })).invitation
}

export async function getRemoteTeamInvitation(token: string): Promise<ReceivedTeamInvitation> {
  return (await request<{ invitation: ReceivedTeamInvitation }>(`/api/team-invitations/${encodeURIComponent(token)}`)).invitation
}

export async function acceptRemoteTeamInvitation(token: string): Promise<{ teamId: string }> {
  return request(`/api/team-invitations/${encodeURIComponent(token)}`, 'POST', {})
}

export async function getRemoteDocument(id: string): Promise<RemoteDocument> {
  return request<RemoteDocument>(`/api/documents/${encodeURIComponent(id)}`)
}

export async function deleteRemoteDocument(id: string, revision: number): Promise<void> {
  await request<{ ok: boolean }>(`/api/documents/${encodeURIComponent(id)}`, 'DELETE', { revision })
}

export async function emptyRemoteTrash(documents: Array<{ id: string; revision: number }>): Promise<void> {
  await request<{ ok: boolean; deleted: number }>('/api/documents/trash', 'DELETE', { documents })
}

export async function listRemoteDocumentVersions(id: string): Promise<{ versions: RemoteDocumentVersion[]; currentRevision: number }> {
  return request(`/api/documents/${encodeURIComponent(id)}/versions`)
}

export async function restoreRemoteDocumentVersion(id: string, targetRevision: number, currentRevision: number): Promise<RemoteDocument> {
  const result = await request<{ document: RemoteDocument }>(`/api/documents/${encodeURIComponent(id)}/versions/${targetRevision}/restore`, 'POST', { revision: currentRevision })
  return result.document
}

export async function copyRemoteDocumentVersion(id: string, targetRevision: number): Promise<RemoteDocument> {
  return request<RemoteDocument>(`/api/documents/${encodeURIComponent(id)}/versions/${targetRevision}/copy`, 'POST', {})
}

function isTerminalStreamEvent(message: MessageEvent<string>, types: string[]): boolean {
  try { return types.includes(JSON.parse(message.data)?.type) } catch { return false }
}

export function subscribeRemoteDocument(id: string, onEvent: (event: MessageEvent<string>) => void, onOpen?: () => void, onError?: () => void): PageEventStream {
  return createPageEventStream(`/api/documents/${encodeURIComponent(id)}/events`, { onMessage: onEvent, onOpen, onError, isTerminal: event => isTerminalStreamEvent(event, ['document.deleted', 'auth.expired', 'access.revoked']) })
}

export type RemoteTeamEvent = { type: 'ready' | 'resume' | 'team.updated' | 'auth.expired' | 'access.revoked' }

export function subscribeRemoteTeam(teamId: string, onEvent: (event: RemoteTeamEvent) => void): () => void {
  const source = createPageEventStream(`/api/teams/${encodeURIComponent(teamId)}/events`, { onMessage: message => {
    try {
      const event = JSON.parse(message.data) as RemoteTeamEvent
      if (event && ['ready', 'team.updated', 'auth.expired', 'access.revoked'].includes(event.type)) onEvent(event)
    } catch {}
  }, onResume: () => onEvent({ type: 'resume' }), isTerminal: event => isTerminalStreamEvent(event, ['auth.expired', 'access.revoked']) })
  return () => source.close()
}

export type RemoteTeamsEvent = { type: 'ready' | 'resume' | 'auth.expired' } | { type: 'team.updated' | 'access.revoked'; teamId: string }

export function subscribeRemoteTeams(onEvent: (event: RemoteTeamsEvent) => void): () => void {
  const source = createPageEventStream('/api/team-events', { onMessage: message => {
    try {
      const event = JSON.parse(message.data) as RemoteTeamsEvent
      if (event && (event.type === 'ready' || event.type === 'auth.expired' || ((event.type === 'team.updated' || event.type === 'access.revoked') && typeof event.teamId === 'string'))) onEvent(event)
    } catch {}
  }, onResume: () => onEvent({ type: 'resume' }), isTerminal: event => isTerminalStreamEvent(event, ['auth.expired']) })
  return () => source.close()
}

export async function saveRemoteDocument(id: string, revision: number, document: DesignDocument): Promise<RemoteDocument> {
  return request<RemoteDocument>(`/api/documents/${encodeURIComponent(id)}`, 'PUT', { revision, name: document.name, data: document })
}

export async function listRemoteMediaAssets(documentId: string, includeReferenced = false): Promise<MediaAsset[]> {
  const query = includeReferenced ? '?includeReferenced=1' : ''
  const result = await request<{ assets: MediaAsset[] }>(`/api/documents/${encodeURIComponent(documentId)}/media${query}`)
  return result.assets
}

export async function saveRemoteMediaAsset(documentId: string, asset: MediaAsset): Promise<MediaAsset> {
  const result = await request<{ asset: MediaAsset }>(`/api/documents/${encodeURIComponent(documentId)}/media`, 'POST', { asset })
  return result.asset
}

export async function deleteRemoteMediaAsset(documentId: string, assetId: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/documents/${encodeURIComponent(documentId)}/media/${encodeURIComponent(assetId)}`, 'DELETE')
}

export async function applyRemoteOperation(documentId: string, operation: { operationId: string; baseRevision: number; pageId: string } & CollaborativeOperation): Promise<{ revision: number; document: DesignDocument; duplicate: boolean }> {
  return request<{ revision: number; document: DesignDocument; duplicate: boolean }>(`/api/documents/${encodeURIComponent(documentId)}/operations`, 'POST', operation)
}

export async function sendRemoteCursor(id: string, pageId: string | null, x?: number, y?: number): Promise<void> {
  await request<{ ok: boolean }>(`/api/documents/${encodeURIComponent(id)}/cursor`, 'POST', pageId === null ? { cursor: null } : { cursor: { pageId, x, y } })
}

export async function sendRemoteSelection(id: string, selection: RemoteSelection | null): Promise<void> {
  await request<{ ok: boolean }>(`/api/documents/${encodeURIComponent(id)}/selection`, 'POST', { selection })
}

export async function sendRemotePresentationState(id: string, pageIndex: number | null): Promise<void> {
  await request<{ ok: boolean }>(`/api/documents/${encodeURIComponent(id)}/presentation`, 'POST', { pageIndex })
}

export async function listRemotePermissions(id: string): Promise<RemotePermission[]> {
  const result = await request<{ permissions: RemotePermission[] }>(`/api/documents/${encodeURIComponent(id)}/permissions`)
  return result.permissions
}

export async function grantRemotePermission(id: string, email: string, role: Exclude<AccessRole, 'owner'>): Promise<RemotePermission> {
  const result = await request<{ permission: RemotePermission }>(`/api/documents/${encodeURIComponent(id)}/permissions`, 'POST', { email, role })
  return result.permission
}

export async function revokeRemotePermission(id: string, userId: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/documents/${encodeURIComponent(id)}/permissions/${encodeURIComponent(userId)}`, 'DELETE')
}

export async function setRemoteDocumentAccessSuspended(id: string, suspended: boolean): Promise<boolean> {
  const result = await request<{ accessSuspended: boolean }>(`/api/documents/${encodeURIComponent(id)}/access`, 'PATCH', { suspended })
  return result.accessSuspended
}

export async function getRemoteDocumentAccess(id: string): Promise<{ accessSuspended: boolean; publicLinkEnabled: boolean }> {
  return request(`/api/documents/${encodeURIComponent(id)}/access`)
}

export async function updateRemotePublicLink(id: string, action: 'enable' | 'rotate' | 'revoke'): Promise<{ publicLinkEnabled: boolean; token?: string }> {
  return request(`/api/documents/${encodeURIComponent(id)}/access`, 'PATCH', { publicLink: action })
}

export async function getPublicSharedDocument(token: string): Promise<{ name: string; document: DesignDocument; timelineMedia?: Record<string, { name: string; mimeType: string; width: number; height: number; src: string }> }> {
  return request(`/api/public-shares/${encodeURIComponent(token)}`)
}

export async function listRemoteInvitations(id: string): Promise<RemoteInvitation[]> {
  const result = await request<{ invitations: RemoteInvitation[] }>(`/api/documents/${encodeURIComponent(id)}/invitations`)
  return result.invitations
}

export async function createRemoteInvitation(id: string, email: string, role: Exclude<AccessRole, 'owner'>): Promise<CreatedRemoteInvitation> {
  const result = await request<{ invitation: CreatedRemoteInvitation }>(`/api/documents/${encodeURIComponent(id)}/invitations`, 'POST', { email, role })
  return result.invitation
}

export async function revokeRemoteInvitation(documentId: string, invitationId: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/documents/${encodeURIComponent(documentId)}/invitations/${encodeURIComponent(invitationId)}`, 'DELETE')
}

export async function getRemoteInvitation(token: string): Promise<ReceivedRemoteInvitation> {
  const result = await request<{ invitation: ReceivedRemoteInvitation }>(`/api/invitations/${encodeURIComponent(token)}`)
  return result.invitation
}

export async function acceptRemoteInvitation(token: string): Promise<{ documentId: string; role: Exclude<AccessRole, 'owner'> }> {
  return request(`/api/invitations/${encodeURIComponent(token)}`, 'POST', {})
}

export async function listRemoteComments(id: string): Promise<RemoteComment[]> {
  const result = await request<{ comments: RemoteComment[] }>(`/api/documents/${encodeURIComponent(id)}/comments`)
  return result.comments
}

export async function listRemoteCollaborators(id: string): Promise<RemoteCollaborator[]> {
  const result = await request<{ collaborators: RemoteCollaborator[] }>(`/api/documents/${encodeURIComponent(id)}/collaborators`)
  return result.collaborators
}

export async function listRemoteNotifications(): Promise<{ notifications: RemoteNotification[]; unreadCount: number }> {
  return request('/api/notifications')
}

export function subscribeRemoteNotifications(onEvent: (event: MessageEvent<string>) => void, onOpen?: () => void, onError?: () => void): PageEventStream {
  return createPageEventStream('/api/notifications/events', { onMessage: onEvent, onOpen, onError, isTerminal: event => isTerminalStreamEvent(event, ['auth.expired']) })
}

export async function setRemoteNotificationRead(id: string, read: boolean): Promise<RemoteNotification> {
  const result = await request<{ notification: Pick<RemoteNotification, 'id' | 'readAt'> }>(`/api/notifications/${encodeURIComponent(id)}`, 'PATCH', { read })
  return result.notification as RemoteNotification
}

export async function postRemoteComment(id: string, content: string, pageId: string, elementId: string | null, parentId: string | null = null): Promise<RemoteComment> {
  const result = await request<{ comment: RemoteComment }>(`/api/documents/${encodeURIComponent(id)}/comments`, 'POST', { content, pageId, elementId, parentId })
  return result.comment
}

export async function setRemoteCommentResolved(documentId: string, commentId: string, resolved: boolean): Promise<Pick<RemoteComment, 'id' | 'resolvedAt' | 'resolvedBy'>> {
  return request<Pick<RemoteComment, 'id' | 'resolvedAt' | 'resolvedBy'>>(`/api/documents/${encodeURIComponent(documentId)}/comments/${encodeURIComponent(commentId)}`, 'PATCH', { resolved })
}

export async function generateRemoteText(documentId: string, prompt: string): Promise<{ text: string; mode: 'sandbox' | 'openai-compatible' }> {
  return request('/api/ai/text', 'POST', { documentId, prompt })
}
