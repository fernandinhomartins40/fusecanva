export type TeamIntegrationExample = {
  id: string
  name: string
  provider: string
  description: string
  tags: string[]
  color: string
}

export const TEAM_INTEGRATION_EXAMPLES: readonly TeamIntegrationExample[]
export function normalizeTeamIntegrationSearch(value: string): string
export function searchTeamIntegrationExamples(query: string, catalog?: readonly TeamIntegrationExample[]): TeamIntegrationExample[]
