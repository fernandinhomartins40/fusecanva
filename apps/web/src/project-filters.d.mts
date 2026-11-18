export type ProjectsFilters = { category: 'all' | 'sheet'; edited: 'any' | 'today' }
export function readProjectsFilters(search: string): ProjectsFilters
export function writeProjectsFilters(filters: ProjectsFilters): string | null
export function isEditedToday(updatedAt: string, now?: Date): boolean
