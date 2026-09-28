import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateModule } from '../../src/format/module.ts'
import { chargerUK, outletUK, plugSchuko } from '../../src/format/mains.testing.ts'
import { SOCKET_FAMILIES } from '../../src/format/mainsModel.ts'
import { SOCKET_PATTERNS } from '../../src/format/plugging.ts'

// The helpers are plain JS for the generators; load them untyped.
const lib = await import(pathToFileURL(resolve('scripts/lib/mains.mjs')).href)

type Contact = { pin: string; at: { x: number; y: number }; mains: string }
const contactSet = (cs: Contact[]) => cs.map((c) => `${c.pin}@${c.at.x},${c.at.y}:${c.mains}`).sort()
const holeSet = (hs: { name: string; at: [number, number][] }[]) => hs.flatMap((h) => h.at.map(([x, y]) => `${h.name}@${x},${y}`)).sort()

describe('mains generator helpers', () => {
  it('builds a socket whose hole groups are exactly its socket contacts, from the family pattern', () => {
    const s = lib.socket('bs1363', 'main', 40, 40)
    expect(holeSet(s.holes)).toEqual(holeSet(outletUK.holes as never))
    expect(s.socket).toEqual({ id: 'main', family: 'bs1363', contacts: [{ group: 'L', role: 'L' }, { group: 'N', role: 'N' }, { group: 'PE', role: 'PE' }] })
    const m = { ...outletUK, holes: s.holes, electrical: { ...(outletUK.electrical as object), sockets: [s.socket] } }
    expect(validateModule(m)).toMatchObject({ ok: true })
  })

  it('suffixes group names for a second socket, and leaves out an earth the family lacks', () => {
    const s = lib.socket('nema-1-15r', 'lower', 40, 100, '2')
    expect(s.holes.map((h: { name: string }) => h.name)).toEqual(['L2', 'N2'])
    expect(s.socket.contacts).toEqual([{ group: 'L2', role: 'L' }, { group: 'N2', role: 'N' }])
    for (const f of SOCKET_FAMILIES) expect(lib.socket(f, 'main', 0, 0).holes.length).toBe((['L', 'N', 'PE'] as const).filter((c) => SOCKET_PATTERNS[f][c].length).length)
  })

  it('places plug profiles on the pivot, one per profile, with an earth touching at every clip', () => {
    const profiles = lib.plugProfiles('cee7-7', 40, 40)
    const fixture = (plugSchuko.electrical as { plug: { profiles: { id: string; contacts: Contact[] }[] } }).plug.profiles
    expect(profiles.map((p: { id: string }) => p.id)).toEqual(fixture.map((p) => p.id))
    profiles.forEach((p: { contacts: Contact[] }, i: number) => expect(contactSet(p.contacts)).toEqual(contactSet(fixture[i].contacts)))
    expect(lib.prongs()).toEqual(['L prong', 'N prong', 'PE prong'])
    expect(lib.prongs(['L', 'N'])).toEqual(['L prong', 'N prong'])
  })

  it('draws an insulated earth pin as a mechanical contact that a class II part validates with (Ruling 39)', () => {
    const profiles = lib.plugProfiles('bs1363', 40, 40, ['L', 'N'], { PE: 'E pin' })
    const fixture = (chargerUK.electrical as { plug: { profiles: { contacts: Contact[] }[] } }).plug.profiles
    expect(contactSet(profiles[0].contacts)).toEqual(contactSet(fixture[0].contacts))
    const m = { ...chargerUK, electrical: { ...(chargerUK.electrical as object), internalNodes: [...lib.prongs(['L', 'N']), 'E pin'], plug: { family: 'bs1363', profiles } } }
    expect(validateModule(m)).toMatchObject({ ok: true })
    expect(() => lib.plugProfiles('bs1363', 40, 40, ['L', 'N', 'PE'], { PE: 'E pin' })).toThrow(/mechanical/)
  })

  it('writes a rating entry with its extras', () => {
    expect(lib.rating(['1', '2'], 'terminal', 'ac', 250, { amps: 10, provenance: 'datasheet' })).toEqual({ pins: ['1', '2'], kind: 'terminal', service: 'ac', volts: 250, amps: 10, provenance: 'datasheet' })
  })
})
