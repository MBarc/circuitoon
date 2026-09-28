// Regression test for the built-in mains parts (scripts/gen-mains-*.mjs and the relay and SSR in
// scripts/gen-outputs.mjs): contacts on the family patterns of src/format/plugging.ts, ratings,
// regions, isolation and sources. Every value was checked against the sources in each module's
// `source`; a wrong pin or rating is worse than a missing part, so any change here must be
// re-checked there.
import { describe, expect, it } from 'vitest'
import { layoutModule } from './module.ts'
import { pivot, toWorld } from './geometry.ts'
import type { Rotation } from './geometry.ts'
import { CONDUCTORS, PLUG_FAMILIES, type Conductor, type SocketFamily, mainsOf } from './mainsModel.ts'
import { PLUG_PROFILES, SOCKET_PATTERNS } from './plugging.ts'
import { specTurns } from './plugSpec.testing.ts'
import { seatOf } from './breadboard.ts'
import type { Diagram } from './diagram.ts'
import { load } from './builtinModules.testing.ts'
import { EVIDENCE } from './mainsEvidence.ts'

const twoSources = /^https?:\/\/\S+( https?:\/\/\S+)+$/

/** Each socket's holes by role, relative to the socket's centre (found from its L hole and the pattern). */
function socketOffsets(id: string): { family: SocketFamily; offsets: Record<Conductor, [number, number][]> }[] {
  const m = load(id)
  const holes = new Map((m.holes ?? []).map((h) => [h.name, h.at]))
  return mainsOf(m).sockets.map((s) => {
    const at = (c: Conductor) => s.contacts.filter((x) => x.role === c).flatMap((x) => holes.get(x.group) ?? [])
    const [[lx, ly]] = at('L')
    const [[px, py]] = SOCKET_PATTERNS[s.family].L
    const [cx, cy] = [lx - px, ly - py]
    return { family: s.family, offsets: Object.fromEntries(CONDUCTORS.map((c) => [c, at(c).map(([x, y]) => [x - cx, y - cy])])) as Record<Conductor, [number, number][]> }
  })
}

describe('built-in outlets', () => {
  const want: Record<string, { family: SocketFamily; sockets: number; volts: number; hz: number; region: string; rated: number; amps: number }> = {
    'outlet-us-5-15r-duplex': { family: 'nema-5-15r', sockets: 2, volts: 120, hz: 60, region: 'us', rated: 125, amps: 15 },
    'outlet-us-5-20r-duplex': { family: 'nema-5-20r', sockets: 2, volts: 120, hz: 60, region: 'us', rated: 125, amps: 20 },
    'outlet-uk-bs1363': { family: 'bs1363', sockets: 1, volts: 230, hz: 50, region: 'uk', rated: 250, amps: 13 },
    'outlet-schuko-cee7-3': { family: 'cee7-3', sockets: 1, volts: 230, hz: 50, region: 'eu', rated: 250, amps: 16 },
    'outlet-fr-cee7-5': { family: 'cee7-5', sockets: 1, volts: 230, hz: 50, region: 'eu', rated: 250, amps: 16 },
    'outlet-au-as3112': { family: 'as3112', sockets: 1, volts: 230, hz: 50, region: 'au', rated: 250, amps: 10 },
    'outlet-jp-1-15r-duplex': { family: 'nema-1-15r', sockets: 2, volts: 100, hz: 50, region: 'jp', rated: 125, amps: 15 },
    'outlet-jp-1-15r-duplex-polarized': { family: 'nema-1-15r-polarized', sockets: 2, volts: 100, hz: 50, region: 'jp', rated: 125, amps: 15 },
  }
  for (const [id, x] of Object.entries(want))
    it(`${id}: a board, its sockets on the family pattern, voltage, region and rating`, () => {
      const m = load(id)
      const info = mainsOf(m)
      expect(m.category).toBe('Mains')
      expect(m.obstacle).toBe(false)
      expect(m.source).toMatch(twoSources)
      const sockets = socketOffsets(id)
      expect(sockets.map((s) => s.family)).toEqual(Array(x.sockets).fill(x.family))
      for (const s of sockets) expect(s.offsets).toEqual(SOCKET_PATTERNS[x.family])
      expect((m.electrical as { params: { acVoltage: { default: number } } }).params.acVoltage.default).toBe(x.volts)
      expect([info.hz, info.region]).toEqual([x.hz, x.region])
      expect(info.acSources).toHaveLength(1)
      expect(info.ratings).toEqual([expect.objectContaining({ kind: 'terminal', service: 'ac', volts: x.rated, amps: x.amps, provenance: 'datasheet' })])
      // The standard's figures and the evidence must agree; the source is the evidence's.
      expect([EVIDENCE[id].ratings?.[0].volts, EVIDENCE[id].ratings?.[0].amps]).toEqual([x.rated, x.amps])
      expect(m.source).toBe(EVIDENCE[id].sources.join(' '))
      expect(info.ratings[0].pins.sort()).toEqual((m.holes ?? []).map((h) => h.name).sort())
      if (x.sockets === 2) expect(m.internal).toEqual([['L1', 'L2'], ['N1', 'N2'], ...(SOCKET_PATTERNS[x.family].PE.length ? [['PE1', 'PE2']] : [])])
      expect(pivot(layoutModule(m).w, layoutModule(m).h)).toEqual(x.sockets === 2 ? { x: 40, y: 70 } : { x: 40, y: 40 })
    })
})

describe('built-in plug-in devices', () => {
  // `roles`: the conducting prongs. `mechanical`: a pin that fills the earth position without carrying a
  // conductor (Ruling 39): the insulated earth pin of the class II UK charger and adapter (Mean Well NGE12
  // "Class II power (no earth pin)") and of the 2-lead UK plug (the evidence's ISOD, an insulated pin).
  const devices: Record<string, { family: (typeof PLUG_FAMILIES)[number]; roles: Conductor[]; mechanical?: boolean; converter: boolean; leads?: Conductor[] }> = {
    'charger-usb-5v-us': { family: 'nema-1-15p', roles: ['L', 'N'], converter: true },
    'charger-usb-5v-eu': { family: 'cee7-16', roles: ['L', 'N'], converter: true },
    'charger-usb-5v-uk': { family: 'bs1363', roles: ['L', 'N'], mechanical: true, converter: true },
    'charger-usb-5v-au': { family: 'as3112', roles: ['L', 'N'], converter: true },
    'adapter-barrel-us': { family: 'nema-1-15p', roles: ['L', 'N'], converter: true },
    'adapter-barrel-eu': { family: 'cee7-16', roles: ['L', 'N'], converter: true },
    'adapter-barrel-uk': { family: 'bs1363', roles: ['L', 'N'], mechanical: true, converter: true },
    'adapter-barrel-au': { family: 'as3112', roles: ['L', 'N'], converter: true },
    'plug-us-5-15p': { family: 'nema-5-15p', roles: ['L', 'N', 'PE'], converter: false, leads: ['L', 'N', 'PE'] },
    'plug-us-1-15p': { family: 'nema-1-15p-polarized', roles: ['L', 'N'], converter: false, leads: ['L', 'N'] },
    'plug-jp-1-15p': { family: 'nema-1-15p', roles: ['L', 'N'], converter: false, leads: ['L', 'N'] },
    'plug-eu-cee7-7': { family: 'cee7-7', roles: ['L', 'N', 'PE'], converter: false, leads: ['L', 'N', 'PE'] },
    'plug-eu-cee7-16': { family: 'cee7-16', roles: ['L', 'N'], converter: false, leads: ['L', 'N'] },
    'plug-uk-bs1363-3lead': { family: 'bs1363', roles: ['L', 'N', 'PE'], converter: false, leads: ['L', 'N', 'PE'] },
    'plug-uk-bs1363-2lead': { family: 'bs1363', roles: ['L', 'N'], mechanical: true, converter: false, leads: ['L', 'N'] },
    'plug-au-as3112-3lead': { family: 'as3112', roles: ['L', 'N', 'PE'], converter: false, leads: ['L', 'N', 'PE'] },
    'plug-au-as3112-2lead': { family: 'as3112', roles: ['L', 'N'], converter: false, leads: ['L', 'N'] },
  }
  /** Families whose L and N are fixed: their leads carry L and N; the others carry "line" (spec 1.4). */
  const polarized = new Set<string>(['nema-5-15p', 'nema-1-15p-polarized', 'bs1363', 'as3112'])
  const OUTLETS = ['outlet-us-5-15r-duplex', 'outlet-us-5-20r-duplex', 'outlet-uk-bs1363', 'outlet-schuko-cee7-3', 'outlet-fr-cee7-5', 'outlet-au-as3112', 'outlet-jp-1-15r-duplex', 'outlet-jp-1-15r-duplex-polarized']
  for (const [id, x] of Object.entries(devices)) {
    it(`${id}: its prongs sit on the family pattern around its pivot`, () => {
      const m = load(id)
      const info = mainsOf(m)
      expect(m.category).toBe('Mains')
      expect(m.source).toMatch(twoSources)
      expect(m.source).toBe(EVIDENCE[id].sources.join(' '))
      expect(EVIDENCE[id].verdict).toBe('VERIFIED')
      expect(info.plug?.family).toBe(x.family)
      const c = pivot(layoutModule(m).w, layoutModule(m).h)
      expect(c).toEqual(['cee7-7', 'cee7-16', 'bs1363'].includes(x.family) ? { x: 40, y: 40 } : { x: 30, y: 30 })
      expect(info.plug!.profiles.map((pr) => pr.id)).toEqual(PLUG_PROFILES[x.family].map((pr) => pr.id))
      info.plug!.profiles.forEach((pr, i) => {
        const want = CONDUCTORS.flatMap((role) => {
          const at = PLUG_PROFILES[x.family][i].contacts[role].map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy }))
          if (x.roles.includes(role)) return at.map((p) => ({ pin: `${role} prong`, at: p, mains: role }))
          if (x.mechanical && role === 'PE') return at.map((p) => ({ pin: 'E pin', at: p, mains: 'mechanical' }))
          return []
        })
        expect(pr.contacts).toEqual(want)
      })
      expect(info.internalNodes).toEqual([...x.roles.map((r) => `${r} prong`), ...(x.mechanical ? ['E pin'] : [])])
      if (x.converter) {
        expect(info.acInput).toEqual({ a: 'L prong', b: 'N prong', range: EVIDENCE[id].acInput!.value })
        expect(info.isolation).toBe(EVIDENCE[id].isolation?.value ?? 'unknown')
        expect(info.isolationProvenance).toBe('datasheet')
        expect(info.protection).toBe(EVIDENCE[id].protection!.value)
        expect(info.protection).toBe('class-2')
        expect(info.domains.map((d) => d.kind).sort()).toEqual(['mains', 'selv'])
        expect(info.domains.find((d) => d.kind === 'mains')!.pins).toEqual(['L prong', 'N prong'])
        const usb = id.startsWith('charger-')
        const pins = m.pins.flatMap((p) => ('name' in p ? [{ name: p.name, type: p.type, supply: p.supply }] : []))
        expect(pins).toEqual(usb
          ? [{ name: '5V', type: 'power_out', supply: '5V' }, { name: 'GND', type: 'ground', supply: undefined }]
          : [{ name: '+', type: 'power_out', supply: undefined }, { name: '-', type: 'ground', supply: undefined }])
        expect(info.domains.find((d) => d.kind === 'selv')!.pins).toEqual(pins.map((p) => p.name))
        const volts = (m.electrical as { params?: { voltage?: { default: number } } }).params?.voltage?.default
        expect(volts).toBe(usb ? undefined : EVIDENCE[id].output!.value.volts)
        if (usb) expect(EVIDENCE[id].output!.value.volts).toBe(5)
      } else {
        // Leads on the bottom edge, each joined to its prong (the UK L through its fuse).
        const pins = m.pins.flatMap((p) => ('name' in p ? [{ name: p.name, side: p.side, mains: p.mains }] : []))
        expect(pins).toEqual(x.leads!.map((c) => ({ name: c, side: 'bottom', mains: c === 'PE' || polarized.has(x.family) ? c : 'line' })))
        const fused = x.family === 'bs1363'
        expect(m.internal).toEqual(x.leads!.filter((c) => !(fused && c === 'L')).map((c) => [`${c} prong`, c]))
        const [r] = EVIDENCE[id].ratings!
        expect(info.ratings).toEqual([expect.objectContaining({ kind: 'terminal', service: r.service, volts: r.volts, amps: r.amps, provenance: 'datasheet' })])
        expect(info.ratings[0].pins).toEqual([...x.leads!, ...x.roles.map((c) => `${c} prong`)])
        expect(info.protection).toBeNull()
      }
      // UK cord plugs carry their BS 1362 fuse; the UK charger and adapter have none (ruling B6: Mean Well states no fuse).
      if (x.family === 'bs1363') {
        expect(info.protective).toEqual(x.converter ? [] : [{ from: 'L prong', to: 'L', kind: 'fuse', rating: null }])
        if (!x.converter) expect((m.electrical as { params: { fuseRating: { unit: string; default: number } } }).params.fuseRating).toEqual({ unit: 'A', default: EVIDENCE[id].extra!.fuse.value })
      } else expect(info.protective).toEqual([])
    })
    it(`${id}: on an outlet the spec gives no row for, no turn and no translation puts every contact on that socket's holes`, () => {
      const dm = load(id)
      for (const o of OUTLETS) {
        const om = load(o)
        // Within one geometry group the table alone decides (Resolution 7); every other pair must never land.
        const group = (f: string) => (f.startsWith('nema') ? 'nema' : f.startsWith('cee') ? 'cee' : f)
        const sf = mainsOf(om).sockets[0].family
        if (specTurns(x.family, sf).length || group(x.family) === group(sf)) continue
        // Every hole of the outlet (a duplex counts both sockets): if a pair lands across two sockets, move the second socket in the art, never the patterns.
        const holes = (om.holes ?? []).flatMap((h) => h.at)
        const on = new Set(holes.map(([hx, hy]) => `${hx},${hy}`))
        for (const rotation of [0, 90, 180, 270] as Rotation[]) {
          for (const pr of mainsOf(dm).plug!.profiles) {
            const pts = pr.contacts.map((c) => toWorld({ x: 0, y: 0, rotation }, layoutModule(dm), c.at))
            const lands = holes.some(([hx, hy]) => pts.every((q) => on.has(`${q.x + hx - pts[0].x},${q.y + hy - pts[0].y}`)))
            expect([id, o, pr.id, rotation, lands]).toEqual([id, o, pr.id, rotation, false])
          }
        }
      }
    })
    it(`${id}: seats in every built-in outlet the table allows, at exactly the allowed turns`, () => {
      for (const o of OUTLETS) {
        const om = load(o)
        const dm = load(id)
        const sockets = mainsOf(om).sockets
        // Centre the device's pivot on the outlet's first socket.
        const holes = new Map((om.holes ?? []).map((h) => [h.name, h.at]))
        const [[lx, ly]] = holes.get(sockets[0].contacts.find((c) => c.role === 'L')!.group)!
        const [[px, py]] = SOCKET_PATTERNS[sockets[0].family].L
        const dc = pivot(layoutModule(dm).w, layoutModule(dm).h)
        for (const rotation of [0, 90, 180, 270] as Rotation[]) {
          const d: Diagram = { format: 'circuitoon-diagram/1', title: 't', modules: { [om.id]: om, [dm.id]: dm }, connections: [], parts: [
            { uid: 'xs', designator: 'XS1', module: om.id, x: 0, y: 0 },
            { uid: 'xp', designator: 'XP1', module: dm.id, x: lx - px - dc.x, y: ly - py - dc.y, rotation },
          ] }
          const want = specTurns(x.family, sockets[0].family).includes(rotation)
          expect([id, o, rotation, seatOf(d, 'xp', [])?.status === 'seated']).toEqual([id, o, rotation, want])
        }
      }
    })
  }
})

describe('built-in AC-DC modules, lamp holders, fuse holder, switch and lever connectors', () => {
  /** Each side's pin names in array order (spacers left out). */
  const sides = (id: string) => {
    const out: Record<string, string[]> = {}
    for (const p of load(id).pins) if ('name' in p) (out[p.side] ??= []).push(p.name)
    return out
  }
  it('the Mean Well IRM modules are converters with a Class II (double) barrier and their stated input range', () => {
    for (const [id, out] of [['irm-03-5', '5V'], ['irm-03-3v3', '3V3'], ['irm-05-5', '5V']]) {
      const m = load(id)
      const info = mainsOf(m)
      expect(m.source).toBe(EVIDENCE[id].sources.join(' '))
      expect([info.acInput?.a, info.acInput?.b]).toEqual(['AC/L', 'AC/N'])
      expect(info.acInput?.range).toEqual(EVIDENCE[id].acInput!.value)
      expect(info.domains.find((d) => d.kind === 'selv')?.pins.sort()).toEqual(['+V', '-V'])
      expect(info.isolation).toBe('double')
      expect(EVIDENCE[id].isolation?.quote).toMatch(/Class II/)
      expect(info.protection).toBe('class-2')
      expect(m.pins.find((p) => 'name' in p && p.name === '+V')).toMatchObject({ type: 'power_out', supply: out })
      expect(m.pins.some((p) => 'name' in p && p.name === 'NC')).toBe(false)
    }
  })
  it('the IRM pins are the datasheet bottom view mirrored left to right (top view), NC left out', () => {
    // IRM-05: AC column left and DC column right from below, so DC on the left and AC on the right from above.
    const p05 = EVIDENCE['irm-05-5'].pins!.value
    expect(sides('irm-05-5')).toEqual({ left: p05.bottomViewRight, right: p05.bottomViewLeft })
    // IRM-03: AC/L, AC/N at the top left and +V, -V at the bottom right from below; mirrored, each row reads right to left.
    for (const id of ['irm-03-5', 'irm-03-3v3']) {
      const p = EVIDENCE[id].pins!.value
      expect(sides(id)).toEqual({ top: p.bottomViewTopRow.filter((n) => n !== 'NC').reverse(), bottom: [...p.bottomViewBottomRow].reverse() })
    }
  })
  it('HLK-PM01 and HLK-PM03 are converters with an AC input, a SELV output and the isolation the evidence gives (unknown)', () => {
    for (const [id, out] of [['hlk-pm01', '5V'], ['hlk-pm03', '3V3']]) {
      const m = load(id)
      const info = mainsOf(m)
      expect(m.source).toMatch(twoSources)
      expect(info.acInput?.a).toBe('AC 1')
      expect(info.acInput?.b).toBe('AC 2')
      expect(info.domains.find((d) => d.kind === 'selv')?.pins.sort()).toEqual(['+Vo', '-Vo'])
      expect(info.isolation).toBe(EVIDENCE[id].isolation?.value ?? 'unknown')
      expect(info.acInput?.range).toEqual(EVIDENCE[id].acInput!.value)
      expect(m.pins.find((p) => 'name' in p && p.name === '+Vo')).toMatchObject({ type: 'power_out', supply: out })
      // Top side view: AC 1 above AC 2 on the left end, -Vo top right, +Vo bottom right.
      expect(sides(id)).toEqual(EVIDENCE[id].pins!.value)
      expect(m.pins.filter((p) => 'name' in p && p.name.startsWith('AC')).map((p) => ('label' in p ? p.label : undefined))).toEqual(['AC', 'AC'])
    }
    expect(mainsOf(load('hlk-pm01')).isolation).toBe('unknown')
  })
  it('the lamp holders are loads with a voltage range; the E26 shell is on N, the E27 shell has no requirement (ruling B7)', () => {
    for (const id of ['lamp-holder-e26', 'lamp-holder-e27']) {
      const info = mainsOf(load(id))
      expect(info.conducts).toEqual([expect.objectContaining({ pins: ['L', 'N'], kind: 'load' })])
      expect(info.conducts[0].range).not.toBeNull()
      expect(info.conducts[0].range).toEqual(EVIDENCE[id].loadRange!.value)
      expect(info.ratings.length).toBeGreaterThan(0)
      expect(info.ratings[0]).toMatchObject({ kind: 'terminal', service: 'ac', volts: EVIDENCE[id].ratings![0].volts, provenance: 'datasheet' })
      expect(info.ratings[0].amps ?? null).toBe(EVIDENCE[id].ratings![0].amps ?? null)
      // PE only when the reference product has an earth terminal.
      expect(load(id).pins.some((p) => 'name' in p && p.name === 'PE')).toBe(!!EVIDENCE[id].extra!.earth.value)
    }
    expect([mainsOf(load('lamp-holder-e26')).requirement.get('L'), mainsOf(load('lamp-holder-e26')).requirement.get('N')]).toEqual(['L', 'N'])
    expect([mainsOf(load('lamp-holder-e27')).requirement.get('L'), mainsOf(load('lamp-holder-e27')).requirement.get('N')]).toEqual(['line', 'line'])
    expect(mainsOf(load('lamp-holder-e27')).requirement.get('PE')).toBe('PE')
    expect(mainsOf(load('lamp-holder-e26')).conducts[0].range![1]).toBeLessThan(200)
    expect(mainsOf(load('lamp-holder-e27')).conducts[0].range![0]).toBeGreaterThan(200)
    // Ruling 38: the E26 holder names its polarity hazard; the E27 holder does not.
    expect(mainsOf(load('lamp-holder-e26')).polarityHazard).toMatch(/shell/)
    expect(mainsOf(load('lamp-holder-e27')).polarityHazard).toBeNull()
  })
  it('the fuse holder is a protective edge with an unknown rating and a fitted setting', () => {
    const m = load('fuse-holder-5x20-inline')
    expect(mainsOf(m).protective).toEqual([{ from: '1', to: '2', kind: 'fuse', rating: null }])
    expect(m.electrical).toMatchObject({ params: { fuseRating: { unit: 'A' } }, settings: { fuse: ['fitted', 'absent'] } })
    expect((m.electrical as { params: { fuseRating: { default?: number } } }).params.fuseRating.default).toBeUndefined()
    const [r] = EVIDENCE['fuse-holder-5x20-inline'].ratings!
    expect(mainsOf(m).ratings).toEqual([expect.objectContaining({ pins: ['1', '2'], kind: 'terminal', service: r.service, volts: r.volts, amps: r.amps, provenance: 'datasheet' })])
    expect(m.source).toBe(EVIDENCE['fuse-holder-5x20-inline'].sources.join(' '))
  })
  it('the KCD1 rocker keeps its DC switch model and gains a contact group and a switching rating', () => {
    const m = load('rocker-switch-kcd1')
    expect(m.electrical).toMatchObject({ model: 'switch', terminals: { a: '1', b: '2' } })
    expect(mainsOf(m).contacts).toEqual([{ id: 's', kind: 'switch', poles: [{ com: '1', no: '2', nc: null }] }])
    expect(mainsOf(m).ratings[0]).toMatchObject({ kind: 'switching', service: EVIDENCE['rocker-switch-kcd1'].ratings![0].service, provenance: 'datasheet' })
    expect(mainsOf(m).ratings.map((r) => [r.volts, r.amps])).toEqual(EVIDENCE['rocker-switch-kcd1'].ratings!.map((r) => [r.volts, r.amps]))
    expect(m.source).toBe(EVIDENCE['rocker-switch-kcd1'].sources.join(' '))
  })
  it('each Wago lever connector is one node with a conditional terminal rating', () => {
    for (const [id, n] of [['wago-221-412', 2], ['wago-221-413', 3], ['wago-221-415', 5]] as const) {
      const m = load(id)
      const names = Array.from({ length: n }, (_, i) => String(i + 1))
      expect(m.internal).toEqual([names])
      expect(sides(id)).toEqual({ left: names })
      // IEC 60664 ratings say neither AC nor DC: the evidence records ac/dc and the part follows it.
      const [r] = EVIDENCE[id].ratings!
      expect(mainsOf(m).ratings[0]).toMatchObject({ kind: 'terminal', service: r.service, volts: r.volts, amps: r.amps, conditions: r.conditions, provenance: 'datasheet' })
      expect(mainsOf(m).ratings[0].conditions).toBeTruthy()
    }
  })
  it('all of them sit in the Mains group except the KCD1, which stays a switch', () => {
    for (const id of ['hlk-pm01', 'hlk-pm03', 'irm-03-5', 'irm-03-3v3', 'irm-05-5', 'lamp-holder-e26', 'lamp-holder-e27', 'fuse-holder-5x20-inline', 'wago-221-412', 'wago-221-413', 'wago-221-415'])
      expect([id, load(id).category]).toEqual([id, 'Mains'])
    expect(load('rocker-switch-kcd1').category).toBe('Switches')
  })
})

describe('built-in terminal blocks', () => {
  // The Phoenix item numbers Task 0 confirmed (plug, header), pinned here so a slip in the evidence or
  // the generator fails; if Task 0 corrected a number, this table carries the corrected one.
  const ITEMS: Record<string, Record<number, [string, string]>> = {
    mstb: { 2: ['1757019', '1757242'], 3: ['1757022', '1757255'], 4: ['1757035', '1757268'], 5: ['1757048', '1757271'], 6: ['1757051', '1757284'] },
    mc: { 2: ['1803578', '1803277'], 3: ['1803581', '1803280'], 4: ['1803594', '1803293'], 5: ['1803604', '1803303'], 6: ['1803617', '1803316'] },
  }
  for (const [series, pitch] of [['mstb', '508'], ['mc', '381']])
    for (let n = 2; n <= 6; n++)
      it(`terminal-block-${series}-${pitch}-${n}: its item numbers, n positions joined to their header pins, every Phoenix rating with its conditions`, () => {
        const id = `terminal-block-${series}-${pitch}-${n}`
        const m = load(id)
        const [plug, header] = ITEMS[series][n]
        expect(m.name).toContain(`plug ${plug}, header ${header}`)
        expect([EVIDENCE[id].extra?.plug?.value, EVIDENCE[id].extra?.header?.value]).toEqual([plug, header])
        const pos = Array.from({ length: n }, (_, i) => String(i + 1))
        expect(m.internal).toEqual(pos.map((p) => [p, `${p} pcb`]))
        const ratings = mainsOf(m).ratings
        expect(ratings.map((r) => [r.volts, r.amps, r.conditions])).toEqual(EVIDENCE[id].ratings!.map((r) => [r.volts, r.amps ?? null, r.conditions ?? null]))
        expect(ratings.length).toBeGreaterThan(0)
        // IEC 60664 ratings say neither AC nor DC: the evidence records ac/dc and the part follows it.
        for (const r of ratings) expect(r).toMatchObject({ kind: 'terminal', service: EVIDENCE[id].ratings![0].service, provenance: 'datasheet' })
        expect(ratings.every((r) => r.conditions)).toBe(true)
        expect([m.category, m.source]).toEqual(['Mains', EVIDENCE[id].sources.join(' ')])
      })
  it('no MC 1,5 rating covers 230 V without a condition, so an MC block on 230 V is always conditional', () => {
    for (let n = 2; n <= 6; n++) for (const r of mainsOf(load(`terminal-block-mc-381-${n}`)).ratings) expect(r.volts >= 230 ? r.conditions : 'below').toBeTruthy()
    for (let n = 2; n <= 6; n++) expect(mainsOf(load(`terminal-block-mc-381-${n}`)).ratings.filter((r) => r.volts >= 230).map((r) => r.conditions)).toEqual([expect.stringMatching(/overvoltage category II,/)])
  })
  for (const id of ['terminal-block-kf2edg-508-2', 'terminal-block-kf2edg-508-3', 'terminal-block-kf301-500-2', 'terminal-block-kf301-500-3'])
    it(`${id}: a clone with a rating, and that rating unverified`, () => {
      const ratings = mainsOf(load(id)).ratings
      expect(ratings.length).toBeGreaterThan(0)
      expect(ratings.every((r) => r.provenance === 'unverified')).toBe(true)
      expect(ratings[0].volts).toBe(EVIDENCE[id].ratings![0].volts)
      expect(ratings[0].amps).toBe(EVIDENCE[id].ratings![0].amps)
    })
})
