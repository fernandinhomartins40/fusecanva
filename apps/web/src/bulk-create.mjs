function detectBulkDelimiter(text) {
  const counts = new Map([['\t', 0], [';', 0], [',', 0]])
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"' && quoted && text[index + 1] === '"') { index += 1; continue }
    if (char === '"') { quoted = !quoted; continue }
    if (!quoted && (char === '\r' || char === '\n')) break
    if (!quoted && counts.has(char)) counts.set(char, counts.get(char) + 1)
  }
  return [...counts].sort((left, right) => right[1] - left[1])[0][0]
}

export function parseBulkDelimited(text) {
  const source = String(text).replace(/^\uFEFF/, '')
  if (!source.length) return [['Campo 1'], ['']]
  const delimiter = detectBulkDelimiter(source)
  const rows = []; let row = []; let value = ''; let quoted = false; let rowStarted = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { value += '"'; index += 1 }
      else { quoted = !quoted; rowStarted = true }
    } else if (char === delimiter && !quoted) {
      row.push(value); value = ''; rowStarted = true
    } else if ((char === '\r' || char === '\n') && !quoted) {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      if (rowStarted || row.length || value.length) { row.push(value); rows.push(row) }
      row = []; value = ''; rowStarted = false
    } else {
      value += char
      if (char !== ' ' && char !== '\t') rowStarted = true
    }
  }
  if (quoted) throw new Error('O arquivo contém um campo entre aspas sem fechamento.')
  if (rowStarted || row.length || value.length) { row.push(value); rows.push(row) }
  return rows.length ? rows : [['Campo 1'], ['']]
}

export function generateBulkPages(page, records, bindings, makeId) {
  return records.map((record, index) => {
    const identityMap = new Map(page.elements.map(element => [element.id, makeId('element')]))
    return {
      ...page,
      id: makeId('page'),
      name: `${page.name || 'Página'} · ${index + 1}`,
      elements: page.elements.map(element => {
        const column = bindings[element.id]
        return { ...element, id: identityMap.get(element.id), ...(element.type === 'text' && column !== undefined && record[column] !== undefined && record[column] !== '' ? { text: record[column] } : {}) }
      }),
      connectors: page.connectors?.map(connector => ({ ...connector, id: makeId('connector'), fromId: identityMap.get(connector.fromId) ?? connector.fromId, toId: identityMap.get(connector.toId) ?? connector.toId })),
      groups: page.groups?.map(group => ({ ...group, id: makeId('group'), elementIds: group.elementIds.map(id => identityMap.get(id) ?? id) })),
    }
  })
}

export function generateBulkDocuments(sourceDocument, pages, makeId, createdAt = new Date().toISOString()) {
  const activeDocument = { ...sourceDocument }
  delete activeDocument.archivedAt
  delete activeDocument.trashedAt
  return pages.map((page, index) => ({
    ...activeDocument,
    id: makeId('design'),
    name: `${sourceDocument.name || 'Design'} · ${index + 1}`,
    pages: [page],
    updatedAt: createdAt,
  }))
}
