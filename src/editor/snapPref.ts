// Whether a drag snaps to other objects (the toolbar's Snap toggle), remembered per browser as a
// convenience. Storage can fail (private browsing, a full quota, a disabled API) and editing must
// still work: every access is wrapped, and a storage error just means snapping starts on.
const KEY = 'circuitoon.snapObjects'

export function loadSnapObjects(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function saveSnapObjects(on: boolean) {
  try {
    if (on) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, 'off')
  } catch {
    // Storage unavailable: the choice just won't outlast this page.
  }
}
