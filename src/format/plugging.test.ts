// The plugging data (spec section 2): the table agrees with the spec row by row (turns, profile and
// contact mapping), and patterns of different families never fully overlap.
import { describe, expect, it } from 'vitest'
import type { Rotation } from './geometry.ts'
import { CONDUCTORS, PLUG_FAMILIES, SOCKET_FAMILIES } from './mainsModel.ts'
import { PLUG_PROFILES, SOCKET_PATTERNS, entriesFor, orientationOf } from './plugging.ts'
import { SPEC_COMPAT, specMapping, specTurns } from './plugSpec.testing.ts'

const ROTATIONS: Rotation[] = [0, 90, 180, 270]

describe('the compatibility table', () => {
  it('agrees with the spec for every plug and socket family: turns, profile and mapping', () => {
    for (const plug of PLUG_FAMILIES)
      for (const socket of SOCKET_FAMILIES) {
        const entries = entriesFor(plug, socket)
        const turns = entries.flatMap((e) => Object.keys(e.map).map(Number)).sort((a, b) => a - b)
        expect([plug, socket, turns]).toEqual([plug, socket, specTurns(plug, socket)])
        const row = SPEC_COMPAT.find((r) => r.plug === plug && r.socket === socket)
        for (const e of entries) {
          expect([plug, socket, e.profile]).toEqual([plug, socket, row!.profile])
          for (const [turn, map] of Object.entries(e.map))
            for (const role of CONDUCTORS) expect([plug, socket, turn, role, map![role]]).toEqual([plug, socket, turn, role, specMapping(Number(turn) as Rotation, role)])
        }
      }
  })
  it('every profile the table names exists for its plug family', () => {
    for (const e of SPEC_COMPAT) expect(PLUG_PROFILES[e.plug].map((p) => p.id)).toContain(e.profile)
  })
  it('measures a turn relative to the outlet', () => {
    expect(orientationOf({ rotation: 90 }, { rotation: 90 })).toBe(0)
    expect(orientationOf({ rotation: 0 }, { rotation: 90 })).toBe(270)
    expect(orientationOf({}, { rotation: 180 })).toBe(180)
  })
  it('patterns of different families never land fully on a socket they have no table entry for, at any rotation or translation', () => {
    const group = (f: string) => (f.startsWith('nema') ? 'nema' : f.startsWith('cee') ? 'cee' : f)
    const turn = ([x, y]: [number, number], r: Rotation): [number, number] => (r === 90 ? [-y, x] : r === 180 ? [-x, -y] : r === 270 ? [y, -x] : [x, y])
    for (const plug of PLUG_FAMILIES)
      for (const socket of SOCKET_FAMILIES) {
        // Within one geometry group the table alone decides (the grid cannot draw blade width; Resolution 7).
        if (group(plug) === group(socket)) continue
        const holes = CONDUCTORS.flatMap((c) => SOCKET_PATTERNS[socket][c])
        const at = new Set(holes.map(([x, y]) => `${x},${y}`))
        for (const pr of PLUG_PROFILES[plug])
          // The full profile, and the two-pin subset a built-in plug of this family may use (AS/NZS 3112 two-pin).
          for (const roles of plug === 'as3112' ? [CONDUCTORS, ['L', 'N'] as const] : [CONDUCTORS])
            for (const r of ROTATIONS) {
              const pts = roles.flatMap((c) => pr.contacts[c].map((p) => turn(p, r)))
              // Every translation that puts the first contact on some hole.
              const lands = holes.some(([hx, hy]) => pts.every(([x, y]) => at.has(`${x + hx - pts[0][0]},${y + hy - pts[0][1]}`)))
              expect([plug, pr.id, roles.join(''), socket, r, lands]).toEqual([plug, pr.id, roles.join(''), socket, r, false])
            }
      }
  })
})
