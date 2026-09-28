// The partial diagram `layout --keep` reads (agent toolkit spec 2.1): the diagram format with part
// coordinates optional, plus its intent. Only `intent` and each part's `designator`, `x`, `y` and
// `rotation` are read; connections are regenerated from the intent. Its own format string
// (circuitoon-partial/1) means the site never opens one. Every position given is kept exactly
// (amendment A6); placement refuses one it cannot hold rather than moving it. Pure.
import { isNum, isObj } from '../format/module.ts'
import type { Rotation } from '../format/geometry.ts'
import type { KeepMap } from './place.ts'

export const PARTIAL_FORMAT = 'circuitoon-partial/1'
export type PartialResult = { ok: true; intent: unknown; keep: KeepMap } | { ok: false; errors: string[] }

const ROTATIONS: readonly unknown[] = [0, 90, 180, 270]

export function loadPartial(raw: unknown): PartialResult {
  if (!isObj(raw)) return { ok: false, errors: ['partial must be a JSON object'] }
  const errors: string[] = []
  if (raw.format !== PARTIAL_FORMAT) errors.push(`format: must be "${PARTIAL_FORMAT}" (copy the sheet, change its format, and delete x and y on the parts to place again)`)
  if (!isObj(raw.intent)) errors.push('intent: required, the netlist the sheet was laid out from')
  const keep: KeepMap = new Map()
  const seen = new Map<string, number>()
  if (!Array.isArray(raw.parts)) errors.push('parts: required list')
  else
    raw.parts.forEach((p: unknown, i) => {
      const at = `parts[${i}]`
      if (!isObj(p) || typeof p.designator !== 'string') return void errors.push(`${at}.designator: required`)
      const first = seen.get(p.designator)
      if (first !== undefined) return void errors.push(`${at}.designator: ${p.designator} is already listed at parts[${first}]`)
      seen.set(p.designator, i)
      if (p.x === undefined && p.y === undefined) return
      if (!isNum(p.x) || !isNum(p.y)) return void errors.push(`${at}: give both x and y, or neither`)
      if (p.x % 10 !== 0 || p.y % 10 !== 0) return void errors.push(`${at}: x and y must be on the 10 px grid`)
      // Only an absent rotation means 0; null is refused like any other invalid value.
      const rotation = p.rotation === undefined ? 0 : p.rotation
      if (!ROTATIONS.includes(rotation)) return void errors.push(`${at}.rotation: must be 0, 90, 180 or 270`)
      keep.set(p.designator, { x: p.x, y: p.y, rotation: rotation as Rotation })
    })
  return errors.length ? { ok: false, errors } : { ok: true, intent: raw.intent, keep }
}
