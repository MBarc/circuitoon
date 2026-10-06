// Cross-origin isolation (firmware spec 2.5). The service worker's config in index.html reads
// window.__circuitoonUnsaved before it reloads (after a deploy updates the worker), so an unsaved
// diagram is never lost; the editor keeps the flag current.
export const UNSAVED_FLAG = '__circuitoonUnsaved'

export function markUnsaved(on: boolean): void {
  ;(window as unknown as Record<string, unknown>)[UNSAVED_FLAG] = on
}
