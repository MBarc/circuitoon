// Plugs and sockets (spec section 2): the stylized contact pattern of each family on the 10 px grid,
// and the compatibility table that says which plug profile seats in which socket, in which
// orientations and with which contact mapping. Real dimensions are cited in the part generators
// (scripts/gen-mains-*.mjs); these patterns only keep each family's layout distinct. Pure data.
import type { Rotation } from './geometry.ts'
import type { Conductor, PlugFamily, SocketFamily } from './mainsModel.ts'

/** Contact offsets in px from the socket's (or plug's) centre, y down, seen from the front of the outlet. */
export type Pattern = Record<Conductor, [number, number][]>

const NEMA3: Pattern = { L: [[10, 0]], N: [[-10, 0]], PE: [[0, 20]] }
const NEMA2: Pattern = { L: [[10, 0]], N: [[-10, 0]], PE: [] }
const CEE_CLIPS: Pattern = { L: [[-20, 0]], N: [[20, 0]], PE: [[0, -30], [0, 30]] }
const CEE_PIN: Pattern = { L: [[-20, 0]], N: [[20, 0]], PE: [[0, -30]] }
const CEE2: Pattern = { L: [[-20, 0]], N: [[20, 0]], PE: [] }
const BS: Pattern = { L: [[30, 10]], N: [[-30, 10]], PE: [[0, -20]] }
// Ruling B4: seen from the front with the earth down, the active (L) is top left (Task 0 evidence).
const AS: Pattern = { L: [[-10, -10]], N: [[20, -10]], PE: [[0, 20]] }

export const SOCKET_PATTERNS: Record<SocketFamily, Pattern> = {
  'nema-5-15r': NEMA3, 'nema-5-20r': NEMA3, 'nema-1-15r': NEMA2, 'nema-1-15r-polarized': NEMA2,
  'cee7-3': CEE_CLIPS, 'cee7-5': CEE_PIN, 'cee7-16': CEE2, bs1363: BS, as3112: AS,
}

export const PLUG_PROFILES: Record<PlugFamily, { id: string; contacts: Pattern }[]> = {
  'nema-5-15p': [{ id: 'main', contacts: NEMA3 }],
  'nema-1-15p': [{ id: 'main', contacts: NEMA2 }],
  'nema-1-15p-polarized': [{ id: 'main', contacts: NEMA2 }],
  'cee7-7': [{ id: 'earth-clip', contacts: CEE_CLIPS }, { id: 'earth-hole', contacts: CEE_PIN }],
  'cee7-16': [{ id: 'main', contacts: CEE2 }],
  bs1363: [{ id: 'main', contacts: BS }],
  as3112: [{ id: 'main', contacts: AS }],
}

type Mapping = Record<Conductor, Conductor>
const SAME: Mapping = { L: 'L', N: 'N', PE: 'PE' }
const SWAP: Mapping = { L: 'N', N: 'L', PE: 'PE' }

export interface TableEntry {
  plug: PlugFamily
  socket: SocketFamily
  /** The plug profile that seats here. */
  profile: string
  /** Per allowed orientation, which socket contact each plug contact meets. */
  map: Partial<Record<Rotation, Mapping>>
}
const entry = (plug: PlugFamily, socket: SocketFamily, profile: string, turns: boolean): TableEntry =>
  ({ plug, socket, profile, map: turns ? { 0: SAME, 180: SWAP } : { 0: SAME } })

/** Spec section 2, tested pairwise at all four rotations (plugging.test.ts). */
export const COMPAT: TableEntry[] = [
  entry('nema-5-15p', 'nema-5-15r', 'main', false),
  entry('nema-5-15p', 'nema-5-20r', 'main', false),
  entry('nema-1-15p-polarized', 'nema-1-15r-polarized', 'main', false),
  entry('nema-1-15p-polarized', 'nema-5-15r', 'main', false),
  entry('nema-1-15p-polarized', 'nema-5-20r', 'main', false),
  // A narrow-blade plug enters either slot of any of these, polarized or not.
  entry('nema-1-15p', 'nema-1-15r', 'main', true),
  entry('nema-1-15p', 'nema-1-15r-polarized', 'main', true),
  entry('nema-1-15p', 'nema-5-15r', 'main', true),
  entry('nema-1-15p', 'nema-5-20r', 'main', true),
  entry('cee7-7', 'cee7-3', 'earth-clip', true),
  // The CEE 7/5 socket's earth pin enters the plug's earth hole only one way up.
  entry('cee7-7', 'cee7-5', 'earth-hole', false),
  entry('cee7-16', 'cee7-3', 'main', true),
  entry('cee7-16', 'cee7-5', 'main', true),
  entry('cee7-16', 'cee7-16', 'main', true),
  entry('bs1363', 'bs1363', 'main', false),
  entry('as3112', 'as3112', 'main', false),
]

/** The table indexed once by plug and socket family, so a lookup during seating allocates nothing. */
const INDEX = new Map<PlugFamily, Map<SocketFamily, TableEntry[]>>()
for (const e of COMPAT) {
  let bySocket = INDEX.get(e.plug)
  if (!bySocket) INDEX.set(e.plug, (bySocket = new Map()))
  const list = bySocket.get(e.socket)
  if (list) list.push(e)
  else bySocket.set(e.socket, [e])
}
const NONE: readonly TableEntry[] = Object.freeze([])

/** The table entries for a pair (empty when the plug does not fit that socket). Shared arrays: never mutate them. */
export const entriesFor = (plug: PlugFamily, socket: SocketFamily): readonly TableEntry[] => INDEX.get(plug)?.get(socket) ?? NONE

/** A plug's turn relative to the outlet it sits on. */
export const orientationOf = (part: { rotation?: Rotation }, board: { rotation?: Rotation }): Rotation =>
  ((((part.rotation ?? 0) - (board.rotation ?? 0)) % 360) + 360) % 360 as Rotation

export const PLUG_NAMES: Record<PlugFamily, string> = {
  'nema-5-15p': 'US plug', 'nema-1-15p': 'US/Japanese plug', 'nema-1-15p-polarized': 'US plug',
  'cee7-7': 'Schuko plug', 'cee7-16': 'Europlug', bs1363: 'UK plug', as3112: 'Australian plug',
}
export const SOCKET_NAMES: Record<SocketFamily, string> = {
  'nema-5-15r': 'US socket', 'nema-5-20r': 'US socket', 'nema-1-15r': 'Japanese socket', 'nema-1-15r-polarized': 'Japanese socket',
  'cee7-3': 'Schuko socket', 'cee7-5': 'French socket', 'cee7-16': 'Europlug socket', bs1363: 'UK socket', as3112: 'Australian socket',
}
/** What to use instead, per socket family ("Use a device with a US plug"). */
export const PLUG_FOR: Record<SocketFamily, string> = {
  'nema-5-15r': 'a US plug', 'nema-5-20r': 'a US plug', 'nema-1-15r': 'a Japanese plug', 'nema-1-15r-polarized': 'a Japanese plug',
  'cee7-3': 'a Schuko plug or a Europlug', 'cee7-5': 'a French or Schuko (CEE 7/7) plug', 'cee7-16': 'a Europlug', bs1363: 'a UK plug', as3112: 'an Australian plug',
}
