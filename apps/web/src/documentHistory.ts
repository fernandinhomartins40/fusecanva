export type DocumentHistory<T> = {
  document: T
  undoStack: T[]
  redoStack: T[]
}

export function recordDocumentChange<T>(history: DocumentHistory<T>, document: T): DocumentHistory<T> {
  return {
    document,
    undoStack: [...history.undoStack, history.document].slice(-60),
    redoStack: [],
  }
}

export function recordDocumentCheckpoint<T>(history: DocumentHistory<T>): DocumentHistory<T> {
  return {
    ...history,
    undoStack: [...history.undoStack, history.document].slice(-60),
    redoStack: [],
  }
}

export function undoDocumentChange<T>(history: DocumentHistory<T>): DocumentHistory<T> {
  if (!history.undoStack.length) return history
  return {
    document: history.undoStack.at(-1)!,
    undoStack: history.undoStack.slice(0, -1),
    redoStack: [...history.redoStack, history.document],
  }
}

export function redoDocumentChange<T>(history: DocumentHistory<T>): DocumentHistory<T> {
  if (!history.redoStack.length) return history
  return {
    document: history.redoStack.at(-1)!,
    redoStack: history.redoStack.slice(0, -1),
    undoStack: [...history.undoStack, history.document],
  }
}
