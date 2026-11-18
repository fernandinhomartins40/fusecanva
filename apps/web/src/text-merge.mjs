function textEdits(base, changed) {
  const baseCharacters = Array.from(base)
  const changedCharacters = Array.from(changed)
  const rows = baseCharacters.length + 1
  const columns = changedCharacters.length + 1
  if (baseCharacters.length * changedCharacters.length > 1_000_000) {
    let start = 0
    while (start < baseCharacters.length && start < changedCharacters.length && baseCharacters[start] === changedCharacters[start]) start += 1
    let suffix = 0
    while (suffix < baseCharacters.length - start && suffix < changedCharacters.length - start && baseCharacters[baseCharacters.length - suffix - 1] === changedCharacters[changedCharacters.length - suffix - 1]) suffix += 1
    return [{ start, end: baseCharacters.length - suffix, inserted: changedCharacters.slice(start, changedCharacters.length - suffix) }]
  }
  const lcs = new Uint32Array(rows * columns)
  for (let row = baseCharacters.length - 1; row >= 0; row -= 1) {
    for (let column = changedCharacters.length - 1; column >= 0; column -= 1) {
      const index = row * columns + column
      lcs[index] = baseCharacters[row] === changedCharacters[column]
        ? 1 + lcs[(row + 1) * columns + column + 1]
        : Math.max(lcs[(row + 1) * columns + column], lcs[index + 1])
    }
  }
  const edits = []
  let row = 0
  let column = 0
  let edit = null
  const flush = () => { if (edit) edits.push(edit); edit = null }
  while (row < baseCharacters.length || column < changedCharacters.length) {
    if (row < baseCharacters.length && column < changedCharacters.length && baseCharacters[row] === changedCharacters[column]) {
      flush()
      row += 1
      column += 1
    } else {
      edit ??= { start: row, end: row, inserted: [] }
      if (column < changedCharacters.length && (row === baseCharacters.length || lcs[row * columns + column + 1] > lcs[(row + 1) * columns + column])) edit.inserted.push(changedCharacters[column++])
      else if (row < baseCharacters.length) edit.end = ++row
      else edit.inserted.push(changedCharacters[column++])
    }
  }
  flush()
  return edits
}

function mapBaseOffset(offset, edits) {
  return offset + edits.reduce((delta, edit) => edit.end <= offset ? delta + edit.inserted.length - (edit.end - edit.start) : delta, 0)
}

function codePointOffsetToUtf16(text, offset) {
  let codePoints = 0
  let utf16 = 0
  for (const character of text) {
    if (codePoints >= offset) break
    codePoints += 1
    utf16 += character.length
  }
  return utf16
}

const markKinds = ['bold', 'italic', 'underline', 'strike']

function normalizeMarks(marks, textLength) {
  const valid = marks.map(mark => ({
    start: Math.max(0, Math.min(textLength, mark.start)),
    end: Math.max(0, Math.min(textLength, mark.end)),
    ...Object.fromEntries(markKinds.map(kind => [kind, Boolean(mark[kind])])),
  })).filter(mark => mark.end > mark.start && markKinds.some(kind => mark[kind]))
  const boundaries = [...new Set([0, textLength, ...valid.flatMap(mark => [mark.start, mark.end])])].sort((a, b) => a - b)
  const result = []
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index]
    const end = boundaries[index + 1]
    if (end <= start) continue
    const style = Object.fromEntries(markKinds.map(kind => [kind, valid.some(mark => mark[kind] && mark.start <= start && mark.end >= end)]))
    if (!markKinds.some(kind => style[kind])) continue
    const previous = result.at(-1)
    if (previous && previous.end === start && markKinds.every(kind => Boolean(previous[kind]) === style[kind])) previous.end = end
    else result.push({ start, end, ...Object.fromEntries(markKinds.filter(kind => style[kind]).map(kind => [kind, true])) })
  }
  return result
}

function remapMarksForEdit(text, marks, start, end, insertedText) {
  const nextEnd = start + insertedText.length
  const delta = insertedText.length - (end - start)
  const next = []
  for (const mark of marks) {
    const beforeEnd = Math.min(mark.end, start)
    if (mark.start < beforeEnd) next.push({ ...mark, end: beforeEnd })
    const afterStart = Math.max(mark.start, end)
    if (afterStart < mark.end) next.push({ ...mark, start: afterStart + delta, end: mark.end + delta })
  }
  if (nextEnd > start) {
    const inherited = marks.filter(mark => (mark.start < start && mark.end >= start) || (mark.start <= start && mark.end >= end))
    const style = Object.fromEntries(markKinds.filter(kind => inherited.some(mark => mark[kind])).map(kind => [kind, true]))
    if (Object.keys(style).length) next.push({ start, end: nextEnd, ...style })
  }
  return normalizeMarks(next, text.length + delta)
}

function applyEdits(text, marks, edits) {
  let characters = Array.from(text)
  let currentText = text
  let currentMarks = marks
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    const start = codePointOffsetToUtf16(currentText, edit.start)
    const end = codePointOffsetToUtf16(currentText, edit.end)
    const insertedText = edit.inserted.join('')
    characters = characters.slice(0, edit.start).concat(edit.inserted, characters.slice(edit.end))
    const nextText = characters.join('')
    currentMarks = remapMarksForEdit(currentText, currentMarks, start, end, insertedText)
    currentText = nextText
  }
  return { text: currentText, marks: normalizeMarks(currentMarks, currentText.length) }
}

function overlaps(left, right) {
  const leftInsert = left.start === left.end
  const rightInsert = right.start === right.end
  if (leftInsert && rightInsert) return left.start === right.start
  if (leftInsert) return left.start >= right.start && left.start <= right.end
  if (rightInsert) return right.start >= left.start && right.start <= left.end
  return Math.max(left.start, right.start) < Math.min(left.end, right.end)
}

function mergeMarkState(base, local, remote) {
  if (local === remote) return local
  if (local === base) return remote
  if (remote === base) return local
  return null
}

function mergeMarks(textLength, baseMarks, localMarks, remoteMarks) {
  const all = [...baseMarks, ...localMarks, ...remoteMarks]
  const boundaries = [...new Set([0, textLength, ...all.flatMap(mark => [Math.max(0, Math.min(textLength, mark.start)), Math.max(0, Math.min(textLength, mark.end))])])].sort((a, b) => a - b)
  const result = []
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index]
    const end = boundaries[index + 1]
    if (end <= start) continue
    const active = marks => marks.filter(mark => mark.start <= start && mark.end >= end)
    const base = active(baseMarks)
    const local = active(localMarks)
    const remote = active(remoteMarks)
    const style = Object.fromEntries(markKinds.map(kind => [kind, mergeMarkState(base.some(mark => mark[kind]), local.some(mark => mark[kind]), remote.some(mark => mark[kind]))]))
    if (markKinds.some(kind => style[kind] === null)) return null
    if (!markKinds.some(kind => style[kind])) continue
    const activeStyle = Object.fromEntries(markKinds.filter(kind => style[kind]).map(kind => [kind, true]))
    const previous = result.at(-1)
    if (previous && previous.end === start && markKinds.every(kind => Boolean(previous[kind]) === Boolean(style[kind]))) previous.end = end
    else result.push({ start, end, ...activeStyle })
  }
  return result
}

export function mergeTextAndMarks(baseText, baseMarks = [], localText, localMarks = [], remoteText, remoteMarks = []) {
  const localEdits = textEdits(baseText, localText)
  const remoteEdits = textEdits(baseText, remoteText)
  if (localEdits.some(local => remoteEdits.some(remote => overlaps(local, remote)))) return null

  const localRebased = remoteEdits.map(edit => ({ ...edit, start: mapBaseOffset(edit.start, localEdits), end: mapBaseOffset(edit.end, localEdits) }))
  const remoteRebased = localEdits.map(edit => ({ ...edit, start: mapBaseOffset(edit.start, remoteEdits), end: mapBaseOffset(edit.end, remoteEdits) }))
  const baseMerged = applyEdits(baseText, baseMarks, [...localEdits, ...remoteEdits])
  const localMerged = applyEdits(localText, localMarks, localRebased)
  const remoteMerged = applyEdits(remoteText, remoteMarks, remoteRebased)
  if (baseMerged.text !== localMerged.text || baseMerged.text !== remoteMerged.text) return null
  const marks = mergeMarks(baseMerged.text.length, baseMerged.marks, localMerged.marks, remoteMerged.marks)
  return marks === null ? null : { text: baseMerged.text, marks }
}
