type JsonObject = Record<string, unknown>
import { mergeTextAndMarks } from './text-merge.mjs'

export type MergeResult<T> = { ok: true; value: T } | { ok: false; conflicts: string[] }

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => structurallyEqual(value, right[index]))
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index]
      && structurallyEqual((left as JsonObject)[key], (right as JsonObject)[key]))
}

export function hasUnpersistedChanges<T>(current: T, persisted: T | null): boolean {
  return persisted !== null && current !== persisted && !structurallyEqual(current, persisted)
}

const deleted = Symbol('deleted')
type MergeValue = unknown | typeof deleted

function equal(left: unknown, right: unknown): boolean {
  if (left === deleted || right === deleted) return left === right
  return structurallyEqual(left, right)
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function keyedArray(value: unknown): value is Array<JsonObject & { id: string }> {
  return Array.isArray(value) && value.every(item => isObject(item) && typeof item.id === 'string')
}

function cellMatrix(value: unknown): value is string[][] {
  return Array.isArray(value) && (value.length === 0 || value.every(row => Array.isArray(row) && row.every(cell => typeof cell === 'string')))
}

type CellMergeRange = { row: number; column: number; colSpan: number; rowSpan?: number }

function rangeArray(value: unknown): value is CellMergeRange[] {
  return Array.isArray(value) && (value.length === 0 || value.every(item => isObject(item)
    && Number.isInteger(item.row) && Number(item.row) >= 0
    && Number.isInteger(item.column) && Number(item.column) >= 0
    && Number.isInteger(item.colSpan) && Number(item.colSpan) >= 1
    && (item.rowSpan === undefined || Number.isInteger(item.rowSpan) && Number(item.rowSpan) >= 1)))
}

function inlineMarkArray(value: unknown): value is Array<{ start: number; end: number; bold?: boolean; italic?: boolean }> {
  return Array.isArray(value) && value.every(item => isObject(item) && Number.isInteger(item.start) && Number.isInteger(item.end))
}

function mergeValue(base: MergeValue, local: MergeValue, remote: MergeValue, path: string, conflicts: string[]): MergeValue {
  if (path === 'updatedAt' && typeof local === 'string' && typeof remote === 'string') return local > remote ? local : remote
  if (equal(local, remote)) return local
  if (equal(base, local)) return remote
  if (equal(base, remote)) return local

  if (typeof base === 'string' && typeof local === 'string' && typeof remote === 'string') {
    const merged = mergeTextAndMarks(base, [], local, [], remote, [])
    if (merged !== null) return merged.text
  }

  if (base !== deleted && local !== deleted && remote !== deleted && cellMatrix(base) && cellMatrix(local) && cellMatrix(remote)) {
    const rows = Math.max(base.length, local.length, remote.length)
    return Array.from({ length: rows }, (_, row) => {
      const columns = Math.max(base[row]?.length ?? 0, local[row]?.length ?? 0, remote[row]?.length ?? 0)
      return Array.from({ length: columns }, (_, column) => {
        const merged = mergeValue(base[row]?.[column] ?? deleted, local[row]?.[column] ?? deleted, remote[row]?.[column] ?? deleted, `${path}[${row}][${column}]`, conflicts)
        return merged === deleted ? '' : merged as string
      })
    })
  }

  if (base !== deleted && local !== deleted && remote !== deleted && rangeArray(base) && rangeArray(local) && rangeArray(remote)) {
    const key = (item: { row: number; column: number }) => `${item.row}:${item.column}`
    const baseByKey = new Map(base.map(item => [key(item), item]))
    const localByKey = new Map(local.map(item => [key(item), item]))
    const remoteByKey = new Map(remote.map(item => [key(item), item]))
    const merged = [...new Set([...baseByKey.keys(), ...localByKey.keys(), ...remoteByKey.keys()])].flatMap(itemKey => {
      const item = mergeValue(baseByKey.get(itemKey) ?? deleted, localByKey.get(itemKey) ?? deleted, remoteByKey.get(itemKey) ?? deleted, `${path}[${itemKey}]`, conflicts)
      return item !== deleted && isObject(item) ? [item as { row: number; column: number; colSpan: number }] : []
    }).sort((left, right) => left.row - right.row || left.column - right.column)
    const active: CellMergeRange[] = []
    for (const current of merged) {
      for (let index = active.length - 1; index >= 0; index -= 1) {
        if (active[index].row + (active[index].rowSpan ?? 1) <= current.row) active.splice(index, 1)
      }
      const overlaps = active.some(previous => current.column < previous.column + previous.colSpan
        && previous.column < current.column + current.colSpan)
      if (overlaps) conflicts.push(`${path} (overlap)`)
      active.push(current)
    }
    return merged
  }

  if (base !== deleted && local !== deleted && remote !== deleted && keyedArray(base) && keyedArray(local) && keyedArray(remote)) {
    const baseById = new Map(base.map(item => [item.id, item]))
    const localById = new Map(local.map(item => [item.id, item]))
    const remoteById = new Map(remote.map(item => [item.id, item]))
    const mergedById = new Map<string, JsonObject>()
    for (const id of new Set([...baseById.keys(), ...localById.keys(), ...remoteById.keys()])) {
      const merged = mergeValue(baseById.get(id) ?? deleted, localById.get(id) ?? deleted, remoteById.get(id) ?? deleted, `${path}[${id}]`, conflicts)
      if (merged !== deleted && isObject(merged)) mergedById.set(id, merged)
    }

    const baseOrder = base.map(item => item.id)
    const localBaseOrder = local.map(item => item.id).filter(id => baseById.has(id))
    const remoteBaseOrder = remote.map(item => item.id).filter(id => baseById.has(id))
    const localReordered = !equal(localBaseOrder, baseOrder.filter(id => localById.has(id)))
    const remoteReordered = !equal(remoteBaseOrder, baseOrder.filter(id => remoteById.has(id)))
    if (localReordered && remoteReordered && !equal(localBaseOrder, remoteBaseOrder)) conflicts.push(`${path} (ordem)`)
    const preferred = localReordered && !remoteReordered ? local : remote
    const order = [...preferred.map(item => item.id), ...local.map(item => item.id), ...remote.map(item => item.id)]
    return [...new Set(order)].flatMap(id => mergedById.has(id) ? [mergedById.get(id)!] : [])
  }

  if (base !== deleted && local !== deleted && remote !== deleted && isObject(base) && isObject(local) && isObject(remote)) {
    const result: JsonObject = {}
    const hasInlineMarks = [base, local, remote].some(documentPart => Object.hasOwn(documentPart, 'marks'))
    const canMergeTextMarks = hasInlineMarks
      && typeof base.text === 'string' && typeof local.text === 'string' && typeof remote.text === 'string'
      && [base.marks, local.marks, remote.marks].every(marks => marks === undefined || inlineMarkArray(marks))
    const inlineTextMerge = canMergeTextMarks
      ? mergeTextAndMarks(base.text as string, base.marks as Array<{ start: number; end: number; bold?: boolean; italic?: boolean }> | undefined, local.text as string, local.marks as Array<{ start: number; end: number; bold?: boolean; italic?: boolean }> | undefined, remote.text as string, remote.marks as Array<{ start: number; end: number; bold?: boolean; italic?: boolean }> | undefined)
      : null
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      if (inlineTextMerge && key === 'text') { result[key] = inlineTextMerge.text; continue }
      if (inlineTextMerge && key === 'marks') { result[key] = inlineTextMerge.marks; continue }
      const merged = mergeValue(
        Object.hasOwn(base, key) ? base[key] : deleted,
        Object.hasOwn(local, key) ? local[key] : deleted,
        Object.hasOwn(remote, key) ? remote[key] : deleted,
        path ? `${path}.${key}` : key,
        conflicts,
      )
      if (merged !== deleted) result[key] = merged
    }
    return result
  }

  conflicts.push(path || 'document')
  return local
}

export function mergeConcurrentDocuments<T>(base: T, local: T, remote: T): MergeResult<T> {
  const conflicts: string[] = []
  const value = mergeValue(base, local, remote, '', conflicts)
  if (conflicts.length) return { ok: false, conflicts: [...new Set(conflicts)] }
  return { ok: true, value: value as T }
}
