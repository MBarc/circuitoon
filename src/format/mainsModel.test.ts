// The mains fields of the module format (spec sections 1 and 2): every field validated with the
// exact path of each problem, and `mainsOf` reading a valid module.
import { describe, expect, it } from 'vitest'
import { validateModule } from './module.ts'
import { isolationAdequate, mainsOf, uncoveredPins } from './mainsModel.ts'

const base = { format: 'circuitoon-module/1', id: 'thing', name: 'Thing' }
const errs = (raw: unknown) => {
  const r = validateModule(raw)
  return r.ok ? [] : r.errors
}
const two = [{ name: 'A', side: 'left' }, { name: 'B', side: 'right' }]

describe('mains fields: validation', () => {
  it('accepts an outlet: a board with sockets, a source, a voltage and a region', () => {
    expect(errs({
      ...base, pins: [], size: { w: 6, h: 6 }, obstacle: false,
      holes: [{ name: 'N', at: [[20, 20]] }, { name: 'L', at: [[40, 20]] }, { name: 'PE', at: [[30, 40]] }],
      electrical: {
        params: { acVoltage: { unit: 'VAC', default: 120 } }, ac: { hz: 60, region: 'us' },
        acSources: [{ id: 'supply', live: ['L'], neutral: ['N'], earth: ['PE'] }],
        sockets: [{ id: 'main', family: 'nema-5-15r', contacts: [{ group: 'L', role: 'L' }, { group: 'N', role: 'N' }, { group: 'PE', role: 'PE' }] }],
      },
    })).toEqual([])
  })
  it('names each problem in acSources, ac and sockets', () => {
    expect(errs({
      ...base, pins: two,
      electrical: {
        acSources: [{ id: 's', live: ['X'], neutral: [] }],
        ac: { hz: 0, region: 'mars' },
        sockets: [{ id: 'a', family: 'nema-9', contacts: [{ group: 'A', role: 'L' }] }],
      },
    })).toEqual([
      'electrical.acSources[0].live[0]: no pin, hole group or internal node named "X"',
      'electrical.acSources[0].neutral: must be a list of 1 or more terminal names',
      'electrical.acSources: needs an acVoltage param (electrical.params.acVoltage), the source voltage',
      'electrical.ac: must be { "hz": <above 0>, "region": one of "us", "jp", "eu", "uk", "au" }',
      'electrical.sockets: only a board (hole groups and "obstacle": false) has sockets',
      'electrical.sockets[0].family: must be one of "nema-5-15r", "nema-5-20r", "nema-1-15r", "nema-1-15r-polarized", "cee7-3", "cee7-5", "cee7-16", "bs1363", "as3112"',
      'electrical.sockets[0].contacts[0].group: no hole group named "A"',
      'electrical.sockets[0].contacts: needs an L and an N contact',
    ])
  })
  it('names each problem in conducts, protective, domains, isolation, acInput and ratings', () => {
    expect(errs({
      ...base, pins: two,
      electrical: {
        conducts: [{ pins: ['A', 'A'], kind: 'wire' }],
        protective: [{ from: 'A', to: 'C', kind: 'breaker', rating: 0 }],
        domains: [{ name: 'm', pins: ['A'], kind: 'mains' }, { name: 'o', pins: ['A'], kind: 'lv' }],
        isolation: 'good', safeguard: 'glue',
        acInput: { a: 'A', b: 'A', range: [240, 100] },
        ratings: [{ pins: ['A'], kind: 'contact', service: 'rf', volts: -1, provenance: 'guess' }],
      },
    })).toEqual([
      'electrical.conducts[0].pins: must be two different terminal names',
      'electrical.conducts[0].kind: must be "load" or "leakage"',
      'electrical.protective[0].to: no pin, hole group or internal node named "C"',
      'electrical.protective[0].kind: must be "fuse"',
      'electrical.protective[0].rating: must be a number of amps, above 0, up to 100',
      'electrical.domains[1].kind: must be "mains", "selv" or "pelv"',
      'electrical.domains[1].pins: "A" is already in domain "m"',
      'electrical.isolation: must be one of "reinforced", "double", "basic", "none", "unknown"',
      'electrical.safeguard: must be "protective-screen"',
      'electrical.acInput: a and b must differ',
      'electrical.acInput.range: must be [min, max] in volts AC, from 1 to 1000, min not above max',
      'electrical.ratings[0].kind: must be "insulation", "terminal" or "switching"',
      'electrical.ratings[0].service: must be "ac", "dc" or "ac/dc"',
      'electrical.ratings[0].volts: must be a number above 0',
      'electrical.ratings[0].provenance: must be "datasheet" or "unverified"',
    ])
  })
  it('names each problem in contacts, protection, plug, pin requirements and internal nodes', () => {
    expect(errs({
      ...base, pins: [{ name: 'A', side: 'left', mains: 'hot', bond: 'earth' }, { name: 'B', side: 'right' }],
      electrical: {
        internalNodes: ['B', 'L prong'],
        contacts: [{ id: 'k', kind: 'ssr', poles: [{ com: 'A', nc: 'B' }] }, { id: 'k', kind: 'valve', poles: [] }],
        protection: 'class-1',
        plug: { family: 'nema-5-15p', profiles: [{ id: 'main', contacts: [{ pin: 'A', at: { x: 5, y: 0 }, mains: 'line' }] }] },
      },
    })).toEqual([
      'pins[0].mains: must be one of "L", "N", "PE", "line"',
      'pins[0].bond: must be "pe"',
      'electrical.internalNodes[0]: duplicate name "B" (pins, hole groups and internal nodes share one namespace)',
      'electrical.contacts[0].poles[0]: an SSR pole has "no" only (its OFF state is a leakage path)',
      'electrical.contacts[1].id: duplicate "k"',
      'electrical.contacts[1].kind: must be "switch", "relay" or "ssr"',
      'electrical.contacts[1].poles: must be a list of 1 or more { "com", "no"?, "nc"? }',
      'electrical.protection: a class 1 part needs a terminal marked "mains": "PE"',
      'electrical.plug.profiles[0].contacts[0].pin: must name an internal node (electrical.internalNodes), the prong',
      'electrical.plug.profiles[0].contacts[0].at: must be { "x", "y" } on the 10 px grid',
      'electrical.plug.profiles[0].contacts[0].mains: must be "L", "N" or "PE"',
    ])
  })
  it('keeps plug contacts inside the body', () => {
    expect(errs({
      ...base, pins: two, size: { w: 4, h: 4 },
      electrical: { internalNodes: ['L prong'], plug: { family: 'nema-1-15p', profiles: [{ id: 'main', contacts: [{ pin: 'L prong', at: { x: 90, y: 10 }, mains: 'L' }] }] } },
    })).toEqual(['electrical.plug.profiles[0].contacts[0].at: outside the body (0 to 40, 0 to 40)'])
  })
})

describe('mainsOf', () => {
  it('reads a converter: its input, domains, isolation and which terminals are declared', () => {
    const m = validateModule({
      ...base, pins: [{ name: 'AC1', side: 'left', mains: 'line' }, { name: 'AC2', side: 'left', mains: 'line' }, { name: '+V', side: 'right', type: 'power_out', supply: '5V' }, { name: '-V', side: 'right', type: 'ground' }],
      electrical: {
        acInput: { a: 'AC1', b: 'AC2', range: [100, 240] },
        domains: [{ name: 'mains', pins: ['AC1', 'AC2'], kind: 'mains' }, { name: 'out', pins: ['+V', '-V'], kind: 'selv' }],
        isolation: 'reinforced', protection: 'class-2',
      },
    })
    if (!m.ok) throw new Error(m.errors.join('; '))
    const info = mainsOf(m.module)
    expect(info.any).toBe(true)
    expect(info.acInput).toEqual({ a: 'AC1', b: 'AC2', range: [100, 240] })
    expect([...info.terminals].sort()).toEqual(['AC1', 'AC2'])
    expect([...info.declaredConduction].sort()).toEqual(['AC1', 'AC2'])
    expect(info.domainOf.get('+V')?.kind).toBe('selv')
    expect(isolationAdequate(info)).toBe(true)
    expect(mainsOf(m.module)).toBe(info)
  })
  it('counts basic isolation as protective separation only with a protective screen', () => {
    const info = (isolation: string, safeguard?: string) => {
      const r = validateModule({ ...base, pins: two, electrical: { domains: [{ name: 'm', pins: ['A'], kind: 'mains' }, { name: 'o', pins: ['B'], kind: 'selv' }], isolation, ...(safeguard ? { safeguard } : {}) } })
      if (!r.ok) throw new Error(r.errors.join('; '))
      return isolationAdequate(mainsOf(r.module))
    }
    expect(info('double')).toBe(true)
    expect(info('basic')).toBe(false)
    expect(info('basic', 'protective-screen')).toBe(true)
    expect(info('unknown')).toBe(false)
  })
  it('names the pins a converter leaves outside every domain', () => {
    const r = validateModule({
      ...base, pins: [{ name: 'AC1', side: 'left', mains: 'line' }, { name: 'AC2', side: 'left', mains: 'line' }, { name: '+V', side: 'right', type: 'power_out', supply: '5V' }, { name: '-V', side: 'right', type: 'ground' }],
      electrical: { acInput: { a: 'AC1', b: 'AC2', range: [100, 240] }, domains: [{ name: 'mains', pins: ['AC1', 'AC2'], kind: 'mains' }], isolation: 'reinforced' },
    })
    if (!r.ok) throw new Error(r.errors.join('; '))
    expect(uncoveredPins(r.module, mainsOf(r.module))).toEqual(['+V', '-V'])
  })
  it('says a module with no mains data has none', () => {
    const r = validateModule({ ...base, pins: two })
    if (!r.ok) throw new Error('invalid')
    expect(mainsOf(r.module).any).toBe(false)
  })
})
