// Net labels: named flags that join every label pin of the same name into one electrical node,
// as on a real schematic, so a long or many-ended connection needs no drawn wire. The name is the
// part's `values.net`, trimmed; matching is exact and case-sensitive (SDA and sda are two nets, as
// in KiCad and in a netlist's net names). An empty name joins nothing. Pure.
import { type Diagram, type PartInstance, moduleOf } from './diagram.ts'
import { isNetLabel, isSpacer, type ModuleDef } from './module.ts'
import { natural } from './words.ts'

/** The key a label's name is stored under in `values`. */
export const LABEL_VALUE = 'net'

/** A label's name: its stored `values.net`, trimmed; empty when missing or not text. */
export function labelName(part: Pick<PartInstance, 'values'>): string {
  const v = part.values?.[LABEL_VALUE]
  return typeof v === 'string' ? v.trim() : ''
}

/** The one pin of a net label module (its tag point). */
export function labelPin(m: ModuleDef): string {
  const pin = m.pins.find((p) => !isSpacer(p))
  return pin && !isSpacer(pin) ? pin.name : ''
}

/** A label part with its name and pin. */
export interface PlacedLabel {
  part: PartInstance
  name: string
  pin: string
}

const cache = new WeakMap<Diagram['parts'], { modules: Diagram['modules']; result: PlacedLabel[] }>()

/** Every net label on the sheet (named or not), in sheet order. Cached per parts and modules. */
export function labelsOf(d: Pick<Diagram, 'parts' | 'modules'>): PlacedLabel[] {
  const hit = cache.get(d.parts)
  if (hit && hit.modules === d.modules) return hit.result
  const result: PlacedLabel[] = []
  for (const part of d.parts) {
    const m = moduleOf(d, part.module)
    if (m && isNetLabel(m)) result.push({ part, name: labelName(part), pin: labelPin(m) })
  }
  cache.set(d.parts, { modules: d.modules, result })
  return result
}

/** Named labels grouped by name, each group in sheet order. */
export function labelGroups(d: Pick<Diagram, 'parts' | 'modules'>): Map<string, PlacedLabel[]> {
  const out = new Map<string, PlacedLabel[]>()
  for (const l of labelsOf(d)) {
    if (!l.name) continue
    const list = out.get(l.name)
    if (list) list.push(l)
    else out.set(l.name, [l])
  }
  return out
}

/** Whether the part `uid` is a net label. */
export function isLabelPart(d: Pick<Diagram, 'parts' | 'modules'>, uid: string): boolean {
  return labelsOf(d).some((l) => l.part.uid === uid)
}

/** The other labels with the same name as label `uid`, in designator order; empty for an unnamed label or a part that is not one. */
export function labelMates(d: Pick<Diagram, 'parts' | 'modules'>, uid: string): PartInstance[] {
  const me = labelsOf(d).find((l) => l.part.uid === uid)
  if (!me?.name) return []
  return labelsOf(d).filter((l) => l.name === me.name && l.part.uid !== uid).map((l) => l.part).sort((a, b) => natural.compare(a.designator, b.designator))
}
