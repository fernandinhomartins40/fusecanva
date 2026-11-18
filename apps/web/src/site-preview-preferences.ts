export type SitePreviewViewportMode = 'desktop' | 'mobile'

export type SitePreviewPreferences = {
  viewportMode: SitePreviewViewportMode
  mobileFit: boolean
}

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>

const defaults: SitePreviewPreferences = { viewportMode: 'desktop', mobileFit: true }

function getBrowserStorage(): PreferenceStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function preferenceKey(documentId: string, name: 'viewport' | 'mobile-fit') {
  return name === 'viewport' ? `fuse-site-preview-viewport:${documentId}` : `fuse-site-mobile-fit:${documentId}`
}

export function readSitePreviewPreferences(documentId: string, storage = getBrowserStorage()): SitePreviewPreferences {
  if (!storage) return { ...defaults }
  try {
    return {
      viewportMode: storage.getItem(preferenceKey(documentId, 'viewport')) === 'mobile' ? 'mobile' : 'desktop',
      mobileFit: storage.getItem(preferenceKey(documentId, 'mobile-fit')) !== 'false',
    }
  } catch {
    return { ...defaults }
  }
}

export function persistSitePreviewViewport(documentId: string, viewportMode: SitePreviewViewportMode, storage = getBrowserStorage()): void {
  try { storage?.setItem(preferenceKey(documentId, 'viewport'), viewportMode) } catch { /* Preference is optional when storage is unavailable. */ }
}

export function persistSitePreviewMobileFit(documentId: string, mobileFit: boolean, storage = getBrowserStorage()): void {
  try { storage?.setItem(preferenceKey(documentId, 'mobile-fit'), String(mobileFit)) } catch { /* Preference is optional when storage is unavailable. */ }
}
