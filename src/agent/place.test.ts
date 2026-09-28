// Placement (spec 2.1 and 2.2): grid, determinism, mounts that seat without strip merges, no body or
// caption overlaps, frames, notes, tiled copies and kept positions.
import { describe, expect, it } from 'vitest'
import { DIAGRAM_FORMAT, type Diagram, type PartInstance } from '../format/diagram.ts'
import { mountIssues, plugsOf } from '../format/breadboard.ts'
import { bodyRect, worldHoles } from '../format/geometry.ts'
import { layoutModule } from '../format/module.ts'
import { annotationRect } from '../render/annotationGeometry.ts'
import { libraryLookup } from './catalog.ts'
import { parseNetlist, terminalKey, type Intent } from './netlist.ts'
import { placeParts, type KeepMap } from './place.ts'
import { mountPart } from './mount.ts'
import { intersects, tightFootprint, union } from './footprint.ts'
import { overlaps } from './readability.ts'
import { ledNetlist, tiltSensors, typewriter } from './fixtures.testing.ts'

const intentOf = (raw: unknown): Intent => {
  const r = parseNetlist(raw, libraryLookup)
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.intent
}
const place = (raw: unknown, keep?: KeepMap, rail = false) => {
  const intent = intentOf(raw)
  const r = placeParts(intent, { spacing: 20, keep, ...(rail ? { rail: libraryLookup('power-rail-strip') } : {}) })
  if (!r.ok) throw new Error(r.errors.join('\n'))
  const d: Diagram = { format: DIAGRAM_FORMAT, title: intent.title, modules: r.modules, parts: r.parts, connections: [] }
  return { intent, annotations: r.annotations, d, locals: r.locals }
}
const noOverlaps = (d: Diagram) => {
  const fp = (p: PartInstance) => tightFootprint(p, d.modules[p.module])
  for (const a of d.parts)
    for (const b of d.parts) {
      if (a === b || a.mount?.board === b.uid || b.mount?.board === a.uid) continue
      expect(intersects(fp(a), fp(b)), `${a.uid} overlaps ${b.uid}`).toBe(false)
    }
}

describe('placeParts', () => {
  it('places the LED example on the 10 px grid, the same way every time', () => {
    const a = place(ledNetlist())
    const b = place(ledNetlist())
    expect(a.d.parts).toEqual(b.d.parts)
    for (const p of a.d.parts) {
      expect(p.x % 10).toBe(0)
      expect(p.y % 10).toBe(0)
    }
  })
  it('seats R1 and D1 on BB1, and no strip holds legs of two nets', () => {
    const { intent, d } = place(ledNetlist())
    expect(mountIssues(d)).toEqual([])
    expect(d.parts.filter((p) => p.mount?.board === 'BB1').map((p) => p.uid).sort()).toEqual(['D1', 'R1'])
    const netOf = new Map<string, string>()
    intent.nets.forEach((n) => n.terminals.forEach((t) => netOf.set(terminalKey(t.ref, t.name), n.name)))
    const strips = new Map<string, Set<string>>()
    for (const pl of plugsOf(d)) {
      const k = `${pl.board} ${pl.group}`
      strips.set(k, (strips.get(k) ?? new Set<string>()).add(netOf.get(terminalKey(pl.part, pl.pin)) ?? `none ${pl.part}.${pl.pin}`))
    }
    for (const [strip, nets] of strips) expect(nets.size, strip).toBe(1)
  })
  it('keeps bodies and captions apart: mounted parts overlap only their own board', () => {
    noOverlaps(place(ledNetlist()).d)
    noOverlaps(place(tiltSensors()).d)
  })
  it('seats a DIP-28 across the centre channel (turned 90 degrees)', () => {
    const { d } = place({
      format: 'circuitoon-netlist/1', title: 'Expander',
      parts: [{ ref: 'BB1', module: 'breadboard-half' }, { ref: 'U1', module: 'mcp23017-dip28', on: 'BB1' }],
      nets: [{ name: 'GND', pins: ['U1.VSS', 'BB1.top-'] }, { name: '3V3', pins: ['U1.VDD', 'BB1.top+'] }],
    })
    expect(d.parts.find((p) => p.uid === 'U1')!.rotation).toBe(90)
    expect(mountIssues(d)).toEqual([])
    // Every strip holds legs of one net, and a leg in top- or top+ is on the net that names it.
    const named: Record<string, string> = { 'top-': 'GND', 'top+': '3V3' }
    const netOf = new Map([['U1.VSS', 'GND'], ['U1.VDD', '3V3']])
    const strips = new Map<string, Set<string>>()
    const plugs = plugsOf(d).filter((pl) => pl.part === 'U1')
    expect(plugs).toHaveLength(28)
    for (const pl of plugs) {
      const net = netOf.get(`U1.${pl.pin}`) ?? `none U1.${pl.pin}`
      strips.set(pl.group, (strips.get(pl.group) ?? new Set<string>()).add(net))
      if (named[pl.group]) expect(net, `U1.${pl.pin} in ${pl.group}`).toBe(named[pl.group])
    }
    for (const [strip, nets] of strips) expect(nets.size, strip).toBe(1)
  })
  it('fails naming the part and the reason when no position on its board fits', () => {
    const r = placeParts(
      intentOf({
        format: 'circuitoon-netlist/1', title: 'Too wide',
        parts: [{ ref: 'BB1', module: 'breadboard-full' }, { ref: 'U1', module: 'esp32-devkit-v1-30', on: 'BB1' }],
        nets: [{ name: 'G', pins: ['U1.GND', 'BB1.top-'] }],
      }),
      { spacing: 20 },
    )
    expect(r).toEqual({ ok: false, errors: ['BB1 has no place for U1 (esp32-devkit-v1-30): no position puts every leg on a free hole.'] })
  })
  it('frames a group and puts its note below it, clear of every part', () => {
    const { d, annotations } = place({ ...ledNetlist(), groups: [{ name: 'Power', parts: ['BT1'] }], notes: [{ text: 'Two AA cells give 3 V.', near: 'Power' }] })
    const frame = annotations.find((a) => a.type === 'frame')!
    expect(frame.label).toBe('Power')
    const bt = d.parts.find((p) => p.uid === 'BT1')!
    const body = bodyRect(bt, layoutModule(d.modules[bt.module]))
    expect(body.x >= frame.x && body.y >= frame.y && body.x + body.w <= frame.x + frame.w! && body.y + body.h <= frame.y + frame.h!).toBe(true)
    const note = annotations.find((a) => a.type === 'text')!
    expect(note.y).toBeGreaterThan(frame.y)
    for (const p of d.parts) expect(intersects(annotationRect(note), tightFootprint(p, d.modules[p.module])), p.uid).toBe(false)
  })
  it('tiles repeat copies as one block with a labelled frame per copy', () => {
    const { annotations } = place(tiltSensors())
    expect(annotations.filter((a) => a.type === 'frame').map((a) => a.label)).toEqual(['tilt 1', 'tilt 2', 'tilt 3', 'tilt 4', 'tilt 5', 'tilt 6', 'tilt 7', 'tilt 8'])
  })
  it('places each repeat copy beside the part its bindings target, ordered by channel (amendment A15)', () => {
    const { intent, d } = place(typewriter())
    const at = new Map(d.parts.map((p) => [p.uid, tightFootprint(p, d.modules[p.module])]))
    const centre = (ref: string) => {
      const r = at.get(ref)!
      return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
    }
    // Each copy sits, on average, nearer its own expander than the others; the first block
    // settled (U2's) is nearest U2. Every block nearest its own target is checked below (A18.2).
    const units = ['U2', 'U3', 'U4']
    let own = 0
    let other = 0
    for (const c of intent.copies) {
      const target = c.bindings.CH.split('.')[0]
      for (const u of units) {
        const dd = Math.hypot(centre(u).x - centre(c.refs[0]).x, centre(u).y - centre(c.refs[0]).y)
        if (u === target) own += dd
        else other += dd / 2
      }
    }
    expect(own).toBeLessThan(other)
    const blockOf = (u: string) => intent.copies.filter((c) => c.bindings.CH.startsWith(`${u}.`)).flatMap((c) => c.refs.map(centre))
    const mine = blockOf('U2')
    const mid = { x: mine.reduce((s, p) => s + p.x, 0) / mine.length, y: mine.reduce((s, p) => s + p.y, 0) / mine.length }
    const dist = (ref: string) => Math.hypot(centre(ref).x - mid.x, centre(ref).y - mid.y)
    expect(dist('U2')).toBeLessThan(Math.min(dist('U3'), dist('U4')))
    // Within one expander, the copies run in channel order: reading order (top to bottom, then left to right) follows GPA0..GPB7.
    const u2 = intent.copies.filter((c) => c.bindings.CH.startsWith('U2.'))
    const reading = [...u2].sort((a, b) => {
      const [pa, pb] = [at.get(a.refs[0])!, at.get(b.refs[0])!]
      return pa.y - pb.y || pa.x - pb.x
    })
    expect(reading.map((c) => c.bindings.CH)).toEqual(u2.map((c) => c.bindings.CH))
    noOverlaps(d)
  })
  it('gives each repeat block rail strips of its own under its rows, for its shared ground (A18.1)', () => {
    const { intent, d, locals } = place(typewriter(), undefined, true)
    const gnd = intent.nets.findIndex((n) => n.name === 'GND')
    // One distribution point per block (U2, U3, U4), all on GND's - rails.
    expect(locals.map((l) => [l.net, l.rail])).toEqual([[gnd, '-'], [gnd, '-'], [gnd, '-']])
    const strips = d.parts.filter((p) => p.module === 'power-rail-strip')
    expect(strips.map((p) => p.uid).sort()).toEqual(locals.flatMap((l) => l.strips).sort())
    const fp = (ref: string) => {
      const p = d.parts.find((q) => q.uid === ref)!
      return tightFootprint(p, d.modules[p.module])
    }
    for (const p of strips) {
      expect([p.x % 10, p.y % 10, p.rotation]).toEqual([0, 0, 180])
      // Turned so the - rail is on top, facing the copies above it.
      const holes = worldHoles(p, d.modules[p.module])
      expect(holes.find((g) => g.name === '-')!.at[0].y).toBeLessThan(holes.find((g) => g.name === '+')!.at[0].y)
    }
    for (const l of locals) {
      // Enough holes: 21 pins per strip, 4 holes spare for the chain and trunk jumpers.
      expect(l.strips.length * 21).toBeGreaterThanOrEqual(l.refs.length)
      // Each strip lies within its block's span, below some copy of the block.
      const span = l.refs.map(fp).reduce(union)
      for (const ref of l.strips) {
        const t = fp(ref)
        expect(t.x >= span.x && t.x + t.w <= span.x + span.w, ref).toBe(true)
        expect(l.refs.some((r) => fp(r).y + fp(r).h < t.y), ref).toBe(true)
      }
    }
    noOverlaps(d)
  })
  it('reserves room for each block beside its own target before the next board is placed (A18.2)', () => {
    for (const rail of [false, true]) {
      const { intent, d } = place(typewriter(), undefined, rail)
      const centre = (refs: string[]) => {
        const r = refs.map((ref) => {
          const p = d.parts.find((q) => q.uid === ref)!
          return tightFootprint(p, d.modules[p.module])
        }).reduce(union)
        return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
      }
      const targets = ['U2', 'U3', 'U4']
      for (const u of targets) {
        const block = centre(intent.copies.filter((c) => c.bindings.CH.startsWith(`${u}.`)).flatMap((c) => c.refs))
        const dist = (t: string) => Math.hypot(centre([t]).x - block.x, centre([t]).y - block.y)
        for (const other of targets) if (other !== u) expect(dist(u), `${u}'s block (rail ${rail}) nearer ${u} than ${other}`).toBeLessThan(dist(other))
      }
    }
  })
  it('adds no local strips without the rail module, and leaves a kept copy out of its block (A18.1)', () => {
    expect(place(typewriter()).locals).toEqual([])
    expect(place(tiltSensors(), undefined, true).locals.map((l) => l.refs.length)).toEqual([8])
    // A kept copy stays where it was, outside the block, so its pins use the net's own strips.
    const kept = place(tiltSensors(), new Map([['S_1', { x: 9000, y: 9000, rotation: 0 as const }]]), true)
    expect(kept.locals).toHaveLength(1)
    expect(kept.locals[0].refs).not.toContain('S_1')
  })
  it('keeps a kept part exactly where it was and places the rest around it', () => {
    const { d } = place(ledNetlist(), new Map([['BT1', { x: 600, y: 300, rotation: 0 as const }]]))
    expect(d.parts.find((p) => p.uid === 'BT1')).toMatchObject({ x: 600, y: 300, rotation: 0 })
    expect(mountIssues(d)).toEqual([])
    noOverlaps(d)
  })
  it('keeps a kept repeat member where it was (amendment A6) and tiles the others around it', () => {
    const { d, annotations } = place(tiltSensors(), new Map([['S_1', { x: 9000, y: 9000, rotation: 0 as const }]]))
    expect(d.parts.find((p) => p.uid === 'S_1')).toMatchObject({ x: 9000, y: 9000, rotation: 0 })
    expect(annotations.filter((a) => a.type === 'frame')).toHaveLength(8)
    noOverlaps(d)
  })
  it('keeps kept mounted parts exactly where they were on a kept board', () => {
    const first = place(ledNetlist()).d
    const keep: KeepMap = new Map()
    for (const uid of ['BB1', 'R1', 'D1']) {
      const p = first.parts.find((q) => q.uid === uid)!
      keep.set(uid, { x: p.x + 200, y: p.y + 100, rotation: p.rotation ?? 0 })
    }
    const { d } = place(ledNetlist(), keep)
    for (const [uid, k] of keep) expect(d.parts.find((p) => p.uid === uid), uid).toMatchObject(k)
    expect(mountIssues(d)).toEqual([])
    noOverlaps(d)
  })
  it('refuses a kept mounted part that is not seated there, rather than moving it', () => {
    const r = placeParts(intentOf(ledNetlist()), {
      spacing: 20,
      keep: new Map([['BB1', { x: 0, y: 0, rotation: 0 as const }], ['R1', { x: 5, y: 5, rotation: 0 as const }]]),
    })
    expect(r).toEqual({ ok: false, errors: ['R1 is kept at (5, 5) but is not seated on BB1 there (partial).'] })
  })
  it('keeps a kept group member where it was and lays the rest of the group around it', () => {
    const raw = { ...ledNetlist(), parts: [...ledNetlist().parts, { ref: 'R2', module: 'resistor' }], nc: ['R2.1', 'R2.2'], groups: [{ name: 'Power', parts: ['BT1', 'R2'] }] }
    const { d, annotations } = place(raw, new Map([['R2', { x: 900, y: 700, rotation: 90 as const }]]))
    expect(d.parts.find((p) => p.uid === 'R2')).toMatchObject({ x: 900, y: 700, rotation: 90 })
    expect(annotations.find((a) => a.type === 'frame')!.label).toBe('Power')
    noOverlaps(d)
  })
  it('ignores a kept position for a ref the intent lacks: content still moves to the sheet origin', () => {
    const plain = place(ledNetlist())
    const stale = place(ledNetlist(), new Map([['ZZ9', { x: 5000, y: 5000, rotation: 0 as const }]]))
    expect(stale.d.parts).toEqual(plain.d.parts)
    expect(stale.annotations).toEqual(plain.annotations)
  })
  it('refuses more than one repeat block with a clear error', () => {
    const intent = intentOf(tiltSensors())
    const two: Intent = { ...intent, copies: intent.copies.map((c, i) => (i < 4 ? c : { ...c, repeat: 'tilt2' })) }
    expect(placeParts(two, { spacing: 20 })).toEqual({ ok: false, errors: ['Placement handles one repeat block, but the intent has 2 (tilt, tilt2).'] })
  })
  it('refuses a kept mounted part that joins two nets in one strip, rather than moving it', () => {
    const first = place(ledNetlist()).d
    const at = (uid: string) => first.parts.find((q) => q.uid === uid)!
    const r1 = at('R1')
    const bb = at('BB1')
    // D1 kept one row below R1, so its legs share R1's strips. Kept parts seat in natural order: D1
    // first, then R1, whose VCC leg lands in a strip D1's LED_A or GND leg already holds.
    const keep: KeepMap = new Map([
      ['BB1', { x: bb.x, y: bb.y, rotation: 0 as const }],
      ['R1', { x: r1.x, y: r1.y, rotation: r1.rotation ?? 0 }],
      ['D1', { x: r1.x, y: r1.y + 10, rotation: r1.rotation ?? 0 }],
    ])
    const r = placeParts(intentOf(ledNetlist()), { spacing: 20, keep })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toHaveLength(1)
    if (!r.ok) expect(r.errors[0]).toMatch(/^R1 is kept at \(\d+, \d+\) on BB1 but joins two different nets in strip \S+ there\.$/)
    if (!r.ok) expect(r.errors[0].startsWith(`R1 is kept at (${r1.x}, ${r1.y}) on BB1`)).toBe(true)
  })
  it('refuses a kept mounted part whose board is not kept', () => {
    const r = placeParts(intentOf(ledNetlist()), { spacing: 20, keep: new Map([['D1', { x: 100, y: 40, rotation: 0 as const }]]) })
    expect(r).toEqual({ ok: false, errors: ["D1 is kept but its board BB1 is not: keep BB1 too, or drop D1's position."] })
  })
})

describe('mountPart', () => {
  const intent = intentOf(ledNetlist())
  const board: PartInstance = { uid: 'BB1', designator: 'BB1', module: 'breadboard-half', x: 0, y: 0 }
  const resistor: PartInstance = { uid: 'R1', designator: 'R1', module: 'resistor', x: 0, y: 0 }
  const sheet = (): Diagram => ({ format: DIAGRAM_FORMAT, title: '', modules: intent.modules, parts: [board, resistor], connections: [] })
  it('only tries grid positions, so an LED seats (amendment A1)', () => {
    const d: Diagram = { ...sheet(), parts: [board, { uid: 'D1', designator: 'D1', module: 'led', x: 0, y: 0 }] }
    const r = mountPart(d, 'D1', 'BB1', () => undefined)
    expect(r.ok).toBe(true)
    if (r.ok) expect([r.part.x % 10, r.part.y % 10]).toEqual([0, 0])
  })
  it("never seats a part where its body or caption covers the board's own caption", () => {
    // An LED at (150, 190) is seated in the bottom+ rail, its caption over BB1's. The rail carries
    // its legs' net and the spot is preferred, so only the caption check can turn it down.
    const led: PartInstance = { uid: 'D1', designator: 'D1', module: 'led', x: 150, y: 190, rotation: 0, mount: { board: 'BB1' } }
    const d: Diagram = { ...sheet(), parts: [board, led] }
    expect(mountIssues(d)).toEqual([])
    expect(plugsOf(d).map((pl) => pl.group)).toEqual(['bottom+', 'bottom+'])
    expect(overlaps(d).caption).toEqual(['BB1 caption and D1 caption'])
    const netOf = (part: string, pin: string) => (part === 'D1' || pin === 'bottom+' ? 1 : undefined)
    const r = mountPart(d, 'D1', 'BB1', netOf, led)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect([r.part.x, r.part.y]).not.toEqual([150, 190])
    expect(overlaps({ ...d, parts: [board, r.part] }).caption).toEqual([])
  })
  it('treats a strip the netlist puts in a net as carrying that net before any leg lands', () => {
    const groups = intent.modules['breadboard-half'].holes!.map((g) => g.name)
    const netOf = (legs: Record<string, number>) => (part: string, pin: string) =>
      part === 'BB1' && groups.includes(pin) ? 7 : part === 'R1' ? legs[pin] : undefined
    expect(mountPart(sheet(), 'R1', 'BB1', netOf({ '1': 7, '2': 7 })).ok).toBe(true)
    expect(mountPart(sheet(), 'R1', 'BB1', netOf({ '1': 7, '2': 8 }))).toEqual({
      ok: false,
      error: 'BB1 has no place for R1 (resistor): every position where its legs fit would join two different nets in one strip.',
    })
  })
})
