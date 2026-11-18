import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('team integration sample search normalizes accents, case and spaces and clear returns the catalog', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { TEAM_INTEGRATION_EXAMPLES, normalizeTeamIntegrationSearch, searchTeamIntegrationExamples } = await vite.ssrLoadModule('/src/team-integrations.mjs')
    assert.equal(normalizeTeamIntegrationSearch('  CALENDÁRIO  '), 'calendario')
    assert.deepEqual(searchTeamIntegrationExamples('  CALENDARIO ').map(item => item.id), ['calendar'])
    assert.deepEqual(searchTeamIntegrationExamples('nuvem').map(item => item.id), ['dropbox'])
    assert.deepEqual(searchTeamIntegrationExamples('consulta inexistente'), [])
    assert.deepEqual(searchTeamIntegrationExamples('   '), TEAM_INTEGRATION_EXAMPLES)
    assert.ok(TEAM_INTEGRATION_EXAMPLES.every(item => item.id && item.name && item.description && item.tags.length > 0))
  } finally { await vite.close() }
})
