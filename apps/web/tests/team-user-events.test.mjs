import test from 'node:test'
import assert from 'node:assert/strict'
import { createAppServer } from '../server/index.mjs'

const origin = 'http://127.0.0.1:5173'

test('one authenticated team stream covers many teams, replays safely and continues after revocation', async () => {
  const server = createAppServer({ databasePath: ':memory:', allowedOrigins: [origin], secureCookies: false, userTeamHeartbeatMs: 80, invitationEmailSender: async () => ({ status: 'link-only', reason: 'test-sandbox' }) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const streams = []
  async function request(path, { method = 'GET', cookie, body } = {}) {
    const headers = { origin, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }
    const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, payload: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }
  }
  async function account(name, email) {
    assert.equal((await request('/api/auth/register', { method: 'POST', body: { name, email, password: 'team-stream-password' } })).status, 201)
    const login = await request('/api/auth/login', { method: 'POST', body: { email, password: 'team-stream-password' } })
    assert.equal(login.status, 200)
    return login.cookie
  }
  async function join(teamId, adminCookie, memberCookie, email) {
    const invite = await request(`/api/teams/${teamId}/invitations`, { method: 'POST', cookie: adminCookie, body: { email } })
    assert.equal(invite.status, 201)
    assert.equal((await request(`/api/team-invitations/${invite.payload.invitation.token}`, { method: 'POST', cookie: memberCookie })).status, 200)
  }
  async function connect(cookie, lastEventId) {
    const controller = new AbortController()
    streams.push(controller)
    const response = await fetch(`${base}/api/team-events`, { headers: { origin, cookie, ...(lastEventId === undefined ? {} : { 'last-event-id': String(lastEventId) }) }, signal: controller.signal })
    assert.equal(response.status, 200)
    const reader = response.body.getReader()
    let buffer = ''
    const decoder = new TextDecoder()
    return { controller, async nextFrame() {
      for (;;) {
        const separator = buffer.indexOf('\n\n')
        if (separator >= 0) {
          const frame = buffer.slice(0, separator); buffer = buffer.slice(separator + 2)
          const data = frame.match(/^data: (.+)$/m)?.[1]
          if (data) return { id: Number(frame.match(/^id: (\d+)$/m)?.[1]) || undefined, event: JSON.parse(data) }
          if (frame.includes(': keepalive')) return { heartbeat: true }
          continue
        }
        let timer
        const result = await Promise.race([reader.read(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out waiting for team event')), 4000) })]).finally(() => clearTimeout(timer))
        if (result.done) throw new Error('Team event stream ended unexpectedly')
        buffer += decoder.decode(result.value, { stream: true })
      }
    }, async nextData() { for (;;) { const frame = await this.nextFrame(); if (frame.event) return frame } } }
  }

  try {
    const admin = await account('Stream admin', 'team-stream-admin@example.test')
    const memberEmail = 'team-stream-member@example.test'
    const member = await account('Stream member', memberEmail)
    const outsider = await account('Stream outsider', 'team-stream-outsider@example.test')
    const memberId = (await request('/api/auth/me', { cookie: member })).payload.user.id
    const teams = []
    for (let index = 0; index < 9; index += 1) {
      const result = await request('/api/teams', { method: 'POST', cookie: admin, body: { name: `Stream team ${index}` } })
      assert.equal(result.status, 201)
      teams.push(result.payload.team)
      await join(result.payload.team.id, admin, member, memberEmail)
    }
    assert.equal((await request('/api/teams', { cookie: member })).payload.teams.length, 9)
    const outsideTeam = (await request('/api/teams', { method: 'POST', cookie: outsider, body: { name: 'Outside team' } })).payload.team
    assert.equal((await request('/api/team-events')).status, 401)

    const memberStream = await connect(member)
    const outsiderStream = await connect(outsider)
    assert.equal((await memberStream.nextData()).event.type, 'ready')
    assert.equal((await outsiderStream.nextData()).event.type, 'ready')
    assert.equal((await memberStream.nextFrame()).heartbeat, true, 'the authenticated stream sends heartbeats')
    assert.equal((await request(`/api/teams/${teams[0].id}`, { method: 'PATCH', cookie: admin, body: { name: 'Stream team zero changed' } })).status, 200)
    const beforeRevocation = await memberStream.nextData()
    assert.deepEqual(beforeRevocation.event, { type: 'team.updated', teamId: teams[0].id })

    assert.equal((await request(`/api/teams/${outsideTeam.id}`, { method: 'PATCH', cookie: outsider, body: { name: 'Outside one' } })).status, 200)
    assert.deepEqual((await outsiderStream.nextData()).event, { type: 'team.updated', teamId: outsideTeam.id })
    assert.equal((await request(`/api/teams/${teams[0].id}/members?userId=${memberId}`, { method: 'DELETE', cookie: admin })).status, 200)
    assert.deepEqual((await memberStream.nextData()).event, { type: 'access.revoked', teamId: teams[0].id })
    assert.equal((await request(`/api/teams/${teams[1].id}`, { method: 'PATCH', cookie: admin, body: { name: 'Stream team one changed' } })).status, 200)
    assert.deepEqual((await memberStream.nextData()).event, { type: 'team.updated', teamId: teams[1].id }, 'the same stream continues for other teams')
    assert.equal((await request(`/api/teams/${outsideTeam.id}`, { method: 'PATCH', cookie: outsider, body: { name: 'Outside two' } })).status, 200)
    assert.deepEqual((await outsiderStream.nextData()).event, { type: 'team.updated', teamId: outsideTeam.id }, 'another user never receives a private team event')
    assert.equal((await request('/api/auth/me', { cookie: member })).status, 200)

    memberStream.controller.abort()
    await join(teams[0].id, admin, member, memberEmail)
    assert.equal((await request(`/api/teams/${teams[1].id}`, { method: 'PATCH', cookie: admin, body: { name: 'Stream team one replay' } })).status, 200)
    const replay = await connect(member, beforeRevocation.id)
    assert.equal((await replay.nextData()).event.type, 'ready')
    assert.deepEqual((await replay.nextData()).event, { type: 'team.updated', teamId: teams[1].id })
    assert.deepEqual((await replay.nextData()).event, { type: 'team.updated', teamId: teams[0].id }, 'rejoined team is present in replay')
    assert.deepEqual((await replay.nextData()).event, { type: 'team.updated', teamId: teams[1].id }, 'stale revocation is filtered after rejoining')
    assert.equal((await request('/api/auth/logout', { method: 'POST', cookie: member })).status, 200)
    assert.equal((await replay.nextData()).event.type, 'auth.expired')
    assert.equal((await request(`/api/teams/${outsideTeam.id}`, { method: 'PATCH', cookie: outsider, body: { name: 'Outside still active' } })).status, 200)
    assert.deepEqual((await outsiderStream.nextData()).event, { type: 'team.updated', teamId: outsideTeam.id }, 'one user logout does not affect another stream')
  } finally {
    for (const controller of streams) controller.abort()
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
