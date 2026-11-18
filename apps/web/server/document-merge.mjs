import { mergeTextAndMarks } from '../src/text-merge.mjs'

const deleted = Symbol('deleted')

function equal(left, right) {
  if (left === deleted || right === deleted) return left === right
  return structurallyEqual(left, right)
}

function structurallyEqual(left, right) {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => structurallyEqual(value, right[index]))
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index]
      && structurallyEqual(left[key], right[key]))
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function keyedArray(value) {
  return Array.isArray(value) && value.every(item => isObject(item) && typeof item.id === 'string')
}

function cellMatrix(value) {
  return Array.isArray(value) && (value.length === 0 || value.every(row => Array.isArray(row) && row.every(cell => typeof cell === 'string')))
}

function rangeArray(value) {
  return Array.isArray(value) && (value.length === 0 || value.every(item => isObject(item)
    && Number.isInteger(item.row) && item.row >= 0
    && Number.isInteger(item.column) && item.column >= 0
    && Number.isInteger(item.colSpan) && item.colSpan >= 1
    && (item.rowSpan === undefined || Number.isInteger(item.rowSpan) && item.rowSpan >= 1)))
}

function inlineMarkArray(value) {
  return Array.isArray(value) && value.every(item => isObject(item) && Number.isInteger(item.start) && Number.isInteger(item.end))
}

function mergeValue(base, local, remote, path, conflicts) {
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
        return merged === deleted ? '' : merged
      })
    })
  }

  if (base !== deleted && local !== deleted && remote !== deleted && rangeArray(base) && rangeArray(local) && rangeArray(remote)) {
    const key = item => `${item.row}:${item.column}`
    const baseByKey = new Map(base.map(item => [key(item), item]))
    const localByKey = new Map(local.map(item => [key(item), item]))
    const remoteByKey = new Map(remote.map(item => [key(item), item]))
    const merged = [...new Set([...baseByKey.keys(), ...localByKey.keys(), ...remoteByKey.keys()])].flatMap(itemKey => {
      const item = mergeValue(baseByKey.get(itemKey) ?? deleted, localByKey.get(itemKey) ?? deleted, remoteByKey.get(itemKey) ?? deleted, `${path}[${itemKey}]`, conflicts)
      return item !== deleted && isObject(item) ? [item] : []
    }).sort((left, right) => left.row - right.row || left.column - right.column)
    const active = []
    for (const current of merged) {
      for (let index = active.length - 1; index >= 0; index -= 1) {
        if (active[index].row + (active[index].rowSpan ?? 1) <= current.row) active.splice(index, 1)
      }
      if (active.some(previous => current.column < previous.column + previous.colSpan
        && previous.column < current.column + current.colSpan)) conflicts.push(`${path} (overlap)`)
      active.push(current)
    }
    return merged
  }

  if (base !== deleted && local !== deleted && remote !== deleted && keyedArray(base) && keyedArray(local) && keyedArray(remote)) {
    const baseById = new Map(base.map(item => [item.id, item]))
    const localById = new Map(local.map(item => [item.id, item]))
    const remoteById = new Map(remote.map(item => [item.id, item]))
    const mergedById = new Map()
    for (const id of new Set([...baseById.keys(), ...localById.keys(), ...remoteById.keys()])) {
      const merged = mergeValue(baseById.get(id) ?? deleted, localById.get(id) ?? deleted, remoteById.get(id) ?? deleted, `${path}[${id}]`, conflicts)
      if (merged !== deleted && isObject(merged)) mergedById.set(id, merged)
    }

    const baseOrder = base.map(item => item.id)
    const localBaseOrder = local.map(item => item.id).filter(id => baseById.has(id))
    const remoteBaseOrder = remote.map(item => item.id).filter(id => baseById.has(id))
    const localReordered = !equal(localBaseOrder, baseOrder.filter(id => localById.has(id)))
    const remoteReordered = !equal(remoteBaseOrder, baseOrder.filter(id => remoteById.has(id)))
    if (localReordered && remoteReordered && !equal(localBaseOrder, remoteBaseOrder)) conflicts.push(`${path} (order)`)
    const preferred = localReordered && !remoteReordered ? local : remote
    const order = [...preferred.map(item => item.id), ...local.map(item => item.id), ...remote.map(item => item.id)]
    return [...new Set(order)].flatMap(id => mergedById.has(id) ? [mergedById.get(id)] : [])
  }

  if (base !== deleted && local !== deleted && remote !== deleted && isObject(base) && isObject(local) && isObject(remote)) {
    const result = {}
    const hasInlineMarks = [base, local, remote].some(documentPart => Object.hasOwn(documentPart, 'marks'))
    const canMergeTextMarks = hasInlineMarks
      && typeof base.text === 'string' && typeof local.text === 'string' && typeof remote.text === 'string'
      && [base.marks, local.marks, remote.marks].every(marks => marks === undefined || inlineMarkArray(marks))
    const inlineTextMerge = canMergeTextMarks
      ? mergeTextAndMarks(base.text, base.marks, local.text, local.marks, remote.text, remote.marks)
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

export function mergeConcurrentDocuments(base, local, remote) {
  const conflicts = []
  const value = mergeValue(base, local, remote, '', conflicts)
  return conflicts.length ? { ok: false, conflicts: [...new Set(conflicts)] } : { ok: true, value }
}
