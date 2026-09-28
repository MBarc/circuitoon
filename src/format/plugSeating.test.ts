// Seating plug-in devices (spec section 2) through the real mount code: every plug family against
// every socket family at all four turns, checked against the spec's own table (not the
// implementation's), the contact each plug contact meets, turned outlets, translations, occupied
// sockets, overlapping outlets, a breadboard nearby, contacts spread across two sockets, the plug
// counterexamples with rule 10, and mechanical-only contacts (Ruling 39).
import { describe, expect, it } from 'vitest'
import { type Diagram, type PartInstance, validateDiagram } from './diagram.ts'
import { mountIssues, plugMismatches, plugsOf, seatOf } from './breadboard.ts'
import { checkDiagram } from './checks.ts'
import { analyseMains } from './mains.ts'
import { nodeKey } from './netlist.ts'
import { type ModuleDef, validateModule } from './module.ts'
import type { Rotation } from './geometry.ts'
import { CONDUCTORS, PLUG_FAMILIES, SOCKET_FAMILIES, type Conductor, type PlugFamily, type SocketFamily } from './mainsModel.ts'
import { PLUG_PROFILES, SOCKET_PATTERNS } from './plugging.ts'
import { SPEC_COMPAT, specMapping, specTurns } from './plugSpec.testing.ts'
import { load } from './builtinModules.testing.ts'
import { rotateParts, settleDrop } from '../editor/ops.ts'
import { at, sheet, w } from './mains.testing.ts'

const C = 50
/** An outlet of one socket family, its socket centred on the pivot of a 100 x 100 body. */
function socketModule(family: SocketFamily, only?: readonly Conductor[]): ModuleDef {
  const roles = only ?? CONDUCTORS.filter((c) => SOCKET_PATTERNS[family][c].length)
  const pat = SOCKET_PATTERNS[family]
  return {
    format: 'circuitoon-module/1', id: `s-${family}${only ? '-' + only.join('-').toLowerCase() : ''}`, name: family, pins: [], size: { w: 10, h: 10 }, obstacle: false,
    holes: roles.map((c) => ({ name: c, at: pat[c].map(([x, y]) => [C + x, C + y] as [number, number]) })),
    electrical: {
      params: { acVoltage: { unit: 'VAC', default: 230 } }, ac: { hz: 50, region: family.startsWith('nema') ? 'us' : family === 'bs1363' ? 'uk' : family === 'as3112' ? 'au' : 'eu' },
      acSources: [{ id: 's', live: ['L'], neutral: ['N'], ...(roles.includes('PE') ? { earth: ['PE'] } : {}) }],
      sockets: [{ id: 'main', family, contacts: roles.map((c) => ({ group: c, role: c })) }],
    },
  }
}
/**
 * A plug-in device of one plug family, every profile centred on the pivot of a 100 x 100 body. With
 * `mechanical`, every earth contact is an insulated pin that carries no conductor (Ruling 39): a
 * class II device on a plug whose earth pin only opens the shutters.
 */
function plugModule(family: PlugFamily, mechanical = false): ModuleDef {
  const profiles = PLUG_PROFILES[family]
  const roles = CONDUCTORS.filter((c) => profiles.some((pr) => pr.contacts[c].length) && !(mechanical && c === 'PE'))
  const hasPE = profiles.some((pr) => pr.contacts.PE.length)
  return {
    format: 'circuitoon-module/1', id: `p-${family}${mechanical ? '-c2' : ''}`, name: family, size: { w: 10, h: 10 },
    pins: roles.map((c) => ({ name: c, side: 'bottom' as const })),
    internal: roles.map((c) => [`${c} prong`, c]),
    electrical: {
      internalNodes: [...roles.map((c) => `${c} prong`), ...(mechanical && hasPE ? ['E pin'] : [])],
      ...(mechanical ? { protection: 'class-2' } : {}),
      plug: { family, profiles: profiles.map((pr) => ({ id: pr.id, contacts: CONDUCTORS.flatMap((c) => pr.contacts[c].map(([x, y]) => (
        mechanical && c === 'PE' ? { pin: 'E pin', at: { x: C + x, y: C + y }, mains: 'mechanical' } : { pin: `${c} prong`, at: { x: C + x, y: C + y }, mains: c }))) })) },
    },
  }
}
const pair = (plug: PlugFamily, socket: SocketFamily, place: Partial<PartInstance> = {}, mechanical = false): Diagram => {
  const [sm, pm] = [socketModule(socket), plugModule(plug, mechanical)]
  return { format: 'circuitoon-diagram/1', title: 't', modules: { [sm.id]: sm, [pm.id]: pm }, connections: [],
    parts: [{ uid: 'xs', designator: 'XS1', module: sm.id, x: 0, y: 0 }, { uid: 'xp', designator: 'XP1', module: pm.id, x: 0, y: 0, ...place }] }
}
const seated = (d: Diagram, uid = 'xp') => seatOf(d, uid, [])?.status === 'seated'
const ROTATIONS: Rotation[] = [0, 90, 180, 270]
const errsOf = (m: ModuleDef) => {
  const r = validateModule(m)
  return r.ok ? [] : r.errors
}

describe('the compatibility matrix through the mount code', () => {
  it('the synthetic modules are valid', () => {
    for (const f of SOCKET_FAMILIES) expect([f, errsOf(socketModule(f))]).toEqual([f, []])
    for (const f of PLUG_FAMILIES) for (const mech of [false, true]) expect([f, mech, errsOf(plugModule(f, mech))]).toEqual([f, mech, []])
  })
  it('every plug family against every socket family, all four turns: seats exactly where the spec allows', () => {
    for (const plug of PLUG_FAMILIES)
      for (const socket of SOCKET_FAMILIES)
        for (const rotation of ROTATIONS)
          expect([plug, socket, rotation, seated(pair(plug, socket, { rotation }))]).toEqual([plug, socket, rotation, specTurns(plug, socket).includes(rotation)])
  })
  it('each seated contact meets the socket contact the spec maps it to (the mapping that feeds identity)', () => {
    for (const { plug, socket, turns } of SPEC_COMPAT)
      for (const rotation of turns) {
        const d = pair(plug, socket, { rotation, mount: { board: 'xs' } })
        expect(mountIssues(d)).toEqual([])
        for (const pl of plugsOf(d)) {
          const role = pl.pin.split(' ')[0] as Conductor
          expect([plug, socket, rotation, pl.pin, pl.group]).toEqual([plug, socket, rotation, pl.pin, specMapping(rotation, role)])
        }
      }
  })
  it('turned outlets: a plug seats when turned with the outlet, and not when left square to the page', () => {
    for (const r of [90, 180, 270] as Rotation[]) {
      const d = pair('nema-5-15p', 'nema-5-15r', { rotation: r })
      const turned: Diagram = { ...d, parts: [{ ...d.parts[0], rotation: r }, d.parts[1]] }
      expect(seated(turned)).toBe(true)
      const square: Diagram = { ...d, parts: [{ ...d.parts[0], rotation: r }, { ...d.parts[1], rotation: 0 }] }
      expect(seated(square)).toBe(false)
    }
  })
  it('CEE 7/7 in 7/3 both orientations and in 7/5 one orientation', () => {
    expect(ROTATIONS.filter((r) => seated(pair('cee7-7', 'cee7-3', { rotation: r })))).toEqual([0, 180])
    expect(ROTATIONS.filter((r) => seated(pair('cee7-7', 'cee7-5', { rotation: r })))).toEqual([0])
  })
  it('a plug moved one grid step off the socket does not seat', () => {
    for (const [dx, dy] of [[10, 0], [0, 10], [-10, 0], [0, -10]]) expect(seated(pair('nema-5-15p', 'nema-5-15r', { x: dx, y: dy }))).toBe(false)
  })
  it('a second plug on an occupied socket does not seat', () => {
    const d = pair('nema-1-15p', 'nema-5-15r', { mount: { board: 'xs' } })
    const second: PartInstance = { uid: 'xp2', designator: 'XP2', module: 'p-nema-1-15p', x: 0, y: 0 }
    expect(seatOf({ ...d, parts: [...d.parts, second] }, 'xp2', plugsOf(d))?.status).toBe('partial')
  })
})

describe('seating among other boards', () => {
  it('overlapping outlets: the plug seats in the one drawn on top', () => {
    const d = pair('nema-5-15p', 'nema-5-15r')
    const upper: PartInstance = { uid: 'xs2', designator: 'XS2', module: 's-nema-5-15r', x: 0, y: 0 }
    expect(seatOf({ ...d, parts: [d.parts[0], upper, d.parts[1]] }, 'xp', [])).toMatchObject({ status: 'seated', board: 'xs2' })
  })
  it('a plug over a breadboard never seats in it', () => {
    const bb = load('breadboard-half')
    const pm = plugModule('nema-5-15p')
    for (let x = 0; x < 100; x += 10)
      for (let y = 0; y < 100; y += 10) {
        const d: Diagram = { format: 'circuitoon-diagram/1', title: 't', modules: { [bb.id]: bb, [pm.id]: pm }, connections: [],
          parts: [{ uid: 'bb', designator: 'BB1', module: bb.id, x: 0, y: 0 }, { uid: 'xp', designator: 'XP1', module: pm.id, x, y, mount: { board: 'bb' } }] }
        expect(seated(d)).toBe(false)
        // Categorical: a plug never fits a breadboard, however many of its contacts land on holes.
        expect(mountIssues(d).map((i) => i.reason)).toEqual(['no-fit'])
      }
  })
  it('contacts spread across two sockets (never seats)', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet-split'), at('xp1', 'XP1', 't-plug-us')], [])
    expect(seated(d, 'xp1')).toBe(false)
  })
  it('a part that is not a plug does not seat in an outlet', () => {
    // Two legs 20 px apart on the bottom edge: at (0, 0) they land on the outlet's N and L holes.
    const two: ModuleDef = { format: 'circuitoon-module/1', id: 't-two-leg', name: 'Two legs', size: { w: 4, h: 3 }, pins: [{ name: 'a', side: 'bottom' }, { spacer: true, side: 'bottom' }, { name: 'b', side: 'bottom' }] }
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('r1', 'R1', 't-two-leg', 0, 0, { mount: { board: 'xs1' } })], [], { 't-two-leg': two })
    expect(seatOf(d, 'r1', [])?.status).toBe('partial')
    expect(mountIssues(d).map((i) => i.reason)).toEqual(['no-fit'])
    expect(checkDiagram(d).filter((f) => f.rule === 'mount').map((f) => f.message)).toEqual([
      'R1 does not fit XS1: an outlet takes only a matching plug, and a plug fits only a matching outlet, so it connects nothing. Drag it off, or use a part that fits.',
    ])
    const loaded = validateDiagram(d)
    expect(loaded.ok && loaded.warnings.filter((x) => x.includes('does not fit')).length).toBe(1)
  })
  it('a plug-in device that does not fit an outlet it overlaps gets a red outline while it is dragged', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('xp1', 'XP1', 't-plug-uk')], [])
    expect(seatOf(d, 'xp1', [])).toMatchObject({ status: 'partial', board: 'xs1', outline: { x: 0, y: 0, w: 80, h: 80 } })
    expect(seatOf(sheet([at('xs1', 'XS1', 't-outlet-uk'), at('xp1', 'XP1', 't-plug-uk')], []), 'xp1', [])?.outline).toBeUndefined()
  })
})

describe('plug counterexamples and rule 10', () => {
  it('reversed Schuko plug (no false short)', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet-eu'), at('xp1', 'XP1', 't-plug-schuko', 0, 0, { rotation: 180, mount: { board: 'xs1' } }), at('e1', 'E1', 't-lamp-230', 300)],
      [w('xp1|L', 'e1|L'), w('xp1|N', 'e1|N')])
    expect(mountIssues(d)).toEqual([])
    expect(checkDiagram(d).map((f) => f.rule)).not.toContain('mains-short')
    expect(analyseMains(d)!.conductorOf(nodeKey('xp1', 'L'))?.conductor).toBe('N')
  })
  it('UK fused plug protecting a cord-wired lamp (clean)', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet-uk'), at('xp1', 'XP1', 't-plug-uk', 0, 0, { mount: { board: 'xs1' } }), at('e1', 'E1', 't-lamp-230', 300)],
      [w('xp1|L', 'e1|L'), w('xp1|N', 'e1|N')])
    expect(checkDiagram(d).filter((f) => f.rule !== 'cable-unverified').map((f) => `${f.rule}: ${f.message}`)).toEqual([])
  })
  it('a Schuko plug in a French outlet seats one way up only', () => {
    const on = (rotation: Rotation) => sheet([at('xs1', 'XS1', 't-outlet-fr'), at('xp1', 'XP1', 't-plug-schuko', 0, 0, { rotation, mount: { board: 'xs1' } })], [])
    expect(mountIssues(on(0))).toEqual([])
    expect(plugsOf(on(0)).map((pl) => `${pl.pin}>${pl.group}`).sort()).toEqual(['L prong>L', 'N prong>N', 'PE prong>PE'])
    expect(checkDiagram(on(180)).filter((f) => f.rule === 'plug-mismatch' || f.rule === 'mount').map((f) => f.rule)).toEqual(['plug-mismatch'])
  })
  it('a plug over an outlet of another family: plug-mismatch, in the spec\'s words', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('xp1', 'XP1', 't-plug-uk')], [])
    expect(checkDiagram(d).filter((f) => f.rule === 'plug-mismatch').map((f) => f.message)).toEqual([
      "XP1's UK plug does not fit XS1's US socket. Use a device with a US plug.",
    ])
  })
  it('a matching plug that is only partly in says it is never safe', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('xp1', 'XP1', 't-plug-us', 10, 0)], [])
    expect(checkDiagram(d).filter((f) => f.rule === 'plug-mismatch').map((f) => f.message)).toEqual([
      'XP1 does not sit in XS1: its contacts do not all meet one socket the way the plug fits, so none of them connect. Turn or move it until it seats; a plug that is only partly in is never electrically safe.',
    ])
  })
  it('a mounted plug that does not fit gets plug-mismatch, not a second mount finding', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('xp1', 'XP1', 't-plug-us', 10, 0, { mount: { board: 'xs1' } })], [])
    expect(checkDiagram(d).filter((f) => f.rule === 'plug-mismatch' || f.rule === 'mount').map((f) => f.rule)).toEqual(['plug-mismatch'])
  })
  it('a plug validly in its outlet, or clear of every outlet, is no mismatch', () => {
    expect(plugMismatches(sheet([at('xs1', 'XS1', 't-outlet'), at('xp1', 'XP1', 't-plug-us', 0, 0, { mount: { board: 'xs1' } })], []))).toEqual([])
    expect(plugMismatches(sheet([at('xs1', 'XS1', 't-outlet'), at('xp1', 'XP1', 't-plug-uk', 300, 0)], []))).toEqual([])
  })
  it('a plug lying where it would seat but not plugged in (Ruling 40)', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('xp1', 'XP1', 't-plug-us')], [])
    expect(plugMismatches(d).map((mm) => mm.kind)).toEqual(['unplugged'])
    expect(checkDiagram(d).filter((f) => f.rule === 'plug-mismatch').map((f) => f.message)).toEqual(['XP1 is over XS1 but not plugged in. Drag it into the socket.'])
    // Mounted on a socket another plug already fills: it fits, but is not plugged in.
    const taken = sheet([at('xs1', 'XS1', 't-outlet'), at('xp1', 'XP1', 't-plug-us', 0, 0, { mount: { board: 'xs1' } }), at('xp2', 'XP2', 't-plug-us', 0, 0, { mount: { board: 'xs1' } })], [])
    expect(checkDiagram(taken).filter((f) => f.rule === 'plug-mismatch' || f.rule === 'mount').map((f) => `${f.rule}: ${f.message}`)).toEqual([
      'plug-mismatch: XP2 is over XS1 but not plugged in. Drag it into the socket.',
    ])
  })
  it('the family wording names the socket the outlet actually has', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet-fr'), at('xp1', 'XP1', 't-plug-us')], [])
    expect(checkDiagram(d).filter((f) => f.rule === 'plug-mismatch').map((f) => f.message)).toEqual([
      "XP1's US plug does not fit XS1's French socket. Use a device with a French or Schuko (CEE 7/7) plug.",
    ])
    const two: ModuleDef = { ...socketModule('nema-5-15r'), id: 't-two-families', electrical: {
      params: { acVoltage: { unit: 'VAC', default: 120 } }, ac: { hz: 60, region: 'us' },
      acSources: [{ id: 's', live: ['L'], neutral: ['N'], earth: ['PE'] }],
      sockets: [{ id: 'a', family: 'nema-5-15r', contacts: [{ group: 'L', role: 'L' }, { group: 'N', role: 'N' }, { group: 'PE', role: 'PE' }] }, { id: 'b', family: 'nema-1-15r', contacts: [{ group: 'L2', role: 'L' }, { group: 'N2', role: 'N' }] }],
    }, holes: [...socketModule('nema-5-15r').holes!, { name: 'L2', at: [[90, 90]] }, { name: 'N2', at: [[70, 90]] }], internal: [['L', 'L2'], ['N', 'N2']] }
    expect(errsOf(two)).toEqual([])
    const multi = sheet([at('xs1', 'XS1', 't-two-families'), at('xp1', 'XP1', 't-plug-uk')], [], { 't-two-families': two })
    expect(checkDiagram(multi).filter((f) => f.rule === 'plug-mismatch').map((f) => f.message)).toEqual([
      "XP1's UK plug does not fit XS1's US socket or Japanese socket. Use a device with a US plug or a Japanese plug.",
    ])
  })
  it('a plug mounted on a breadboard that also overlaps an outlet gets one finding', () => {
    const bb = load('breadboard-half')
    const d = sheet([at('bb', 'BB1', bb.id, 0, 0), at('xs1', 'XS1', 't-outlet', 0, 0), at('xp1', 'XP1', 't-plug-uk', 0, 0, { mount: { board: 'bb' } })], [], { [bb.id]: bb })
    expect(checkDiagram(d).filter((f) => f.rule === 'plug-mismatch' || f.rule === 'mount').map((f) => f.rule)).toEqual(['plug-mismatch'])
  })
})

describe('rotating a plug-in device over an outlet (Ruling 41)', () => {
  it('a Schuko plug dropped at 180 on a French outlet, rotated twice to 0, is mounted and conducts', () => {
    const base = sheet([at('xs1', 'XS1', 't-outlet-fr'), at('xp1', 'XP1', 't-plug-schuko', 0, 0, { rotation: 180 })], [])
    const dropped = settleDrop(base, { ...base, parts: [...base.parts] }, ['xp1'])
    expect(dropped.parts[1].mount).toBeUndefined()
    expect(checkDiagram(dropped).filter((f) => f.rule === 'plug-mismatch').map((f) => f.message)).toEqual([
      'XP1 does not sit in XS1: its contacts do not all meet one socket the way the plug fits, so none of them connect. Turn or move it until it seats; a plug that is only partly in is never electrically safe.',
    ])
    const once = rotateParts(dropped, ['xp1'])
    expect(once.parts[1]).toMatchObject({ rotation: 270 })
    expect(once.parts[1].mount).toBeUndefined()
    const twice = rotateParts(once, ['xp1'])
    expect(twice.parts[1]).toMatchObject({ rotation: 0, mount: { board: 'xs1' } })
    const d = sheet(twice.parts, [])
    expect(mountIssues(d)).toEqual([])
    expect(analyseMains(d)!.conductorOf(nodeKey('xp1', 'L'))?.conductor).toBe('L')
    expect(checkDiagram(d).filter((f) => f.rule === 'plug-mismatch')).toEqual([])
    // Turned out of the socket, it comes out.
    expect(rotateParts(twice, ['xp1']).parts[1].mount).toBeUndefined()
  })
})

describe('mechanical-only contacts (Ruling 39)', () => {
  it('a class II plug with an insulated earth pin seats exactly where the conducting one does, at every turn and on every socket', () => {
    for (const plug of PLUG_FAMILIES)
      for (const socket of SOCKET_FAMILIES)
        for (const rotation of ROTATIONS)
          expect([plug, socket, rotation, seated(pair(plug, socket, { rotation }, true))]).toEqual([plug, socket, rotation, specTurns(plug, socket).includes(rotation)])
  })
  it('every plug, with its full pattern (an insulated earth pin included), seats only centred and turned as the spec allows, at every translation', () => {
    for (const mechanical of [false, true])
      for (const plug of PLUG_FAMILIES)
        for (const socket of SOCKET_FAMILIES) {
          const d = pair(plug, socket, {}, mechanical)
          const turns = specTurns(plug, socket)
          for (const rotation of ROTATIONS)
            for (let x = -60; x <= 60; x += 10)
              for (let y = -60; y <= 60; y += 10) {
                const moved: Diagram = { ...d, parts: [d.parts[0], { ...d.parts[1], x, y, rotation }] }
                const want = x === 0 && y === 0 && turns.includes(rotation)
                if (seated(moved) !== want) expect([mechanical, plug, socket, rotation, x, y, !want]).toEqual([mechanical, plug, socket, rotation, x, y, want])
              }
        }
  })
  it('the insulated pin must land in a contact of the socket: a socket without an earth contact does not take it', () => {
    const sm = socketModule('bs1363', ['L', 'N'])
    expect(errsOf(sm)).toEqual([])
    const pm = plugModule('bs1363', true)
    const d: Diagram = { format: 'circuitoon-diagram/1', title: 't', modules: { [sm.id]: sm, [pm.id]: pm }, connections: [],
      parts: [{ uid: 'xs', designator: 'XS1', module: sm.id, x: 0, y: 0 }, { uid: 'xp', designator: 'XP1', module: pm.id, x: 0, y: 0 }] }
    expect(seatOf(d, 'xp', [])?.status).toBe('partial')
    // The same socket with the plug moved one step: never seats either.
    for (const [dx, dy] of [[10, 0], [0, 10]]) expect(seated(pair('bs1363', 'bs1363', { x: dx, y: dy }, true))).toBe(false)
  })
  it('a UK class II charger seats in a BS socket; its earth pin fills the earth contact but joins nothing', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet-uk'), at('xc1', 'XC1', 't-charger-uk', 0, 0, { mount: { board: 'xs1' } })], [])
    expect(mountIssues(d)).toEqual([])
    expect(plugsOf(d).map((pl) => `${pl.pin}>${pl.group}${pl.mechanical ? ' (mechanical)' : ''}`).sort()).toEqual(['E pin>PE (mechanical)', 'L prong>L', 'N prong>N'])
    const a = analyseMains(d)!
    expect(a.conductorOf(nodeKey('xc1', 'L prong'))?.conductor).toBe('L')
    expect(a.conductorOf(nodeKey('xc1', 'N prong'))?.conductor).toBe('N')
    // No identity on the charger's side of the earth contact: the pin is insulated.
    expect(a.conductorOf(nodeKey('xc1', 'E pin'))).toBeNull()
    expect(a.hazardKeys.has(nodeKey('xc1', 'E pin'))).toBe(false)
    const node = a.graph.nodeOf.get(nodeKey('xs1', 'PE'))
    expect(node === undefined || node !== a.graph.nodeOf.get(nodeKey('xc1', 'E pin'))).toBe(true)
    expect(a.converters.get('xc1')?.state).toBe('powered')
    // Its unconnected 5 V output is the DC checker's business (no-ground); nothing about mains is reported.
    expect(checkDiagram(d).filter((f) => f.rule !== 'cable-unverified' && f.rule !== 'no-ground').map((f) => `${f.rule}: ${f.message}`)).toEqual([])
  })
  it('the filled earth contact takes no second plug', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet-uk'), at('xc1', 'XC1', 't-charger-uk', 0, 0, { mount: { board: 'xs1' } })], [])
    const second = sheet([...d.parts, at('xp1', 'XP1', 't-plug-uk', 0, 0, { mount: { board: 'xs1' } })], [])
    expect(mountIssues(second).map((i) => [i.part, i.reason])).toEqual([['xp1', 'conflict']])
  })
})
