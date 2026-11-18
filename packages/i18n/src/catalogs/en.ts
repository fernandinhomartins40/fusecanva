import type { MessageKey } from './pt-BR.js'

// O tipo exige todas as chaves do catalogo de origem; o teste tambem confere argumentos ICU.
export const en: Record<MessageKey, string> = {
  'app.name': 'Fuse Studio',
  'app.tagline': 'Open visual design, local and yours.',

  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.confirm': 'Confirm',
  'common.delete': 'Delete',
  'common.duplicate': 'Duplicate',
  'common.rename': 'Rename',
  'common.undo': 'Undo',
  'common.redo': 'Redo',
  'common.search': 'Search',
  'common.loading': 'Loading',
  'common.saving': 'Saving',
  'common.retry': 'Try again',
  'common.more': 'More options',
  'common.back': 'Back',
  'common.next': 'Next',
  'common.settings': 'Settings',
  'common.optional': 'optional',
  'common.required': 'required',

  'ui.dialog.close': 'Close dialog',
  'ui.toast.close': 'Dismiss notification',
  'ui.toast.region': 'Notifications ({hotkey})',
  'ui.select.placeholder': 'Select',
  'ui.theme.light': 'Light theme',
  'ui.theme.dark': 'Dark theme',
  'ui.theme.system': 'Match system',

  'project.untitled': 'Untitled project',
  'project.count': '{count, plural, =0 {No projects} one {# project} other {# projects}}',
  'project.empty.title': 'No projects yet',
  'project.empty.description': 'Create a design, doc, sheet or whiteboard to get started.',
  'project.lastEdited': 'Edited {when}',
  'project.ownedBy': 'By {name}',

  'editor.zoom.label': 'Zoom',
  'editor.zoom.value': '{percent, number, percent}',
  'editor.layers.title': 'Layers',
  'editor.selection.count': '{count, plural, =0 {Nothing selected} one {# object selected} other {# objects selected}}',
  'editor.offline': 'Offline. Changes are saved on this device.',
  'editor.synced': 'All changes synced',

  'share.title': 'Share',
  'share.role': '{role, select, owner {Owner} editor {Can edit} commenter {Can comment} viewer {Can view} other {Custom access}}',
  'share.invited': '{name} was invited.',

  'export.started': 'Export started',
  'export.progress': 'Exporting page {done} of {total}',
  'export.done': '{format} file ready',

  'error.generic': 'Something went wrong. Please try again.',
  'error.offline': 'You are offline.',
  'error.fileTooLarge': 'The file exceeds the {limit} limit.',
}
