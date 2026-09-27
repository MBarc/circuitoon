// The cable new wires get, remembered per browser as a convenience. Storage can fail (private
// browsing, a full quota, a disabled API) and drawing must still work: every access is wrapped, so
// a storage error just means new wires start plain.
import { isEndKind, normalizeEnds, type WireEnds } from '../format/cables.ts'

const KEY = 'circuitoon.newWire.ends'

export function loadNewWireEnds(): WireEnds | undefined {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { from, to } = parsed as Record<string, unknown>
    return normalizeEnds({ from: isEndKind(from) ? from : undefined, to: isEndKind(to) ? to : undefined })
  } catch {
    return undefined
  }
}

export function saveNewWireEnds(ends: WireEnds | undefined) {
  try {
    const norm = normalizeEnds(ends)
    if (norm) localStorage.setItem(KEY, JSON.stringify(norm))
    else localStorage.removeItem(KEY)
  } catch {
    // Storage unavailable: the choice just won't outlast this page.
  }
}
