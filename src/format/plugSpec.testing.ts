// Spec section 2's compatibility table, transcribed by hand for the tests: which plug family (and
// profile) seats in which socket family, at which turns. Kept apart from src/format/plugging.ts on
// purpose: a row missing from the implementation must fail a test, not change its expectation.
import type { Rotation } from './geometry.ts'
import type { Conductor, PlugFamily, SocketFamily } from './mainsModel.ts'

export const SPEC_COMPAT: { plug: PlugFamily; socket: SocketFamily; profile: string; turns: Rotation[] }[] = [
  // NEMA 5-15P in 5-15R and 5-20R (0 only).
  { plug: 'nema-5-15p', socket: 'nema-5-15r', profile: 'main', turns: [0] },
  { plug: 'nema-5-15p', socket: 'nema-5-20r', profile: 'main', turns: [0] },
  // 1-15P polarized in 1-15R polarized, 5-15R, 5-20R (0 only).
  { plug: 'nema-1-15p-polarized', socket: 'nema-1-15r-polarized', profile: 'main', turns: [0] },
  { plug: 'nema-1-15p-polarized', socket: 'nema-5-15r', profile: 'main', turns: [0] },
  { plug: 'nema-1-15p-polarized', socket: 'nema-5-20r', profile: 'main', turns: [0] },
  // 1-15P unpolarized in 1-15R (both variants, Resolution 4), 5-15R, 5-20R (0 and 180).
  { plug: 'nema-1-15p', socket: 'nema-1-15r', profile: 'main', turns: [0, 180] },
  { plug: 'nema-1-15p', socket: 'nema-1-15r-polarized', profile: 'main', turns: [0, 180] },
  { plug: 'nema-1-15p', socket: 'nema-5-15r', profile: 'main', turns: [0, 180] },
  { plug: 'nema-1-15p', socket: 'nema-5-20r', profile: 'main', turns: [0, 180] },
  // CEE 7/7 in CEE 7/3 via its earth clips (0 and 180), in CEE 7/5 via its earth hole (0 only).
  { plug: 'cee7-7', socket: 'cee7-3', profile: 'earth-clip', turns: [0, 180] },
  { plug: 'cee7-7', socket: 'cee7-5', profile: 'earth-hole', turns: [0] },
  // Europlug in CEE 7/3, 7/5 and 7/16 (0 and 180, no earth).
  { plug: 'cee7-16', socket: 'cee7-3', profile: 'main', turns: [0, 180] },
  { plug: 'cee7-16', socket: 'cee7-5', profile: 'main', turns: [0, 180] },
  { plug: 'cee7-16', socket: 'cee7-16', profile: 'main', turns: [0, 180] },
  // BS 1363 and AS/NZS 3112 in their own only (0 only).
  { plug: 'bs1363', socket: 'bs1363', profile: 'main', turns: [0] },
  { plug: 'as3112', socket: 'as3112', profile: 'main', turns: [0] },
]

/** The allowed turns for a pair, from the spec (none when the spec lists no row). */
export const specTurns = (plug: PlugFamily, socket: SocketFamily): Rotation[] => SPEC_COMPAT.find((r) => r.plug === plug && r.socket === socket)?.turns ?? []

/** Which socket contact a plug contact of `role` meets at `turn`: turned half way round, L and N swap; earth stays earth. */
export const specMapping = (turn: Rotation, role: Conductor): Conductor => (turn === 180 && role !== 'PE' ? (role === 'L' ? 'N' : 'L') : role)
