// Layout (agent toolkit spec 2): netlist in, sheet out. Parse and check the netlist, place the parts
// (mounting included), realize the nets as wires, route them with the existing router, and when a
// route is blocked try again with more spacing, up to 3 placements; after that fail with the
// blocked nets rather than emit a sheet with blocked wires. A body or caption overlap (only kept
// parts can cause one) fails the layout with each pair named (amendment A7), and the realized sheet
// must verify clean against its own intent before it is returned, so a kept part that shorts two
// nets through a strip is caught here. The sheet embeds its modules and stores the netlist as
// `intent`, so every later check re-verifies against it. Pure.
import { DIAGRAM_FORMAT, type Diagram, computeRoutes } from '../format/diagram.ts'
import { type Intent, type ModuleLookup, parseNetlist } from './netlist.ts'
import { libraryLookup } from './catalog.ts'
import { type KeepMap, placeParts } from './place.ts'
import { realize } from './realize.ts'
import { type ReadabilityReport, overlaps, readability } from './readability.ts'
import { verifyDiagram } from './verify.ts'
import { naturalCompare } from './order.ts'

export const SPACINGS = [20, 40, 60]

export interface LayoutOutput {
  diagram: Diagram
  report: ReadabilityReport
  intent: Intent
  /** Which placement succeeded, 1 to SPACINGS.length. */
  attempts: number
  netOfWire: Map<string, string>
}
export type LayoutResult = { ok: true; value: LayoutOutput } | { ok: false; stage: 'input' | 'layout'; errors: string[] }

export function layoutNetlist(raw: unknown, opts: { library?: ModuleLookup; keep?: KeepMap } = {}): LayoutResult {
  const library = opts.library ?? libraryLookup
  const parsed = parseNetlist(raw, library)
  if (!parsed.ok) return { ok: false, stage: 'input', errors: parsed.errors }
  const intent = parsed.intent
  let blocked: string[] = []
  for (const [i, spacing] of SPACINGS.entries()) {
    const placed = placeParts(intent, { spacing, keep: opts.keep })
    if (!placed.ok) return { ok: false, stage: 'layout', errors: placed.errors }
    const base: Diagram = {
      format: DIAGRAM_FORMAT,
      title: intent.title,
      modules: intent.modules,
      parts: placed.parts,
      connections: [],
      ...(placed.annotations.length ? { annotations: placed.annotations } : {}),
      intent: structuredClone(raw),
    }
    const over = overlaps(base)
    if (over.body.length || over.caption.length)
      return { ok: false, stage: 'layout', errors: [...over.body.map((o) => `body overlap: ${o}; move one of them`), ...over.caption.map((o) => `caption overlap: ${o}; move one of them`)] }
    const real = realize(intent, base)
    if (!real.ok) return { ok: false, stage: 'layout', errors: real.errors }
    const diagram: Diagram = { ...base, connections: real.value.connections }
    const routes = computeRoutes(diagram)
    blocked = [...new Set(diagram.connections.filter((c) => routes.get(c.uid)?.blocked).map((c) => real.value.netOfWire.get(c.uid)!))].sort(naturalCompare)
    if (blocked.length) continue
    const findings = verifyDiagram(diagram, library)
    if (findings.length) return { ok: false, stage: 'layout', errors: findings.map((f) => `verify ${f.rule}: ${f.message}`) }
    return { ok: true, value: { diagram, report: readability(diagram, routes, real.value.netOfWire), intent, attempts: i + 1, netOfWire: real.value.netOfWire } }
  }
  return { ok: false, stage: 'layout', errors: [`routes blocked after ${SPACINGS.length} placements with more spacing each time: ${blocked.join(', ')}`] }
}
