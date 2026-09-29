// layoutNetlist end to end (spec 2): a sheet the site loads, that verifies clean against its intent,
// deterministic, with routing flags, one end per hole, distribution points, capacity chains and
// internally joined pins wired as one.
import { describe, expect, it } from 'vitest'
import { type Diagram, type Endpoint, computeRoutes, resolveEndpoint, serializeDiagram, validateDiagram } from '../format/diagram.ts'
import { type Pt, type Rect, bodyRect, worldHoles } from '../format/geometry.ts'
import { isBoard, layoutModule } from '../format/module.ts'
import { annotationRect } from '../render/annotationGeometry.ts'
import { coveredHoles, mountIssues, plugsOf } from '../format/breadboard.ts'
import { libraryLookup } from './catalog.ts'
import { layoutNetlist } from './layout.ts'
import { reportText } from './readability.ts'
import { verifyDiagram } from './verify.ts'
import { divider, ledNetlist, tiltSensors, typewriter } from './fixtures.testing.ts'

const laid = (raw: unknown): Diagram => {
  const r = layoutNetlist(raw)
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.value.diagram
}
const esp = (extra: Record<string, unknown>[] = []) => ({
  format: 'circuitoon-netlist/1',
  title: 'Three sensors',
  parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'U2', module: 'bme280-module-4pin' }, { ref: 'U3', module: 'bme280-module-4pin' }, { ref: 'U4', module: 'bme280-module-4pin' }, ...extra],
  nets: [
    { name: '3V3', pins: ['U1.3V3', 'U2.VIN', 'U3.VIN', 'U4.VIN'] },
    { name: 'GND', pins: ['U1.GND', 'U2.GND', 'U3.GND', 'U4.GND'] },
    { name: 'SCL', pins: ['U1.IO22', 'U2.SCL'] },
    { name: 'SDA', pins: ['U1.IO21', 'U2.SDA'] },
  ],
})

describe('layoutNetlist', () => {
  it('names the cause when kept parts sit farther apart than the router reaches', () => {
    const r = layoutNetlist(tiltSensors(), { keep: new Map([['S_1', { x: 9000, y: 9000, rotation: 0 as const }]]) })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toMatch(/^sheet too large to route: parts span \d+ x \d+ px; keep parts within about 5000 px of each other \(nets [^)]*tilt_1\.SIG[^)]*\)\.$/)
  })
  it('lays out the spec LED example into a sheet the site loads and that verifies clean', () => {
    const r = layoutNetlist(ledNetlist())
    if (!r.ok) throw new Error(r.errors.join('\n'))
    const d = r.value.diagram
    expect(validateDiagram(JSON.parse(serializeDiagram(d))).ok).toBe(true)
    expect(verifyDiagram(d, libraryLookup)).toEqual([])
    expect(mountIssues(d)).toEqual([])
    expect(d.intent).toEqual(ledNetlist())
    expect(r.value.report).toMatchObject({ bodyOverlaps: 0, captionOverlaps: 0, blockedNets: [] })
    expect(d.connections.every((c) => c.color && c.ends?.from === 'dupont-male')).toBe(true)
    expect(reportText(r.value.report)).toMatch(/^Readability: body overlaps 0, caption overlaps 0, wire crossings \d+, wire length \d+ px, sheet \d+ x \d+ px, blocked nets none\.$/)
  })
  it('is deterministic', () => {
    expect(serializeDiagram(laid(ledNetlist()))).toBe(serializeDiagram(laid(ledNetlist())))
    expect(serializeDiagram(laid(tiltSensors()))).toBe(serializeDiagram(laid(tiltSensors())))
  })
  it('lays out the tilt sensors (a repeat on a rail strip) clean', () => {
    const r = layoutNetlist(tiltSensors())
    if (!r.ok) throw new Error(r.errors.join('\n'))
    expect(verifyDiagram(r.value.diagram, libraryLookup)).toEqual([])
    expect(r.value.report).toMatchObject({ bodyOverlaps: 0, captionOverlaps: 0, blockedNets: [] })
  })
  it("distributes a repeat block's shared net on rail strips of its own, joined to the net by one trunk wire (A18.1)", () => {
    for (const make of [tiltSensors, () => typewriter(false)]) {
      const r = layoutNetlist(make())
      if (!r.ok) throw new Error(r.errors.join('\n'))
      const d = r.value.diagram
      const refs = new Set(r.value.intent.parts.map((p) => p.ref))
      const added = d.parts.filter((p) => !refs.has(p.uid))
      expect(added.length).toBeGreaterThan(0)
      expect(added.every((p) => p.module === 'power-rail-strip')).toBe(true)
      const local = new Set(added.map((p) => p.uid))
      const copyRefs = new Set(r.value.intent.copies.flatMap((c) => c.refs))
      // Every shared-port pin (the switches' pin 2, on GND) is wired into a local strip's - rail.
      const shared = [...copyRefs].map((ref) => ({ part: ref, pin: '2' }))
      for (const pin of shared) {
        const w = d.connections.filter((c) => [c.from, c.to].some((e) => e.part === pin.part && e.pin === pin.pin))
        expect(w, `${pin.part}.${pin.pin}`).toHaveLength(1)
        const other = w[0].from.part === pin.part ? w[0].to : w[0].from
        expect(local.has(other.part), `${pin.part}.${pin.pin} to ${other.part}`).toBe(true)
        expect(other.pin).toBe('-')
        expect(w[0].routing).toBe(true)
      }
      // Nothing outside the blocks is wired into a local strip, except each block's one trunk.
      const outside = d.connections.filter((c) => {
        const ends = [c.from, c.to]
        return ends.some((e) => local.has(e.part)) && ends.some((e) => !local.has(e.part) && !copyRefs.has(e.part))
      })
      const targets = new Set(r.value.intent.copies.map((c) => Object.values(c.bindings)[0].split('.')[0]))
      expect(outside).toHaveLength(targets.size)
      expect(verifyDiagram(d, libraryLookup)).toEqual([])
      expect(r.value.report).toMatchObject({ bodyOverlaps: 0, captionOverlaps: 0, blockedNets: [] })
    }
  }, 60_000)
  it('wires a net that has only local strips: its one outside pin is the trunk, several claim a strip of their own', () => {
    /** The tilt sensors without the GND rail strip, plus `extra` parts and nets. */
    const bare = (extra: { ref: string; module: string }[], nets: { name: string; pins: string[] }[]) => {
      const n = tiltSensors()
      return { ...n, parts: [...n.parts.filter((p) => p.ref !== 'BB1'), ...extra], nets }
    }
    /** Wires with one end on a local strip and the other on a part outside the blocks. */
    const outside = (raw: unknown) => {
      const r = layoutNetlist(raw)
      if (!r.ok) throw new Error(r.errors.join('\n'))
      const d = r.value.diagram
      expect(verifyDiagram(d, libraryLookup)).toEqual([])
      const refs = new Set(r.value.intent.parts.map((p) => p.ref))
      const local = new Set(d.parts.filter((p) => !refs.has(p.uid)).map((p) => p.uid))
      expect(local.size).toBeGreaterThan(0)
      const copyRefs = new Set(r.value.intent.copies.flatMap((c) => c.refs))
      return d.connections.flatMap((c) => {
        const [a, b] = local.has(c.from.part) ? [c.from, c.to] : [c.to, c.from]
        return local.has(a.part) && !local.has(b.part) && !copyRefs.has(b.part) ? [`${b.part}.${b.pin}`] : []
      })
    }
    // One outside pin (U1's GND): its wire into the block's strip is the block's trunk.
    expect(outside(bare([], [{ name: 'GND', pins: ['U1.GND'] }]))).toEqual(['U1.GND'])
    // Two outside pins and a free strip: they share a claimed strip, which one trunk joins to the block.
    const two = [{ name: 'GND', pins: ['U1.GND', 'R1.2'] }, { name: '3V3', pins: ['U1.3V3', 'R1.1'] }]
    expect(outside(bare([{ ref: 'R1', module: 'resistor' }, { ref: 'BB9', module: 'power-rail-strip' }], two))).toEqual(['BB9.-'])
    // Two outside pins and nowhere else to put them: they go into the block's strips (the fallback).
    expect(outside(bare([{ ref: 'R1', module: 'resistor' }], two)).sort()).toEqual(['R1.2', 'U1.GND'])
  })
  it('marks what it adds for strips as routing, and wires two pins straight when nothing else is needed', () => {
    const led = laid(ledNetlist())
    for (const c of led.connections) {
      const toHole = [c.from, c.to].some((e) => e.hole !== undefined)
      expect(c.routing === true, c.uid).toBe(toHole)
    }
    const pair = laid({ ...esp(), nets: esp().nets.slice(2) })
    expect(pair.connections.map((c) => c.routing)).toEqual([undefined, undefined])
  })
  it('never puts two wire ends in one hole, nor a wire in a hole a leg fills', () => {
    for (const d of [laid(ledNetlist()), laid(tiltSensors())]) {
      const ends = d.connections.flatMap((c) => [c.from, c.to]).filter((e) => e.hole !== undefined).map((e) => `${e.part} ${e.pin} ${e.hole}`)
      expect(new Set(ends).size).toBe(ends.length)
      const legs = new Set(plugsOf(d).map((p) => `${p.board} ${p.group} ${p.hole}`))
      expect(ends.filter((e) => legs.has(e))).toEqual([])
    }
  })
  it('never puts a wire end in a hole under a mounted resistor, between its legs', () => {
    // An oracle independent of the covered-hole code: a resistor lies flat between its two legs.
    for (const d of [laid(divider()), laid(ledNetlist())]) {
      const legs = new Map<string, Pt[]>()
      for (const pl of plugsOf(d)) if (d.parts.find((p) => p.uid === pl.part)!.module === 'resistor') legs.set(pl.part, [...(legs.get(pl.part) ?? []), pl.at])
      expect(legs.size, d.title).toBeGreaterThan(0)
      const under: string[] = []
      for (const c of d.connections)
        for (const ep of [c.from, c.to]) {
          if (ep.hole === undefined) continue
          const at = resolveEndpoint(d, ep)!.end
          for (const [part, [a, b]] of legs)
            if ((a.y === b.y && at.y === a.y && at.x > Math.min(a.x, b.x) && at.x < Math.max(a.x, b.x)) || (a.x === b.x && at.x === a.x && at.y > Math.min(a.y, b.y) && at.y < Math.max(a.y, b.y)))
              under.push(`${d.title}: ${c.uid} ${ep.pin} hole ${ep.hole} under ${part}`)
        }
      expect(under).toEqual([])
    }
  })
  it('says so when a strip is full because a mounted body covers its holes (a DIP-28 across the channel)', () => {
    // The DIP-28 is drawn 100 px across: its body covers every hole of its top pins' strips but the leg's.
    const r = layoutNetlist(typewriter())
    expect(r.ok).toBe(false)
    if (r.ok) return
    const sda = r.errors.find((e) => e.startsWith('strip full: net SDA '))
    expect(sda).toMatch(/: no free hole left \(the other holes there lie under (U\d's body(, | and )?)+\)$/)
  })
  it('asks for a distribution point when a net has more ends than its pins take, and uses a rail when there is one', () => {
    const r = layoutNetlist(esp())
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.stage).toBe('layout')
      expect(r.errors.some((e) => e.startsWith('needs a distribution point: net 3V3 joins 4 pins'))).toBe(true)
    }
    const d = laid(esp([{ ref: 'RAIL1', module: 'power-rail-strip' }]))
    expect(verifyDiagram(d, libraryLookup)).toEqual([])
    expect(d.connections.filter((c) => [c.from, c.to].some((e) => e.part === 'RAIL1' && e.pin === '+')).length).toBe(4)
  })
  it('wires a net one end short through the pins a part joins inside itself (U1 GND 2), and verify stays clean', () => {
    const net = {
      format: 'circuitoon-netlist/1',
      title: 'Two sensors on one GND pin',
      parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'U2', module: 'bme280-module-4pin' }, { ref: 'U3', module: 'bme280-module-4pin' }],
      nets: [{ name: 'GND', pins: ['U1.GND', 'U2.GND', 'U3.GND'] }],
    }
    const d = laid(net)
    expect(verifyDiagram(d, libraryLookup)).toEqual([])
    const u1 = d.connections.flatMap((c) => [c.from, c.to]).filter((e) => e.part === 'U1').map((e) => e.pin).sort()
    expect(u1).toHaveLength(2)
    expect(u1[0]).toBe('GND')
    expect(['GND 2', 'GND 3']).toContain(u1[1])
  })
  it('names the joined pins it counted when a net is still too big for them', () => {
    const r = layoutNetlist(esp())
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const gnd = r.errors.find((e) => e.startsWith('needs a distribution point: net GND '))!
      expect(gnd).toContain('U1 GND 2 and U1 GND 3')
      expect(r.errors.find((e) => e.startsWith('needs a distribution point: net 3V3 '))).not.toContain('joined')
    }
  })
  it('chains through a terminal that takes two wire ends', () => {
    const d = laid({
      format: 'circuitoon-netlist/1',
      title: 'Terminal',
      modules: { 'terminal-2': { format: 'circuitoon-module/1', id: 'terminal-2', name: 'Two-wire terminal', pins: [{ name: 'T', side: 'left', type: 'passive', capacity: 2 }] } },
      parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'U2', module: 'bme280-module-4pin' }, { ref: 'X1', module: 'terminal-2' }],
      nets: [{ name: 'GND', pins: ['U1.GND', 'X1.T', 'U2.GND'] }],
    })
    expect(d.connections).toHaveLength(2)
    expect(d.connections.every((c) => [c.from, c.to].some((e) => e.part === 'X1'))).toBe(true)
    expect(verifyDiagram(d, libraryLookup)).toEqual([])
  })
  it('wires pins a part joins inside itself as one node (a charger\'s B- and 5V-)', () => {
    const d = laid({
      format: 'circuitoon-netlist/1',
      title: 'Battery board with a switch',
      parts: [{ ref: 'BT1', module: 'battery-18650-holder' }, { ref: 'U1', module: 'ip5306-usbc-module' }, { ref: 'S1', module: 'rocker-switch-kcd1' }, { ref: 'U2', module: 'esp32-devkitc-v4' }],
      nets: [
        { name: 'BAT', pins: ['BT1.+', 'U1.B+'] },
        { name: 'GND', pins: ['BT1.-', 'U1.B-', 'U1.5V-', 'U2.GND'] },
        { name: 'VSW', pins: ['U1.5V+', 'S1.1'] },
        { name: '5V', pins: ['S1.2', 'U2.5V'] },
      ],
    })
    expect(d.connections.filter((c) => c.color === 'black')).toHaveLength(2)
    expect(verifyDiagram(d, libraryLookup)).toEqual([])
  })
  it('refuses an invalid netlist at the input stage', () => {
    const r = layoutNetlist({ format: 'circuitoon-netlist/1', title: 'x', parts: [], nets: [{ name: 'A', pins: ['Q.1', 'Q.2'] }] })
    expect(r).toMatchObject({ ok: false, stage: 'input' })
  })
  it('stores the intent, so a later hand edit (moving the VCC wire onto the ground strip) is caught', () => {
    const r = layoutNetlist(ledNetlist())
    if (!r.ok) throw new Error(r.errors.join('\n'))
    const d = r.value.diagram
    const wireOf = (net: string) => d.connections.find((c) => r.value.netOfWire.get(c.uid) === net && [c.from, c.to].some((e) => e.part === 'BT1'))!
    const vcc = wireOf('VCC')
    const gnd = wireOf('GND')
    const gndHole = [gnd.from, gnd.to].find((e) => e.hole !== undefined)!
    const inStrip = [...d.connections.flatMap((c) => [c.from, c.to]), ...plugsOf(d).map((p) => ({ part: p.board, pin: p.group, hole: p.hole }))]
      .filter((e) => e.part === gndHole.part && e.pin === gndHole.pin)
      .map((e) => e.hole)
    const hole = [0, 1, 2, 3, 4].find((h) => !inStrip.includes(h))!
    vcc[vcc.from.part === 'BT1' ? 'to' : 'from'] = { part: gndHole.part, pin: gndHole.pin, hole }
    expect(verifyDiagram(d, libraryLookup).map((f) => f.rule)).toContain('merge')
  })
  // Fix round 1: a person puts D1's anode in R1's column, so LED_A needs no jumper.
  it('mounts the LED with its anode in the resistor\'s strip, so no jumper joins them', () => {
    const r = layoutNetlist(ledNetlist())
    if (!r.ok) throw new Error(r.errors.join('\n'))
    const d = r.value.diagram
    const strip = (part: string, pin: string) => plugsOf(d).find((p) => p.part === part && p.pin === pin)?.group
    expect(strip('D1', 'A')).toBeDefined()
    expect(strip('D1', 'A')).toBe(strip('R1', '2'))
    expect(d.connections.filter((c) => r.value.netOfWire.get(c.uid) === 'LED_A')).toEqual([])
  })
  // Fix round 1: a wire drawn over a hole reads as plugged in there.
  // Ruling C1: a wire may lie flat over empty holes, but never over one in use (a wire end, a leg, or
  // a hole under a part's body) of a strip it does not end in: drawn there it reads as plugged in.
  it('never runs a wire over a used hole of a strip it does not end in', () => {
    for (const raw of [ledNetlist(), tiltSensors(), esp([{ ref: 'RAIL1', module: 'power-rail-strip' }]), divider()]) {
      const r = layoutNetlist(raw)
      if (!r.ok) throw new Error(r.errors.join('\n'))
      const d = r.value.diagram
      const routes = computeRoutes(d)
      const legs = new Map(plugsOf(d).map((p) => [`${p.part} ${p.pin}`, `${p.board} ${p.group}`]))
      const stripOf = (e: Endpoint) => legs.get(`${e.part} ${e.pin}`) ?? `${e.part} ${e.pin}`
      const used = new Set([
        ...plugsOf(d).map((p) => `${p.board} ${p.group} ${p.hole}`),
        ...coveredHoles(d).map((c) => `${c.board} ${c.group} ${c.hole}`),
        ...d.connections.flatMap((c) => [c.from, c.to]).filter((e) => e.hole !== undefined).map((e) => `${e.part} ${e.pin} ${e.hole}`),
      ])
      const holes = d.parts.flatMap((p) => {
        const m = d.modules[p.module]
        return isBoard(m) ? worldHoles(p, m).flatMap((g) => g.at.flatMap((at, i) => (used.has(`${p.uid} ${g.name} ${i}`) ? [{ strip: `${p.uid} ${g.name}`, at }] : []))) : []
      })
      expect(holes.length).toBeGreaterThan(0)
      const over: string[] = []
      for (const c of d.connections) {
        const own = new Set([stripOf(c.from), stripOf(c.to)])
        const pts = routes.get(c.uid)!.points
        for (let k = 1; k < pts.length; k++) {
          const [a, b] = [pts[k - 1], pts[k]]
          for (const h of holes)
            if (!own.has(h.strip) && h.at.x >= Math.min(a.x, b.x) - 3 && h.at.x <= Math.max(a.x, b.x) + 3 && h.at.y >= Math.min(a.y, b.y) - 3 && h.at.y <= Math.max(a.y, b.y) + 3)
              over.push(`${d.title}: ${c.uid} over ${h.strip}`)
        }
      }
      expect(over).toEqual([])
    }
  })
  // Amendment A5: spare holes are released when the strips already joined have enough between them.
  it('fills three joined three-hole strips (5 free after 2 jumpers) with 5 terminals, never "strip full"', () => {
    const at = (y: number) => [[10, y], [20, y], [30, y]]
    const r = layoutNetlist({
      format: 'circuitoon-netlist/1',
      title: 'Small strips',
      modules: {
        'three-strips': {
          format: 'circuitoon-module/1',
          id: 'three-strips',
          name: 'Three short strips',
          pins: [],
          holes: [{ name: 'A', at: at(10) }, { name: 'B', at: at(30) }, { name: 'C', at: at(50) }],
          obstacle: false,
          size: { w: 4, h: 6 },
        },
      },
      parts: [{ ref: 'X1', module: 'three-strips' }, ...[1, 2, 3, 4, 5].map((i) => ({ ref: `U${i}`, module: 'bme280-module-4pin' }))],
      nets: [{ name: 'GND', pins: ['X1.A', 'X1.B', 'X1.C', 'U1.GND', 'U2.GND', 'U3.GND', 'U4.GND', 'U5.GND'] }],
    })
    if (!r.ok) throw new Error(r.errors.join('\n'))
    const d = r.value.diagram
    expect(d.connections).toHaveLength(7)
    expect(d.connections.filter((c) => c.from.part === 'X1' && c.to.part === 'X1')).toHaveLength(2)
    expect(verifyDiagram(d, libraryLookup)).toEqual([])
  })
  it('still reports "strip full" when the strips really have too few holes', () => {
    const r = layoutNetlist({
      format: 'circuitoon-netlist/1',
      title: 'Too small',
      modules: { 'one-strip': { format: 'circuitoon-module/1', id: 'one-strip', name: 'One short strip', pins: [], holes: [{ name: 'A', at: [[10, 10], [20, 10]] }], obstacle: false, size: { w: 3, h: 2 } } },
      parts: [{ ref: 'X1', module: 'one-strip' }, ...[1, 2, 3].map((i) => ({ ref: `U${i}`, module: 'bme280-module-4pin' }))],
      nets: [{ name: 'GND', pins: ['X1.A', 'U1.GND', 'U2.GND', 'U3.GND'] }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual([expect.stringMatching(/^strip full: net GND /)])
  })
  // Amendment A7: an overlap is a layout failure, not just a number in the report.
  it('fails when two kept parts overlap', () => {
    const net = { format: 'circuitoon-netlist/1', title: 'Stacked', parts: [{ ref: 'R1', module: 'resistor' }, { ref: 'R2', module: 'resistor' }], nets: [{ name: 'N', pins: ['R1.2', 'R2.1'] }] }
    const spot = { x: 100, y: 100, rotation: 0 as const }
    const r = layoutNetlist(net, { keep: new Map([['R1', spot], ['R2', spot]]) })
    expect(r).toMatchObject({ ok: false, stage: 'layout' })
    if (!r.ok) expect(r.errors.some((e) => /^body overlap: R1 and R2/.test(e))).toBe(true)
  })
})

describe('notes and wires', () => {
  /** True when any segment of `pts` passes through `r` (edges included). */
  const crosses = (pts: Pt[], r: Rect) =>
    pts.slice(1).some((b, i) => {
      const a = pts[i]
      return Math.max(a.x, b.x) >= r.x && Math.min(a.x, b.x) <= r.x + r.w && Math.max(a.y, b.y) >= r.y && Math.min(a.y, b.y) <= r.y + r.h
    })
  const bme = (near: string, text = 'The ESP32 runs from USB; its 3V3 pin powers the sensor. I2C on IO22 (SCL) and IO21 (SDA).') => ({
    format: 'circuitoon-netlist/1',
    title: 'ESP32 with a BME280',
    parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'U2', module: 'bme280-module-4pin' }],
    nets: [
      { name: '3V3', pins: ['U1.3V3', 'U2.VIN'] },
      { name: 'GND', pins: ['U1.GND', 'U2.GND'] },
      { name: 'SCL', pins: ['U1.IO22', 'U2.SCL'] },
      { name: 'SDA', pins: ['U1.IO21', 'U2.SDA'] },
    ],
    ...(near === 'Sensor' ? { groups: [{ name: 'Sensor', parts: ['U2'] }] } : {}),
    notes: [{ text, near }],
  })
  for (const near of ['U2', 'Sensor', 'U1'])
    it(`lays out an ESP32, a BME280 and a note near ${near} with no wire across the note`, () => {
      const d = laid(bme(near))
      const note = d.annotations!.find((a) => a.type === 'text')!
      // Grown by 3 px: a wire running along the note's edge hides under its outline too.
      const r0 = annotationRect(note)
      const box = { x: r0.x - 3, y: r0.y - 3, w: r0.w + 6, h: r0.h + 6 }
      for (const [uid, r] of computeRoutes(d)) expect(crosses(r!.points, box), uid).toBe(false)
    })
  it('keeps the note text exactly as the netlist gives it (wrapped only when drawn)', () => {
    const text = 'The ESP32 runs from USB; its 3V3 pin powers the sensor. I2C on IO22 (SCL) and IO21 (SDA).\nSecond line as typed.'
    const d = laid(bme('Sensor', text))
    expect(d.annotations!.find((a) => a.type === 'text')!.text).toBe(text)
  })
  for (const text of ['I2C sensor.', 'The sensor reads temperature, humidity and pressure.'])
    it(`keeps a note (${text.length} characters) off the side its target part points its pins to`, () => {
      const d = laid(bme('U2', text))
      const note = annotationRect(d.annotations!.find((a) => a.type === 'text')!)
      const u2 = d.parts.find((p) => p.uid === 'U2')!
      const body = bodyRect(u2, layoutModule(d.modules[u2.module]))
      // The BME280's pins point down: nothing of the note lies in the band straight below it.
      const below = { x: body.x, y: body.y + body.h, w: body.w, h: 10_000 }
      expect(note.x < below.x + below.w && note.x + note.w > below.x && note.y + note.h > below.y).toBe(false)
      const r0 = note
      const box = { x: r0.x - 3, y: r0.y - 3, w: r0.w + 6, h: r0.h + 6 }
      for (const [uid, r] of computeRoutes(d)) expect(crosses(r!.points, box), uid).toBe(false)
    })
})
