// Regression test for the built-in mains parts (scripts/gen-mains-*.mjs and the relay and SSR in
// scripts/gen-outputs.mjs): contacts on the family patterns of src/format/plugging.ts, ratings,
// regions, isolation and sources. Every value was checked against the sources in each module's
// `source`; a wrong pin or rating is worse than a missing part, so any change here must be
// re-checked there.
import { describe, expect, it } from 'vitest'
import { layoutModule } from './module.ts'
import { pivot } from './geometry.ts'
import { CONDUCTORS, type Conductor, type SocketFamily, mainsOf } from './mainsModel.ts'
import { SOCKET_PATTERNS } from './plugging.ts'
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
