// The mains fields of the module format (spec sections 1 and 2): every field validated with the
// exact path of each problem, and `mainsOf` reading a valid module.
import { describe, expect, it } from 'vitest'
import { type ModuleDef, validateModule } from './module.ts'
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
      'electrical.isolation: needs a mains domain and a selv or pelv domain, the two sides of the barrier it rates',
      'electrical.safeguard: needs a mains domain and a selv or pelv domain, the two sides of the barrier it rates',
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
      'electrical.protection: a class 1 part needs a terminal marked "mains": "PE" or a PE plug contact',
      'electrical.plug.profiles[0].contacts[0].pin: must name an internal node (electrical.internalNodes), the prong',
      'electrical.plug.profiles[0].contacts[0].at: must be { "x", "y" } on the 10 px grid',
      'electrical.plug.profiles[0].contacts[0].mains: must be "L", "N", "PE" or "mechanical"',
    ])
  })
  it('keeps plug contacts inside the body', () => {
    expect(errs({
      ...base, pins: two, size: { w: 4, h: 4 },
      electrical: { internalNodes: ['L prong', 'N prong'], plug: { family: 'nema-1-15p', profiles: [{ id: 'main', contacts: [{ pin: 'L prong', at: { x: 90, y: 10 }, mains: 'L' }, { pin: 'N prong', at: { x: 10, y: 10 }, mains: 'N' }] }] } },
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
        isolation: 'reinforced', isolationProvenance: 'datasheet', protection: 'class-2',
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
      const r = validateModule({ ...base, pins: two, electrical: { domains: [{ name: 'm', pins: ['A'], kind: 'mains' }, { name: 'o', pins: ['B'], kind: 'selv' }], isolation, ...(isolation === 'unknown' ? {} : { isolationProvenance: 'datasheet' }), ...(safeguard ? { safeguard } : {}) } })
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
      electrical: {
        acInput: { a: 'AC1', b: 'AC2', range: [100, 240] }, isolation: 'reinforced', isolationProvenance: 'datasheet',
        domains: [{ name: 'mains', pins: ['AC1', 'AC2'], kind: 'mains' }, { name: 'out', pins: ['+V'], kind: 'selv' }],
      },
    })
    if (!r.ok) throw new Error(r.errors.join('; '))
    expect(uncoveredPins(r.module, mainsOf(r.module))).toEqual(['-V'])
  })
  it('gives a class 2 part with no isolation no protective separation', () => {
    const r = validateModule({ ...base, pins: two, electrical: { protection: 'class-2' } })
    if (!r.ok) throw new Error(r.errors.join('; '))
    expect(isolationAdequate(mainsOf(r.module))).toBe(false)
  })
  it('reads a declared polarity hazard, and rejects one that is not a sentence', () => {
    const r = validateModule({ ...base, pins: two, electrical: { protection: 'class-2', polarityHazard: 'Its shell is then live.' } })
    if (!r.ok) throw new Error(r.errors.join('; '))
    expect(mainsOf(r.module).polarityHazard).toBe('Its shell is then live.')
    const bad = validateModule({ ...base, pins: two, electrical: { protection: 'class-2', polarityHazard: 3 } })
    expect(bad.ok ? [] : bad.errors).toContain('electrical.polarityHazard: must be a sentence saying what wiring the part the wrong way round does')
  })
  it('says a module with no mains data has none', () => {
    const r = validateModule({ ...base, pins: two })
    if (!r.ok) throw new Error('invalid')
    expect(mainsOf(r.module).any).toBe(false)
  })
})

// Hostile modules: contradictory safety data must never validate.
const sockets3 = [{ id: 'main', family: 'nema-5-15r', contacts: [{ group: 'L', role: 'L' }, { group: 'N', role: 'N' }, { group: 'PE', role: 'PE' }] }]
const outlet = (el: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  ...base, pins: [], size: { w: 6, h: 6 }, obstacle: false,
  holes: [{ name: 'N', at: [[20, 20]] }, { name: 'L', at: [[40, 20]] }, { name: 'PE', at: [[30, 40]] }],
  ...extra,
  electrical: {
    params: { acVoltage: { unit: 'VAC', default: 120 } }, ac: { hz: 60, region: 'us' },
    acSources: [{ id: 'supply', live: ['L'], neutral: ['N'], earth: ['PE'] }], sockets: sockets3, ...el,
  },
})
const src = (live: string[], neutral: string[], earth?: string[], id = 's') => ({ id, live, neutral, ...(earth ? { earth } : {}) })

describe('mains fields: hostile modules', () => {
  it('gives every source terminal exactly one conductor', () => {
    expect(errs(outlet({ acSources: [src(['L'], ['L'], ['PE'])] }))).toEqual([
      'electrical.acSources[0].neutral[0]: "L" is already L of source "s" (a terminal carries exactly one conductor)',
      'electrical.sockets[0].contacts[1].group: "N" is an N contact, but no source lists it (or a group joined to it by internal) as N',
    ])
    expect(errs(outlet({ acSources: [src(['L'], ['N'], ['L'])] }))).toEqual([
      'electrical.acSources[0].earth[0]: "L" is already L of source "s" (a terminal carries exactly one conductor)',
      'electrical.sockets[0].contacts[2].group: "PE" is a PE contact, but no source lists it (or a group joined to it by internal) as PE',
    ])
    expect(errs(outlet({ acSources: [src(['L', 'L'], ['N'], ['PE'])] }))).toEqual([
      'electrical.acSources[0].live[1]: "L" is already L of source "s" (a terminal carries exactly one conductor)',
    ])
    expect(errs(outlet({ acSources: [src(['L'], ['N'], ['PE'], 'a'), src(['L'], ['N'], undefined, 'b')] }))).toEqual([
      'electrical.acSources[1].live[0]: "L" is already L of source "a" (a terminal carries exactly one conductor)',
      'electrical.acSources[1].neutral[0]: "N" is already N of source "a" (a terminal carries exactly one conductor)',
    ])
  })
  it('matches each source conductor to the socket contact role', () => {
    expect(errs(outlet({ acSources: [src(['N'], ['L'], ['PE'])] }))).toEqual([
      'electrical.acSources[0].live[0]: "N" is an N socket contact, not L',
      'electrical.acSources[0].neutral[0]: "L" is an L socket contact, not N',
    ])
    expect(errs(outlet({ acSources: [src(['L'], ['N'], ['PE']), src(['X'], ['Y'], undefined, 't')] }, { pins: [{ name: 'X', side: 'left' }, { name: 'Y', side: 'left' }] }))).toEqual([
      'electrical.acSources[1].live[0]: "X" is not a socket contact (on an outlet a source feeds its sockets)',
      'electrical.acSources[1].neutral[0]: "Y" is not a socket contact (on an outlet a source feeds its sockets)',
    ])
  })
  it('accepts a duplex outlet whose second socket is joined by internal, and rejects one that is not', () => {
    const duplex = (internal: string[][]) => ({
      ...base, pins: [], size: { w: 8, h: 14 }, obstacle: false, internal,
      holes: [
        { name: 'L1', at: [[50, 30]] }, { name: 'N1', at: [[30, 30]] }, { name: 'PE1', at: [[40, 50]] },
        { name: 'L2', at: [[50, 90]] }, { name: 'N2', at: [[30, 90]] }, { name: 'PE2', at: [[40, 110]] },
      ],
      electrical: {
        params: { acVoltage: { unit: 'VAC', default: 120 } }, ac: { hz: 60, region: 'us' },
        acSources: [src(['L1'], ['N1'], ['PE1'], 'supply')],
        sockets: [1, 2].map((k) => ({ id: `s${k}`, family: 'nema-5-15r', contacts: [{ group: `L${k}`, role: 'L' }, { group: `N${k}`, role: 'N' }, { group: `PE${k}`, role: 'PE' }] })),
      },
    })
    expect(errs(duplex([['L1', 'L2'], ['N1', 'N2'], ['PE1', 'PE2']]))).toEqual([])
    expect(errs(duplex([['L1', 'N2'], ['N1', 'L2'], ['PE1', 'PE2']]))).toEqual([
      'electrical.sockets[1].contacts[0].group: "L2" is an L contact, but no source lists it (or a group joined to it by internal) as L',
      'electrical.sockets[1].contacts[1].group: "N2" is an N contact, but no source lists it (or a group joined to it by internal) as N',
    ])
  })
  it('rejects a socket family from another region', () => {
    expect(errs(outlet({ ac: { hz: 50, region: 'uk' } }))).toEqual([
      'electrical.sockets[0].family: "nema-5-15r" is not a socket of region "uk" (expected "bs1363")',
    ])
  })
  it('rejects duplicate source, domain, socket and profile ids', () => {
    const hs = [{ name: 'N', at: [[20, 20]] }, { name: 'L', at: [[40, 20]] }, { name: 'PE', at: [[30, 40]] }, { name: 'N2', at: [[20, 50]] }, { name: 'L2', at: [[40, 50]] }]
    const sockets = [sockets3[0], { id: 'main', family: 'nema-5-15r', contacts: [{ group: 'L2', role: 'L' }, { group: 'N2', role: 'N' }] }]
    expect(errs(outlet({ acSources: [src(['L'], ['N'], ['PE'], 'x'), src(['L2'], ['N2'], undefined, 'x')], sockets }, { holes: hs }))).toEqual([
      'electrical.acSources[1].id: duplicate "x"',
      'electrical.sockets[1].id: duplicate "main"',
    ])
    expect(errs({ ...base, pins: two, electrical: { domains: [{ name: 'm', pins: ['A'], kind: 'mains' }, { name: 'm', pins: ['B'], kind: 'mains' }] } }))
      .toEqual(['electrical.domains[1].name: duplicate "m"'])
    const prof = { id: 'p', contacts: [{ pin: 'L prong', at: { x: 10, y: 10 }, mains: 'L' }, { pin: 'N prong', at: { x: 30, y: 10 }, mains: 'N' }] }
    expect(errs({ ...base, pins: two, electrical: { internalNodes: ['L prong', 'N prong'], plug: { family: 'nema-1-15p', profiles: [prof, prof] } } }))
      .toEqual(['electrical.plug.profiles[1].id: duplicate "p"'])
  })
  it('puts every hole group of an outlet in exactly one socket', () => {
    const both = [sockets3[0], { id: 'b', family: 'nema-5-15r', contacts: [{ group: 'L', role: 'L' }, { group: 'N', role: 'N' }] }]
    expect(errs(outlet({ sockets: both }))).toEqual([
      'electrical.sockets[1].contacts[0].group: "L" already belongs to socket "main"',
      'electrical.sockets[1].contacts[1].group: "N" already belongs to socket "main"',
    ])
    const holes = [{ name: 'N', at: [[20, 20]] }, { name: 'L', at: [[40, 20]] }, { name: 'PE', at: [[30, 40]] }, { name: 'X', at: [[10, 50]] }]
    expect(errs(outlet({}, { holes }))).toEqual(['holes: group "X" belongs to no socket (on an outlet every hole group is a socket contact)'])
  })
  it('keeps a plug off a board', () => {
    expect(errs(outlet({
      internalNodes: ['L prong', 'N prong'],
      plug: { family: 'nema-1-15p', profiles: [{ id: 'p', contacts: [{ pin: 'L prong', at: { x: 10, y: 10 }, mains: 'L' }, { pin: 'N prong', at: { x: 30, y: 10 }, mains: 'N' }] }] },
    }))).toEqual(['electrical.plug: a plug-in device cannot be a board ("obstacle": false)'])
  })
  it('keeps mains terminals out of SELV and PELV domains', () => {
    const conv = [{ name: 'AC1', side: 'left', mains: 'line' }, { name: 'AC2', side: 'left', mains: 'line' }, { name: '+V', side: 'right' }, { name: '-V', side: 'right' }]
    expect(errs({
      ...base, pins: conv,
      electrical: {
        acInput: { a: 'AC1', b: 'AC2', range: [100, 240] }, isolation: 'reinforced', isolationProvenance: 'datasheet',
        domains: [{ name: 'mains', pins: ['AC1'], kind: 'mains' }, { name: 'out', pins: ['AC2', '+V', '-V'], kind: 'selv' }],
      },
    })).toEqual(['electrical.domains[1].pins: "AC2" is declared for mains but sits in selv domain "out"'])
  })
  it('ties isolation and safeguard to a barrier between a mains and a non-mains domain', () => {
    expect(errs({ ...base, pins: two, electrical: { isolation: 'unknown', safeguard: 'protective-screen' } })).toEqual([
      'electrical.isolation: needs a mains domain and a selv or pelv domain, the two sides of the barrier it rates',
      'electrical.safeguard: needs a mains domain and a selv or pelv domain, the two sides of the barrier it rates',
    ])
    expect(errs({ ...base, pins: two, electrical: { domains: [{ name: 'm', pins: ['A'], kind: 'mains' }, { name: 'o', pins: ['B'], kind: 'selv' }] } })).toEqual([
      'electrical.domains: a selv or pelv domain needs electrical.isolation ("unknown" when no source states a class)',
    ])
  })
  it('requires isolationProvenance with a stated class and checks it, amps and conditions', () => {
    const d = { domains: [{ name: 'm', pins: ['A'], kind: 'mains' }, { name: 'o', pins: ['B'], kind: 'selv' }] }
    expect(errs({ ...base, pins: two, electrical: { ...d, isolation: 'double' } })).toEqual([
      'electrical.isolationProvenance: required with isolation "double" ("datasheet" or "unverified")',
    ])
    expect(errs({ ...base, pins: two, electrical: { ...d, isolation: 'basic', isolationProvenance: 'maybe' } })).toEqual([
      'electrical.isolationProvenance: must be "datasheet" or "unverified"',
    ])
    expect(errs({ ...base, pins: two, electrical: { ratings: [{ pins: ['A'], kind: 'terminal', service: 'ac', volts: 250, amps: -1, provenance: 'datasheet', conditions: '' }] } })).toEqual([
      'electrical.ratings[0].amps: must be a number above 0',
      'electrical.ratings[0].conditions: must be a non-empty string',
    ])
  })
  it('keeps contact poles apart', () => {
    const three = [...two, { name: 'C', side: 'right' }]
    expect(errs({ ...base, pins: three, electrical: { contacts: [{ id: 'k', kind: 'switch', poles: [{ com: 'A', no: 'A' }] }] } })).toEqual([
      'electrical.contacts[0].poles[0]: com, no and nc must be different terminals',
    ])
    expect(errs({ ...base, pins: three, electrical: { contacts: [{ id: 'k1', kind: 'relay', poles: [{ com: 'A', no: 'B' }] }, { id: 'k2', kind: 'relay', poles: [{ com: 'B', nc: 'C' }] }] } })).toEqual([
      'electrical.contacts[1].poles[0].com: "B" is already in electrical.contacts[0].poles[0]',
    ])
  })
  it('checks the contacts of each plug profile', () => {
    const plug = (contacts: unknown[], protection?: string) => errs({
      ...base, pins: two, size: { w: 6, h: 6 },
      electrical: { internalNodes: ['L prong', 'N prong', 'PE prong'], ...(protection ? { protection } : {}), plug: { family: 'nema-5-15p', profiles: [{ id: 'p', contacts }] } },
    })
    const c = (pin: string, x: number, y: number, mains: string) => ({ pin, at: { x, y }, mains })
    expect(plug([c('L prong', 10, 10, 'L'), c('N prong', 30, 10, 'L')])).toEqual([
      'electrical.plug.profiles[0].contacts: needs exactly one L and one N contact, and at most one PE',
    ])
    expect(plug([c('L prong', 10, 10, 'L'), c('L prong', 30, 10, 'N')])).toEqual([
      'electrical.plug.profiles[0].contacts[1].pin: "L prong" is already a contact of this profile',
    ])
    expect(plug([c('L prong', 10, 10, 'L'), c('N prong', 10, 10, 'N')])).toEqual([
      'electrical.plug.profiles[0].contacts[1].at: another contact of this profile sits at 10, 10',
    ])
    expect(plug([c('L prong', 10, 10, 'L'), c('N prong', 30, 10, 'N'), c('PE prong', 20, 30, 'PE')], 'class-2')).toEqual([
      'electrical.plug.profiles[0].contacts[2].mains: a class 2 part has no PE prong (an insulated earth pin is "mechanical")',
    ])
  })
  it('allows a mechanical-only contact that carries no conductor (Ruling 39)', () => {
    const plug = (contacts: unknown[], extra: Record<string, unknown> = {}, profiles: unknown[] = [{ id: 'p', contacts }]) => errs({
      ...base, pins: two, size: { w: 6, h: 6 },
      electrical: { internalNodes: ['L prong', 'N prong', 'PE prong', 'E pin'], protection: 'class-2', plug: { family: 'bs1363', profiles }, ...extra },
    })
    const c = (pin: string, x: number, y: number, mains: string) => ({ pin, at: { x, y }, mains })
    const ln = [c('L prong', 10, 10, 'L'), c('N prong', 30, 10, 'N')]
    // A class 2 part may have an insulated earth pin; it is not counted as the profile's PE.
    expect(plug([...ln, c('E pin', 20, 30, 'mechanical')])).toEqual([])
    expect(plug([...ln, c('E pin', 20, 30, 'mechanical'), c('PE prong', 20, 50, 'PE')], { protection: undefined })).toEqual([])
    // Only conducting contacts count for one L and one N.
    expect(plug([c('L prong', 10, 10, 'L'), c('E pin', 30, 10, 'mechanical')])).toEqual([
      'electrical.plug.profiles[0].contacts: needs exactly one L and one N contact, and at most one PE',
    ])
    // It carries no conductor, so nothing may join it or declare it for mains.
    expect(plug([...ln, c('E pin', 20, 30, 'mechanical')], { acInput: { a: 'L prong', b: 'E pin', range: [100, 240] } })).toEqual([
      'electrical.plug: "E pin" is a mechanical contact (it carries no conductor), so no internal join, source, conduction, domain, rating or contact may name it',
    ])
    // A pin is mechanical in every profile or in none.
    expect(plug([], {}, [{ id: 'a', contacts: [...ln, c('E pin', 20, 30, 'mechanical')] }, { id: 'b', contacts: [c('L prong', 10, 10, 'L'), c('E pin', 30, 10, 'N')] }])).toEqual([
      'electrical.plug.profiles[1].contacts[1].mains: "E pin" is mechanical in another profile (a mechanical pin carries no conductor in any profile)',
    ])
    // One earth prong may touch at two points (CEE 7/7 earth clips); a line prong may not.
    expect(plug([...ln, c('PE prong', 20, 30, 'PE'), c('PE prong', 20, 50, 'PE')], { protection: undefined })).toEqual([])
    expect(plug([...ln, c('L prong', 20, 30, 'L')])).toEqual([
      'electrical.plug.profiles[0].contacts[2].pin: "L prong" is already a contact of this profile',
      'electrical.plug.profiles[0].contacts: needs exactly one L and one N contact, and at most one PE',
    ])
  })
  it('keeps a mechanical pin out of the mains terminals and out of the class 1 earth', () => {
    const m = {
      ...base, pins: two, size: { w: 6, h: 6 },
      electrical: { internalNodes: ['L prong', 'N prong', 'E pin'], protection: 'class-1',
        plug: { family: 'bs1363', profiles: [{ id: 'p', contacts: [{ pin: 'L prong', at: { x: 10, y: 10 }, mains: 'L' }, { pin: 'N prong', at: { x: 30, y: 10 }, mains: 'N' }, { pin: 'E pin', at: { x: 20, y: 30 }, mains: 'mechanical' }] }] } },
    }
    expect(errs(m)).toEqual(['electrical.protection: a class 1 part needs a terminal marked "mains": "PE" or a PE plug contact'])
    const info = mainsOf({ ...m, electrical: { ...m.electrical, protection: 'class-2' } } as ModuleDef)
    expect([info.terminals.has('E pin'), info.declaredConduction.has('E pin'), info.terminals.has('L prong')]).toEqual([false, false, true])
  })
  it('accepts a class 1 cord plug whose PE terminal is its PE prong, joined to its leads by internal', () => {
    expect(errs({
      ...base, size: { w: 6, h: 6 },
      pins: [{ name: 'Lw', side: 'right', mains: 'L' }, { name: 'Nw', side: 'right', mains: 'N' }, { name: 'Ew', side: 'right' }],
      internal: [['Lw', 'L prong'], ['Nw', 'N prong'], ['Ew', 'PE prong']],
      electrical: {
        internalNodes: ['L prong', 'N prong', 'PE prong'], protection: 'class-1',
        plug: { family: 'nema-5-15p', profiles: [{ id: 'p', contacts: [{ pin: 'L prong', at: { x: 10, y: 10 }, mains: 'L' }, { pin: 'N prong', at: { x: 30, y: 10 }, mains: 'N' }, { pin: 'PE prong', at: { x: 20, y: 30 }, mains: 'PE' }] }] },
      },
    })).toEqual([])
  })
  it('keeps a PE terminal out of SELV and PELV domains', () => {
    expect(errs({
      ...base, pins: [{ name: 'A', side: 'left' }, { name: 'E', side: 'left', mains: 'PE' }],
      electrical: { isolation: 'unknown', domains: [{ name: 'm', pins: ['A'], kind: 'mains' }, { name: 'o', pins: ['E'], kind: 'pelv' }] },
    })).toEqual(['electrical.domains[1].pins: "E" is declared for mains but sits in pelv domain "o"'])
  })
  it('gives every outlet with sockets a source and a region', () => {
    expect(errs(outlet({ acSources: undefined, ac: undefined }))).toEqual([
      'electrical.sockets: an outlet needs electrical.acSources and electrical.ac (its source and region)',
    ])
    expect(errs(outlet({ ac: undefined }))).toEqual([
      'electrical.ac: required with acSources ({ "hz", "region" })',
      'electrical.sockets: an outlet needs electrical.acSources and electrical.ac (its source and region)',
    ])
  })
  it('keeps electrical.external on real pins, never an internal node', () => {
    expect(errs({ ...base, pins: two, electrical: { internalNodes: ['X'], external: [{ pin: 'X', volts: 5, via: 'USB' }] } })).toEqual([
      'electrical.external[0].pin: no pin named "X"',
    ])
  })
})
