// Untrusted module geometry (Astra review finding 2): a footprint, size, art or shape so large that
// covering it hole by hole would freeze the editor is refused when a sheet is loaded from a file, a
// link or the clipboard, and coverage never walks past the board's own holes even for a module that
// skipped validation.
import { describe, expect, it } from 'vitest'
import { coveredHoles } from './breadboard.ts'
import type { Diagram } from './diagram.ts'
import { MODULE_PX_MAX, type ModuleDef, validateModule } from './module.ts'
import { load } from './builtinModules.testing.ts'
import { encodePayload, openLinkPayload } from './link.ts'
import { readDiagramFile } from '../editor/files.ts'
import { CLIP_FORMAT, parseClip } from '../editor/clipboard.ts'

/** A half board with R1 seated at (30, 40), R1's embedded copy changed by `change`. */
function sheet(change: (m: Record<string, unknown>) => void) {
  const r = structuredClone(load('resistor')) as unknown as Record<string, unknown>
  change(r)
  return {
    format: 'circuitoon-diagram/1', title: 'hostile', modules: { 'breadboard-half': load('breadboard-half'), resistor: r },
    parts: [
      { uid: 'BB1', designator: 'BB1', module: 'breadboard-half', x: 0, y: 0 },
      { uid: 'R1', designator: 'R1', module: 'resistor', x: 30, y: 40, mount: { board: 'BB1' } },
    ],
    connections: [],
  }
}

const hostile: [string, (m: Record<string, unknown>) => void][] = [
  ['a huge footprint', (m) => void (m.footprint = { x: 0, y: 0, w: 1e12, h: 30 })],
  ['a footprint far off the body', (m) => void (m.footprint = { x: -1e12, y: 0, w: 10, h: 10 })],
  ['a huge size', (m) => void (m.size = { w: 1e11, h: 3 })],
  ['huge art', (m) => void (m.art = { w: 1e12, h: 40, shapes: [{ type: 'rect', x: 0, y: 0, w: 1e12, h: 40, fill: '#000' }] })],
  ['a huge art shape', (m) => void ((m.art as { shapes: unknown[] }).shapes.push({ type: 'rect', x: 0, y: 0, w: 1e12, h: 1e12, fill: '#000' }))],
  ['a long bus', (m) => void (m.pins = [...(m.pins as unknown[]), { name: 'B', side: 'top', bus: { length: 1e9 } }])],
]

/** Runs `f` and fails when it takes longer than `ms`. */
async function quick<T>(f: () => T | Promise<T>, ms = 1000): Promise<T> {
  const t = performance.now()
  const out = await f()
  expect(performance.now() - t).toBeLessThan(ms)
  return out
}

describe('hostile module geometry', () => {
  it('validateModule refuses geometry beyond the module size cap', () => {
    for (const [what, change] of hostile) {
      const m = structuredClone(load('resistor')) as unknown as Record<string, unknown>
      change(m)
      const r = validateModule(m)
      expect(r.ok, what).toBe(false)
      if (!r.ok) expect(r.errors.join('; '), what).toMatch(new RegExp(String(MODULE_PX_MAX)))
    }
  })
  it('every built-in module stays within the cap', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    for (const f of readdirSync('modules').filter((n) => n.endsWith('.json'))) expect(validateModule(JSON.parse(readFileSync(`modules/${f}`, 'utf8'))).ok, f).toBe(true)
  })
  it('a file with a hostile module is refused quickly', async () => {
    for (const [what, change] of hostile) {
      const text = JSON.stringify(sheet(change))
      const r = await quick(() => readDiagramFile(new File([text], 'hostile.circuitoon.json')))
      expect(r.ok, what).toBe(false)
    }
  })
  it('a link with a hostile module is refused quickly', async () => {
    for (const [what, change] of hostile) {
      const payload = await encodePayload(JSON.stringify(sheet(change)))
      const r = await quick(() => openLinkPayload(payload))
      expect(r.ok, what).toBe(false)
    }
  })
  it('a clipboard clip with a hostile module is refused quickly', async () => {
    for (const [what, change] of hostile) {
      const { modules, parts, connections } = sheet(change)
      const r = await quick(() => parseClip(JSON.stringify({ format: CLIP_FORMAT, modules, parts, connections, annotations: [] })))
      expect(r, what).toBe(null)
    }
  })
  it('covers only the board holes under a body that skipped validation, however large it is', async () => {
    const d = sheet((m) => void (m.footprint = { x: 0, y: 0, w: 1e9, h: 30 })) as unknown as Diagram
    const covered = await quick(() => coveredHoles(d))
    // The flat resistor's own two leg holes stay free; everything to its right on row a is under the body.
    expect(covered.length).toBeGreaterThan(0)
    expect(covered.every((c) => c.board === 'BB1' && c.by === 'R1')).toBe(true)
  })
})
