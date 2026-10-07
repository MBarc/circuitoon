// Custom parts on a sheet or in a netlist: made in the part maker (`custom: true`) or embedded from
// outside the library. They are user-made and unverified, so `gate` and `explain` list them by name
// beside the "not checked" list; the checker still uses whatever pin types they declare.
import { type Diagram, moduleOf } from '../format/diagram.ts'
import { isCustom, isNetLabel, type ModuleDef } from '../format/module.ts'
import { customLook } from '../format/partMaker.ts'
import type { ModuleLookup } from './netlist.ts'

export interface CustomPart {
  module: string
  name: string
  designators: string[]
  /** Part uids on a sheet, refs in a netlist. */
  parts: string[]
}

const unverified = (m: ModuleDef | undefined, id: string, library: ModuleLookup) => !!m && !isNetLabel(m) && (isCustom(m) || !library(id))

/** Every custom or embedded module the sheet's parts use, by module id, with the parts that use it. */
export function sheetCustomParts(d: Diagram, library: ModuleLookup): CustomPart[] {
  const out = new Map<string, CustomPart>()
  for (const p of d.parts) {
    const m = moduleOf(d, p.module)
    if (!unverified(m, p.module, library)) continue
    const row = out.get(p.module) ?? { module: p.module, name: m!.name, designators: [], parts: [] }
    row.designators.push(p.designator)
    row.parts.push(p.uid)
    out.set(p.module, row)
  }
  return [...out.values()].sort((a, b) => a.module.localeCompare(b.module))
}

/** The same for a netlist's parts (`refs` and their modules). */
export function netlistCustomParts(parts: { ref: string; module: string }[], modules: Record<string, ModuleDef>, library: ModuleLookup): CustomPart[] {
  const out = new Map<string, CustomPart>()
  for (const p of parts) {
    const m = Object.hasOwn(modules, p.module) ? modules[p.module] : undefined
    if (!unverified(m, p.module, library)) continue
    const row = out.get(p.module) ?? { module: p.module, name: m!.name, designators: [], parts: [] }
    row.designators.push(p.ref)
    row.parts.push(p.ref)
    out.set(p.module, row)
  }
  return [...out.values()].sort((a, b) => a.module.localeCompare(b.module))
}

/** One plain sentence about a custom part, for gate notes and explain. */
export const customPartNote = (c: CustomPart): string =>
  `${c.designators.join(', ')}: ${c.name} [${c.module}] is a custom part, user-made and unverified. Its pins and pin types are as its maker gave them, and the checks rely on them; confirm them against the maker's datasheet before wiring.`

/** A custom part that does not look like the real thing (customLook), as a gate and check finding. */
export interface LookFinding {
  id: string
  rule: 'custom-part-look' | 'custom-part-no-photo'
  severity: 'error' | 'warning'
  message: string
  parts: string[]
  pins: []
  wires: []
}

/**
 * The look findings for custom parts (`rows`, from sheetCustomParts or netlistCustomParts): a part
 * drawn as the generic box or with no photo blocks (custom-part-look); "photo": "none" warns.
 */
export function lookFindings(rows: CustomPart[], moduleOf: (id: string) => ModuleDef | undefined): LookFinding[] {
  return rows.flatMap((c) => {
    const m = moduleOf(c.module)
    const look = m && customLook(m)
    if (!look) return []
    const rule = look.code as LookFinding['rule']
    return [{ id: `${rule}|${c.module}`, rule, severity: rule === 'custom-part-look' ? 'error' : 'warning', message: `${c.designators.join(', ')}: ${c.name} [${c.module}] ${look.message}`, parts: c.parts, pins: [], wires: [] }]
  })
}
