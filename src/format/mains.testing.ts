// Synthetic mains modules for the checker tests: small, on the 10 px grid, each declaring only what
// its tests need. Not real parts (those come from scripts/gen-mains-*.mjs). Every one passes
// validateModule (checked in mainsGraph.test.ts). Contact patterns follow src/format/plugging.ts.
import type { Connection, Diagram, PartInstance } from './diagram.ts'
import type { ModuleDef } from './module.ts'

const mod = (m: Omit<ModuleDef, 'format'>): ModuleDef => ({ format: 'circuitoon-module/1', ...m })
const ac = (pins: string[], volts: number, extra: Record<string, unknown> = {}) => ({ pins, kind: 'terminal', service: 'ac', volts, provenance: 'datasheet', ...extra })

/** A US outlet: a board whose NEMA 5-15R socket holes (centred on its pivot) are the source's L, N and PE. */
const usOutlet = (id: string, name: string) => mod({
  id, name, pins: [], size: { w: 6, h: 6 }, obstacle: false,
  holes: [{ name: 'N', at: [[20, 30]] }, { name: 'L', at: [[40, 30]] }, { name: 'PE', at: [[30, 50]] }],
  electrical: {
    params: { acVoltage: { unit: 'VAC', default: 120 } }, ac: { hz: 60, region: 'us' },
    acSources: [{ id: 'supply', live: ['L'], neutral: ['N'], earth: ['PE'] }],
    sockets: [{ id: 'main', family: 'nema-5-15r', contacts: [{ group: 'L', role: 'L' }, { group: 'N', role: 'N' }, { group: 'PE', role: 'PE' }] }],
    ratings: [ac(['L', 'N', 'PE'], 125, { amps: 15 })],
  },
})
export const outlet = usOutlet('t-outlet', 'Test outlet (US)')
export const outlet2 = usOutlet('t-outlet-2', 'Second test outlet (US)')
/** A Schuko (CEE 7/3) outlet at 230 V: L and N pins, earth clips above and below. */
export const outletEU = mod({
  id: 't-outlet-eu', name: 'Test outlet (Schuko)', pins: [], size: { w: 8, h: 8 }, obstacle: false,
  holes: [{ name: 'L', at: [[20, 40]] }, { name: 'N', at: [[60, 40]] }, { name: 'PE', at: [[40, 10], [40, 70]] }],
  electrical: {
    params: { acVoltage: { unit: 'VAC', default: 230 } }, ac: { hz: 50, region: 'eu' },
    acSources: [{ id: 'supply', live: ['L'], neutral: ['N'], earth: ['PE'] }],
    sockets: [{ id: 'main', family: 'cee7-3', contacts: [{ group: 'L', role: 'L' }, { group: 'N', role: 'N' }, { group: 'PE', role: 'PE' }] }],
    ratings: [ac(['L', 'N', 'PE'], 250, { amps: 16 })],
  },
})

const psuPins = [
  { name: 'AC1', side: 'left', mains: 'line' }, { name: 'AC2', side: 'left', mains: 'line' },
  { name: '+V', side: 'right', type: 'power_out', supply: '5V' }, { name: '-V', side: 'right', type: 'ground' },
] as ModuleDef['pins']
const psuInput = { acInput: { a: 'AC1', b: 'AC2', range: [100, 240] } }
const domains = (out: 'selv' | 'pelv') => [{ name: 'mains', pins: ['AC1', 'AC2'], kind: 'mains' }, { name: 'out', pins: ['+V', '-V'], kind: out }]
/** A class 1 supply: an earth pin, and its -V bonded to it. */
const earthedPins = [...psuPins.slice(0, 3), { name: '-V', side: 'right', type: 'ground', bond: 'pe' }, { name: 'PE', side: 'left', mains: 'PE' }] as ModuleDef['pins']
export const psu = mod({ id: 't-psu', name: 'Test AC-DC 5 V (reinforced)', pins: psuPins, electrical: { ...psuInput, domains: domains('selv'), isolation: 'reinforced', isolationProvenance: 'datasheet', protection: 'class-2' } })
export const psuBasic = mod({ id: 't-psu-basic', name: 'Test AC-DC 5 V (basic)', pins: psuPins, electrical: { ...psuInput, domains: domains('selv'), isolation: 'basic', isolationProvenance: 'datasheet', protection: 'class-2' } })
export const psuScreen = mod({ id: 't-psu-screen', name: 'Test AC-DC 5 V (basic plus screen, PELV)', pins: earthedPins, internal: [['-V', 'PE']],
  electrical: { ...psuInput, domains: domains('pelv'), isolation: 'basic', isolationProvenance: 'datasheet', safeguard: 'protective-screen', protection: 'class-1' } })
export const psuBasicBonded = mod({ id: 't-psu-basic-bonded', name: 'Test AC-DC 5 V (basic, earthed)', pins: earthedPins, internal: [['-V', 'PE']],
  electrical: { ...psuInput, domains: domains('pelv'), isolation: 'basic', isolationProvenance: 'datasheet', protection: 'class-1' } })
export const psuPelv = mod({ id: 't-psu-pelv', name: 'Test AC-DC 5 V (reinforced, PELV)', pins: earthedPins, internal: [['-V', 'PE']],
  electrical: { ...psuInput, domains: domains('pelv'), isolation: 'reinforced', isolationProvenance: 'datasheet', protection: 'class-1' } })

const lampPins = [{ name: 'L', side: 'left', mains: 'L' }, { name: 'N', side: 'right', mains: 'N' }] as ModuleDef['pins']
/** A 230 V lamp holder, class 2 (the EU fixtures and Task 9's unpolarized-outlet test use it). */
export const lamp230 = mod({ id: 't-lamp-230', name: 'Test lamp 230 V', pins: [{ name: 'L', side: 'left', mains: 'L' }, { name: 'N', side: 'right', mains: 'N' }] as ModuleDef['pins'],
  electrical: { conducts: [{ pins: ['L', 'N'], kind: 'load', range: [220, 240] }], protection: 'class-2', ratings: [ac(['L', 'N'], 250)] } })
/** A converter whose output domain is labelled PELV but has no bond at all: SELV in effect (Resolution 9). */
export const psuMislabeled = mod({ id: 't-psu-mislabeled', name: 'Test AC-DC 5 V (PELV label, no bond)', pins: psuPins,
  electrical: { ...psuInput, domains: domains('pelv'), isolation: 'reinforced', isolationProvenance: 'datasheet', protection: 'class-2' } })
/** A 120 V lamp holder: centre contact L, screw shell N. */
export const lamp = mod({ id: 't-lamp', name: 'Test lamp 120 V', pins: lampPins,
  electrical: { conducts: [{ pins: ['L', 'N'], kind: 'load', range: [110, 130] }], protection: 'class-2', ratings: [ac(['L', 'N'], 250)] } })
export const lampC1 = mod({ id: 't-lamp-c1', name: 'Test class 1 lamp 120 V', pins: [...lampPins, { name: 'PE', side: 'bottom', mains: 'PE' }],
  electrical: { conducts: [{ pins: ['L', 'N'], kind: 'load', range: [110, 130] }], protection: 'class-1', ratings: [ac(['L', 'N', 'PE'], 250)] } })

export const sw = mod({ id: 't-switch', name: 'Test switch', pins: [{ name: '1', side: 'left', type: 'passive' }, { name: '2', side: 'right', type: 'passive' }],
  electrical: { contacts: [{ id: 's', kind: 'switch', poles: [{ com: '1', no: '2' }] }], ratings: [{ pins: ['1', '2'], kind: 'switching', service: 'ac', volts: 250, amps: 6, provenance: 'datasheet' }] } })
export const relay = mod({ id: 't-relay', name: 'Test relay', pins: [
  { name: 'COM', side: 'left', type: 'passive' }, { name: 'NO', side: 'left', type: 'passive' }, { name: 'NC', side: 'left', type: 'passive' },
  { name: '+', side: 'right', type: 'power_in', supply: '5V' }, { name: '-', side: 'right', type: 'ground' },
], electrical: {
  contacts: [{ id: 'k', kind: 'relay', poles: [{ com: 'COM', no: 'NO', nc: 'NC' }] }],
  domains: [{ name: 'contacts', pins: ['COM', 'NO', 'NC'], kind: 'mains' }, { name: 'coil', pins: ['+', '-'], kind: 'selv' }], isolation: 'reinforced', isolationProvenance: 'datasheet',
  ratings: [{ pins: ['COM', 'NO', 'NC'], kind: 'switching', service: 'ac', volts: 250, amps: 10, provenance: 'datasheet' }],
} })
export const ssr = mod({ id: 't-ssr', name: 'Test SSR', pins: [
  { name: '1', side: 'left', type: 'passive' }, { name: '2', side: 'left', type: 'passive' },
  { name: '3', side: 'right', type: 'input' }, { name: '4', side: 'right', type: 'ground' },
], electrical: {
  contacts: [{ id: 'k', kind: 'ssr', poles: [{ com: '1', no: '2' }] }],
  domains: [{ name: 'load', pins: ['1', '2'], kind: 'mains' }, { name: 'control', pins: ['3', '4'], kind: 'selv' }], isolation: 'reinforced', isolationProvenance: 'datasheet',
  ratings: [{ pins: ['1', '2'], kind: 'switching', service: 'ac', volts: 380, amps: 25, provenance: 'datasheet' }],
} })
export const fuse = mod({ id: 't-fuse', name: 'Test fuse holder', pins: [{ name: '1', side: 'left', type: 'passive' }, { name: '2', side: 'right', type: 'passive' }],
  electrical: { protective: [{ from: '1', to: '2', kind: 'fuse' }], params: { fuseRating: { unit: 'A' } }, settings: { fuse: ['fitted', 'absent'] }, ratings: [ac(['1', '2'], 250)] } })

const termPins = [{ name: '1', side: 'left' }, { name: '2', side: 'left' }, { name: '1b', side: 'right' }, { name: '2b', side: 'right' }] as ModuleDef['pins']
const term = (id: string, name: string, electrical: Record<string, unknown>) => mod({ id, name, pins: termPins, internal: [['1', '1b'], ['2', '2b']], electrical })
const all = ['1', '2', '1b', '2b']
export const block = term('t-term', 'Test terminal block 300 V', { ratings: [ac(all, 300)] })
export const block125 = term('t-term-125', 'Test terminal block 125 V', { ratings: [ac(all, 125)] })
export const blockDc = term('t-term-dc', 'Test terminal block 300 V DC', { ratings: [{ ...ac(all, 300), service: 'dc' }] })
export const blockCond = term('t-term-cond', 'Test terminal block with conditions', { ratings: [ac(all, 300, { conditions: 'for overvoltage category III and pollution degree 2' })] })
export const blockBare = term('t-term-bare', 'Test terminal block, no rating', { domains: [{ name: 'm', pins: all, kind: 'mains' }] })
export const blockUnverified = term('t-term-unverified', 'Test terminal block clone', { ratings: [ac(all, 300, { provenance: 'unverified' })] })

/** A low-voltage board: an I/O pin, a ground and a 5 V input. No mains data at all. */
export const mcu = mod({ id: 't-mcu', name: 'Test board', pins: [
  { name: 'IO', side: 'right', type: 'io' }, { name: 'GND', side: 'left', type: 'ground' }, { name: 'VCC', side: 'left', type: 'power_in', supply: '5V' },
] })
/** The same board with a 3.3 V only input. */
export const mcu33 = mod({ id: 't-mcu33', name: 'Test 3.3 V board', pins: [
  { name: 'IO', side: 'right', type: 'io' }, { name: 'GND', side: 'left', type: 'ground' }, { name: 'VCC', side: 'left', type: 'power_in', supply: '3V3' },
] })
/** A 9 V battery: a DC source that is not a mains part. */
export const bat9 = mod({ id: 't-bat9', name: 'Test 9 V battery', pins: [{ name: '+', side: 'top', type: 'power_out', supply: '9V' }, { name: '-', side: 'top', type: 'ground' }] })
/** A double-pole relay: both poles switch together (spec 1.5, linked poles). */
export const relay2p = mod({ id: 't-relay-2p', name: 'Test double-pole relay', pins: [
  ...['COM1', 'NO1', 'NC1', 'COM2', 'NO2', 'NC2'].map((name) => ({ name, side: 'left', type: 'passive' })),
  { name: '+', side: 'right', type: 'power_in', supply: '5V' }, { name: '-', side: 'right', type: 'ground' },
] as ModuleDef['pins'], electrical: {
  contacts: [{ id: 'k', kind: 'relay', poles: [{ com: 'COM1', no: 'NO1', nc: 'NC1' }, { com: 'COM2', no: 'NO2', nc: 'NC2' }] }],
  domains: [{ name: 'contacts', pins: ['COM1', 'NO1', 'NC1', 'COM2', 'NO2', 'NC2'], kind: 'mains' }, { name: 'coil', pins: ['+', '-'], kind: 'selv' }], isolation: 'reinforced', isolationProvenance: 'datasheet',
  ratings: [{ pins: ['COM1', 'NO1', 'NC1', 'COM2', 'NO2', 'NC2'], kind: 'switching', service: 'ac', volts: 250, amps: 10, provenance: 'datasheet' }],
} })
/**
 * A converter that declares only its mains domain: its outputs are in no domain (Resolution 27). It
 * states no isolation, since isolation rates a barrier to a SELV or PELV domain it does not have.
 */
export const psuMainsOnly = mod({ id: 't-psu-mainsonly', name: 'Test AC-DC 5 V (outputs in no domain)', pins: psuPins,
  electrical: { ...psuInput, domains: [{ name: 'mains', pins: ['AC1', 'AC2'], kind: 'mains' }], protection: 'class-2' } })
/** A changeover (SPDT) switch: its pole has an NC contact, so its states are worded "switched to NC" and "switched to NO". */
export const swChangeover = mod({ id: 't-switch-co', name: 'Test changeover switch', pins: [
  { name: 'C', side: 'left', type: 'passive' }, { name: 'A', side: 'right', type: 'passive' }, { name: 'B', side: 'right', type: 'passive' },
], electrical: { contacts: [{ id: 's', kind: 'switch', poles: [{ com: 'C', no: 'A', nc: 'B' }] }], ratings: [{ pins: ['C', 'A', 'B'], kind: 'switching', service: 'ac', volts: 250, amps: 6, provenance: 'datasheet' }] } })
/** A two-channel relay board: two independent contact groups on one part, told apart by their COM labels. */
export const relayBoard2 = mod({ id: 't-relay-board-2', name: 'Test two-channel relay board', pins: [
  ...['1', '2'].flatMap((n) => ['COM', 'NO', 'NC'].map((c) => ({ name: `${c}${n}`, side: 'left', type: 'passive' }))),
  { name: '+', side: 'right', type: 'power_in', supply: '5V' }, { name: '-', side: 'right', type: 'ground' },
] as ModuleDef['pins'], electrical: {
  contacts: [{ id: 'k1', kind: 'relay', poles: [{ com: 'COM1', no: 'NO1', nc: 'NC1' }] }, { id: 'k2', kind: 'relay', poles: [{ com: 'COM2', no: 'NO2', nc: 'NC2' }] }],
  domains: [{ name: 'contacts', pins: ['COM1', 'NO1', 'NC1', 'COM2', 'NO2', 'NC2'], kind: 'mains' }, { name: 'coil', pins: ['+', '-'], kind: 'selv' }], isolation: 'reinforced', isolationProvenance: 'datasheet',
  ratings: [{ pins: ['COM1', 'NO1', 'NC1', 'COM2', 'NO2', 'NC2'], kind: 'switching', service: 'ac', volts: 250, amps: 10, provenance: 'datasheet' }],
} })
/** A part with mains terminals and no conduction data. */
export const undeclared = mod({ id: 't-undeclared', name: 'Test part without mains data', pins: [{ name: 'A', side: 'left', mains: 'L' }, { name: 'B', side: 'right', mains: 'N' }] })

export const MAINS_MODULES: Record<string, ModuleDef> = Object.fromEntries(
  [outlet, outlet2, outletEU, psu, psuBasic, psuBasicBonded, psuScreen, psuPelv, lamp, lampC1, sw, relay, ssr, fuse, block, block125, blockDc, blockCond, blockBare, blockUnverified, mcu, mcu33, undeclared, bat9, relay2p, psuMainsOnly, lamp230, psuMislabeled, swChangeover, relayBoard2]
    .map((m) => [m.id, m]),
)

export const at = (uid: string, designator: string, module: string, x = 0, y = 0, extra: Partial<PartInstance> = {}): PartInstance =>
  ({ uid, designator, module, x, y, rotation: 0, ...extra })

let seq = 0
/** A wire "uid|pin" to "uid|pin", mains-suitable by default (18 AWG, ferrules), so only cable-unverified ever applies to it. */
export const w = (a: string, b: string, extra: Partial<Connection> = {}): Connection => {
  const end = (s: string) => {
    const [part, pin] = s.split('|')
    return { part, pin }
  }
  return { uid: `w${++seq}`, from: end(a), to: end(b), gauge: 18, ends: { from: 'ferrule', to: 'ferrule' }, ...extra }
}
/** A 26 AWG Dupont jumper, clearly unsuitable for mains. */
export const dupont = (a: string, b: string): Connection => w(a, b, { gauge: 26, ends: { from: 'dupont-female', to: 'dupont-female' } })
export const sheet = (parts: PartInstance[], connections: Connection[], modules: Record<string, ModuleDef> = {}): Diagram =>
  ({ format: 'circuitoon-diagram/1', title: 't', modules: { ...MAINS_MODULES, ...modules }, parts, connections })
