import test from 'node:test'
import assert from 'node:assert/strict'
import { readProjectsFilters, writeProjectsFilters, isEditedToday } from '../src/project-filters.mjs'

test('projects URL filter codec round-trips observed category and edited-date codes', () => {
  assert.equal(writeProjectsFilters({ category: 'sheet', edited: 'any' }), 'eyJBIjp7IkIiOiJ0QUdJRnU2MWVOTSJ9fQ')
  assert.equal(writeProjectsFilters({ category: 'all', edited: 'today' }), 'eyJBIjp7IkEiOiJDIn19')
  assert.deepEqual(readProjectsFilters(`?ui=${writeProjectsFilters({ category: 'sheet', edited: 'today' })}`), { category: 'sheet', edited: 'today' })
  assert.equal(writeProjectsFilters({ category: 'all', edited: 'any' }), null)
  assert.deepEqual(readProjectsFilters('?ui=invalid'), { category: 'all', edited: 'any' })
})

test('Today matching uses the current local calendar day only', () => {
  const now = new Date(2026, 9, 22, 12)
  assert.equal(isEditedToday(new Date(2026, 9, 22, 0, 1).toISOString(), now), true)
  assert.equal(isEditedToday(new Date(2026, 9, 21, 23, 59).toISOString(), now), false)
  assert.equal(isEditedToday('invalid', now), false)
})
