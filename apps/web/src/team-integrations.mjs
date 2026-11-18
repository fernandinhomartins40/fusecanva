/** @typedef {{ id: string, name: string, provider: string, description: string, tags: string[], color: string }} TeamIntegrationExample */

/** Small illustrative list based on audited app names; not an available-integration inventory. @type {readonly TeamIntegrationExample[]} */
export const TEAM_INTEGRATION_EXAMPLES = [
  { id: 'drive', name: 'Google Drive', provider: 'Google', description: 'Arquivos e pastas', tags: ['documentos', 'armazenamento', 'google'], color: '#4f8cf7' },
  { id: 'slack', name: 'Slack', provider: 'Slack', description: 'Conversas e atualizações', tags: ['mensagens', 'comunicação', 'equipe'], color: '#ba6ca6' },
  { id: 'notion', name: 'Notion', provider: 'Notion', description: 'Notas e documentos', tags: ['wiki', 'documentos', 'notas'], color: '#62626d' },
  { id: 'calendar', name: 'Google Calendar', provider: 'Google', description: 'Agenda e eventos', tags: ['agenda', 'calendário', 'google'], color: '#5989e5' },
  { id: 'figma', name: 'Figma', provider: 'Figma', description: 'Arquivos de design', tags: ['design', 'protótipos', 'interface'], color: '#e97859' },
  { id: 'dropbox', name: 'Dropbox', provider: 'Dropbox', description: 'Armazenamento compartilhado', tags: ['arquivos', 'armazenamento', 'nuvem'], color: '#4687e8' },
  { id: 'teams', name: 'Microsoft Teams', provider: 'Microsoft', description: 'Reuniões e mensagens', tags: ['mensagens', 'reuniões', 'equipe'], color: '#7168c8' },
  { id: 'asana', name: 'Asana', provider: 'Asana', description: 'Tarefas e projetos', tags: ['tarefas', 'projetos', 'planejamento'], color: '#e67878' },
]

export function normalizeTeamIntegrationSearch(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ')
}

/** @param {string} query @param {readonly TeamIntegrationExample[]} [catalog] @returns {TeamIntegrationExample[]} */
export function searchTeamIntegrationExamples(query, catalog = TEAM_INTEGRATION_EXAMPLES) {
  const normalized = normalizeTeamIntegrationSearch(query)
  if (!normalized) return [...catalog]
  return catalog.filter(item => normalizeTeamIntegrationSearch([item.name, item.provider, item.description, ...item.tags].join(' ')).includes(normalized))
}
