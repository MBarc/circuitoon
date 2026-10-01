// Layout (agent toolkit spec 2): netlist in, sheet out. Parse and check the netlist, place the parts
// (mounting included), realize the nets as wires, route them with the existing router, and when a
// route is blocked try again with more spacing, up to 3 placements; after that fail with the
// blocked nets rather than emit a sheet with blocked wires (or at once, naming the cause, when a
// wire's ends are beyond the router's reach). A body or caption overlap (only kept
// parts can cause one) fails the layout with each pair named (amendment A7), and the realized sheet
// must verify clean against its own intent before it is returned, so a kept part that shorts two
// nets through a strip is caught here. Wires are coloured by role (colors.ts). The sheet embeds its modules and stores the netlist as
// `intent`, so every later check re-verifies against it. Pure.
import { DIAGRAM_FORMAT, type Diagram, computeRoutes, moduleOf, resolveEndpoint } from '../format/diagram.ts'
import { ROUTE_REACH, withinReach } from '../format/router.ts'
import { tightFootprint, union } from './footprint.ts'
import { type Intent, type ModuleLookup, parseNetlist } from './netlist.ts'
import { libraryLookup } from './catalog.ts'
import { type KeepMap, placeParts } from './place.ts'
import { realize } from './realize.ts'
import { colorByRole } from './colors.ts'
import { type ReadabilityReport, overlaps, readability } from './readability.ts'
import { verifyDiagram } from './verify.ts'
import type { LabelMode } from './labelling.ts'
import { readabilityFindings } from './readabilityWarnings.ts'
import { naturalCompare } from './order.ts'

export const SPACINGS = [30, 60, 90]
/** The module a repeat block's local distribution strips use (amendment A18.1). */
export const RAIL_MODULE = 'power-rail-strip'
/** The module the layout's net labels use. */
export const LABEL_MODULE = 'net-label'

export interface LayoutOutput {
  diagram: Diagram
  report: ReadabilityReport
  intent: Intent
  /** Which placement succeeded, 1 to SPACINGS.length. */
  attempts: number
  netOfWire: Map<string, string>
}
export type LayoutResult = { ok: true; value: LayoutOutput } | { ok: false; stage: 'input' | 'layout'; errors: string[] }

export function layoutNetlist(raw: unknown, opts: { library?: ModuleLookup; keep?: KeepMap; labels?: LabelMode } = {}): LayoutResult {
  const mode = opts.labels ?? 'auto'
  const library = opts.library ?? libraryLookup
  const parsed = parseNetlist(raw, library)
  if (!parsed.ok) return { ok: false, stage: 'input', errors: parsed.errors }
  const intent = parsed.intent
  let blocked: string[] = []
  // With labels, a repeat block's shared nets are labels at each copy, so the block needs no local
  // rail strips (A18.1); they come back only as the fallback when a labelled try cannot be realized,
  // and always with --labels none.
  const tries = mode === 'none' ? [true] : [false, true]
  attempt: for (const [i, spacing] of SPACINGS.entries()) for (const rails of tries) {
    const placed = placeParts(intent, { spacing, keep: opts.keep, rail: rails ? library(RAIL_MODULE) : undefined })
    if (!placed.ok) return { ok: false, stage: 'layout', errors: placed.errors }
    const base: Diagram = {
      format: DIAGRAM_FORMAT,
      title: intent.title,
      modules: placed.modules,
      parts: placed.parts,
      connections: [],
      ...(placed.annotations.length ? { annotations: placed.annotations } : {}),
      intent: structuredClone(raw),
    }
    const over = overlaps(base)
    if (over.body.length || over.caption.length)
      return { ok: false, stage: 'layout', errors: [...over.body.map((o) => `body overlap: ${o}; move one of them`), ...over.caption.map((o) => `caption overlap: ${o}; move one of them`)] }
    const labelModule = library(LABEL_MODULE)
    const real = realize(intent, base, placed.locals, { labels: mode, labelModule })
    if (!real.ok) {
      if (!rails) continue
      return { ok: false, stage: 'layout', errors: real.errors }
    }
    const labelled = real.value.labels.length && labelModule
      ? { parts: [...base.parts, ...real.value.labels], modules: { ...base.modules, [LABEL_MODULE]: labelModule } }
      : {}
    const wired: Diagram = { ...base, ...labelled, connections: real.value.connections }
    // Colours by the checker's net roles, so the sheet never breaks the colour convention it checks.
    const diagram: Diagram = { ...wired, connections: colorByRole(intent, wired, real.value.netOfWire) }
    const routes = computeRoutes(diagram)
    const stuck = diagram.connections.filter((c) => routes.get(c.uid)?.blocked)
    blocked = [...new Set(stuck.map((c) => real.value.netOfWire.get(c.uid)!))].sort(naturalCompare)
    // A wire whose ends are farther apart than the router's grid can never route, and more
    // spacing only makes that worse (kept parts far apart): say so rather than retry.
    const far = stuck.filter((c) => {
      const [a, b] = [resolveEndpoint(diagram, c.from), resolveEndpoint(diagram, c.to)]
      return a && b && !withinReach(a.end, b.end)
    })
    if (far.length) {
      const span = diagram.parts.map((p) => tightFootprint(p, moduleOf(diagram, p.module)!)).reduce(union)
      const nets = [...new Set(far.map((c) => real.value.netOfWire.get(c.uid)!))].sort(naturalCompare)
      return {
        ok: false,
        stage: 'layout',
        errors: [`sheet too large to route: parts span ${Math.ceil(span.w)} x ${Math.ceil(span.h)} px; keep parts within about ${ROUTE_REACH} px of each other (nets ${nets.join(', ')}).`],
      }
    }
    if (blocked.length) continue attempt
    // Labels that found no room get another try with more spacing; the last placement wires them.
    if (real.value.unlabelled.length && i < SPACINGS.length - 1) continue attempt
    const findings = verifyDiagram(diagram, library).filter((f) => f.severity === 'error')
    if (findings.length) return { ok: false, stage: 'layout', errors: findings.map((f) => `verify ${f.rule}: ${f.message}`) }
    const report = { ...readability(diagram, routes, real.value.netOfWire), readabilityWarnings: readabilityFindings(diagram, routes).length, labels: { mode, nets: real.value.labelled, unplaced: [...new Set(real.value.unlabelled)] } }
    return { ok: true, value: { diagram, report, intent, attempts: i + 1, netOfWire: real.value.netOfWire } }
  }
  return { ok: false, stage: 'layout', errors: [`routes blocked after ${SPACINGS.length} placements with more spacing each time: ${blocked.join(', ')}`] }
}
