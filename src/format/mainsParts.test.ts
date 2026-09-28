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
