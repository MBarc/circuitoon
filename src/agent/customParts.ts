// Custom parts on a sheet or in a netlist: made in the part maker (`custom: true`) or embedded from
// outside the library. They are user-made and unverified, so `gate` and `explain` list them by name
// beside the "not checked" list; the checker still uses whatever pin types they declare.
import { type Diagram, moduleOf } from '../format/diagram.ts'
import { isCustom, isNetLabel, type ModuleDef } from '../format/module.ts'
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
