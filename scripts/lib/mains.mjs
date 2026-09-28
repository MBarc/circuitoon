// Shared helpers for the mains part generators (gen-mains-*.mjs): sockets and plug profiles built
// from the stylized patterns in src/format/plugging.ts (the same numbers the checker seats with; Node
// strips the types when importing it), prong internal nodes, and rating entries. Every value a
// generator passes in (family, rating, isolation) comes from src/format/mainsEvidence.ts.
import { PLUG_PROFILES, SOCKET_PATTERNS } from '../../src/format/plugging.ts'
import { EVIDENCE } from '../../src/format/mainsEvidence.ts'

const ROLES = ['L', 'N', 'PE']

/** Hole groups and the socket entry for one socket of `family` centred at (cx, cy); group names get `suffix` ("L1"). */
export function socket(family, id, cx, cy, suffix = '') {
  const pat = SOCKET_PATTERNS[family]
  if (!pat) throw new Error(`socket: unknown socket family "${family}"`)
  const roles = ROLES.filter((c) => pat[c].length)
  return {
    holes: roles.map((c) => ({ name: `${c}${suffix}`, label: c, at: pat[c].map(([x, y]) => [cx + x, cy + y]) })),
    socket: { id, family, contacts: roles.map((c) => ({ group: `${c}${suffix}`, role: c })) },
  }
}

/**
 * The plug profiles of `family` with contacts centred on the pivot (px, py). `roles` leaves out a
 * prong the device lacks (a two-pin plug). `mechanical` names the internal node of a pin that fills a
 * position without carrying a conductor (Ruling 39: the insulated earth pin of a class II BS 1363
 * plug is `{ PE: 'E pin' }`); a role given there is drawn as a `mains: "mechanical"` contact and must
 * not also be in `roles`.
 */
export function plugProfiles(family, px, py, roles = ROLES, mechanical = {}) {
  const profiles = PLUG_PROFILES[family]
  if (!profiles) throw new Error(`plugProfiles: unknown plug family "${family}"`)
  for (const c of Object.keys(mechanical))
    if (!ROLES.includes(c) || roles.includes(c)) throw new Error(`plugProfiles: mechanical "${c}" must be a position the device has no conducting prong for`)
  return profiles.map((pr) => ({
    id: pr.id,
    contacts: ROLES.flatMap((c) => {
      if (roles.includes(c)) return pr.contacts[c].map(([x, y]) => ({ pin: `${c} prong`, at: { x: px + x, y: py + y }, mains: c }))
      if (mechanical[c]) return pr.contacts[c].map(([x, y]) => ({ pin: mechanical[c], at: { x: px + x, y: py + y }, mains: 'mechanical' }))
      return []
    }),
  }))
}

/**
 * The conducting prong internal nodes of a plug with these roles, for `internalNodes` and ratings.
 * A mechanical pin (see `plugProfiles`) is an internal node too, but carries no conductor, so it is
 * added to `internalNodes` by the generator and never named by a rating, join or domain.
 */
export const prongs = (roles = ROLES) => roles.map((c) => `${c} prong`)

/**
 * One rating entry (spec 1.4). `extra` holds `amps`, `provenance` (`datasheet` only for the exact
 * part; clones and generic boards are `unverified`) and `conditions`. Its source goes in the module's
 * `source` and a comment beside the value.
 */
export const rating = (pins, kind, service, volts, extra = {}) => ({ pins, kind, service, volts, ...extra })

/** The evidence for `id`; a part whose evidence is not VERIFIED is never generated. */
export function verified(id) {
  const e = EVIDENCE[id]
  if (!e || e.verdict !== 'VERIFIED') throw new Error(`${id}: evidence is not VERIFIED, so the part is not generated`)
  return e
}

/**
 * The evidence for `id` when it is VERIFIED, or when it is NOT VERIFIED and its `blocking` or
 * `decision` records Michael's ruling `ruling` on it ("B2": generate the Hi-Link modules with
 * isolation "unknown"). Anything else throws, so an uncleared part is never generated.
 */
export function cleared(id, ruling) {
  const e = EVIDENCE[id]
  if (e?.verdict === 'VERIFIED') return e
  if (e && ruling && `${e.blocking ?? ''} ${e.decision ?? ''}`.includes(`Ruling ${ruling} `)) return e
  throw new Error(`${id}: evidence is not VERIFIED${ruling ? ` and records no ruling ${ruling}` : ''}, so the part is not generated`)
}

/** The evidence's terminal rating for `id` (its first rating entry, with its conditions when it has any); throws unless the evidence is VERIFIED and records one. */
export function rated(id) {
  const [x] = verified(id).ratings ?? []
  if (!x || x.amps === undefined) throw new Error(`${id}: the evidence records no terminal rating`)
  return { volts: x.volts, amps: x.amps, service: x.service, ...(x.conditions ? { conditions: x.conditions } : {}) }
}
