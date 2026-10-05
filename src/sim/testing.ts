// Small sheets for the simulator's tests: parts from the built-in library (by id) or inline modules,
// wired pin to pin with "uid.pin" ends. The inline modules carry only what the simulator reads.
import type { Connection, Diagram, PartInstance } from '../format/diagram.ts'
import type { ModuleDef, PinDef } from '../format/module.ts'
import type { Provenance, Quantity, Rail, SimUnit } from '../format/simModel.ts'
import { load } from '../format/builtinModules.testing.ts'

export type PartSpec = { uid: string; module: string | ModuleDef; designator?: string; values?: Record<string, unknown>; settings?: Record<string, string> }

export function sheet(parts: PartSpec[], wires: [string, string][]): Diagram {
  const modules: Record<string, ModuleDef> = {}
  const insts: PartInstance[] = parts.map((p, i) => {
    const m = typeof p.module === 'string' ? load(p.module) : p.module
    modules[m.id] = m
    return {
      uid: p.uid, designator: p.designator ?? p.uid.toUpperCase(), module: m.id, x: (i % 6) * 400, y: Math.floor(i / 6) * 400,
      ...(p.values ? { values: p.values } : {}), ...(p.settings ? { settings: p.settings } : {}),
    }
  })
  const end = (s: string) => ({ part: s.slice(0, s.indexOf('.')), pin: s.slice(s.indexOf('.') + 1) })
  const connections: Connection[] = wires.map(([a, b], i) => ({ uid: `w${i + 1}`, from: end(a), to: end(b) }))
  return { format: 'circuitoon-diagram/1', title: 'test', modules, parts: insts, connections }
}

/** A Quantity with a source (or, for an estimate, a note). */
export const q = (value: number, unit: SimUnit, provenance: Provenance = 'datasheet'): Quantity =>
  provenance === 'estimate' ? { value, unit, provenance, note: 'test value' } : { value, unit, provenance, source: 'https://example.com/test-datasheet' }

const pins = (list: (Omit<PinDef, 'side'> & { side?: PinDef['side'] })[]): PinDef[] => list.map((p, i) => ({ side: i % 2 ? 'right' : 'left', ...p }))
const mod = (id: string, p: PinDef[], electrical: Record<string, unknown>): ModuleDef => ({ format: 'circuitoon-module/1', id, name: id, pins: p, electrical })

/** A cell with its own rInternal (stable across the library's sourced battery data). */
export function cellModule(volts: number, rInternal: number, id = 'test-cell'): ModuleDef {
  return mod(id, pins([{ name: '+', type: 'power_out' }, { name: '-', type: 'ground' }]), {
    model: 'voltage_source', terminals: { pos: '+', neg: '-' }, params: { voltage: { unit: 'V', default: volts } },
    sim: { modelParams: { rInternal: q(rInternal, 'ohm', 'representative') }, limits: [{ of: { part: true }, kind: 'sourceCurrent', value: 2, provenance: 'representative', source: 'https://example.com/cell' }] },
  })
}

type RailOpts = Partial<Rail>
const regulator = (id: string, inNominal: number, outNominal: number, rail: Rail): ModuleDef =>
  mod(id, pins([{ name: 'IN', type: 'power_in' }, { name: 'OUT', type: 'power_out' }, { name: 'GND', type: 'ground' }]), {
    model: 'regulator',
    sim: { power: { domains: [{ name: 'IN', pin: 'IN', ret: 'GND', nominal: inNominal }, { name: 'OUT', pin: 'OUT', ret: 'GND', nominal: outNominal }], rails: [rail] } },
  })

/** A 3.3 V LDO: dropout 1.1 V, 0.8 A, iq 5 mA. */
export function ldoModule(o: RailOpts = {}, id = 'test-ldo'): ModuleDef {
  return regulator(id, 5, 3.3, { id: 'ldo', inputs: [{ domain: 'IN', via: 'direct' }], output: 'OUT', kind: 'ldo', vout: q(3.3, 'V'), dropout: q(1.1, 'V'), ioutMax: q(0.8, 'A'), iq: q(0.005, 'A'), reverse: 'blocks', ...o })
}
/** A 5 V buck: 6 to 24 V in, 90 % efficient, 2 A. */
export function buckModule(o: RailOpts = {}, id = 'test-buck'): ModuleDef {
  return regulator(id, 12, 5, { id: 'buck', inputs: [{ domain: 'IN', via: 'direct' }], output: 'OUT', kind: 'buck', vout: q(5, 'V'), efficiency: q(0.9, '1'), vinMin: q(6, 'V'), vinMax: q(24, 'V'), ioutMax: q(2, 'A'), reverse: 'blocks', ...o })
}
/** A 5 V boost from one Li-ion cell: 2.9 to 4.3 V in, 90 %, 2 A, pass-through diode when off. */
export function boostModule(o: RailOpts = {}, id = 'test-boost'): ModuleDef {
  return regulator(id, 3.7, 5, { id: 'boost', inputs: [{ domain: 'IN', via: 'direct' }], output: 'OUT', kind: 'boost', vout: q(5, 'V'), efficiency: q(0.9, '1'), vinMin: q(2.9, 'V'), vinMax: q(4.3, 'V'), ioutMax: q(2, 'A'), reverse: 'blocks', offPath: 'diode', ...o })
}

/**
 * A DevKit-like board: VIN and USB VBUS (through a 0.3 V Schottky) feed a 3.3 V LDO; the 3V3
 * domain draws 50 mA typical (250 mA peak, "radio"); IO1 and IO2 are GPIOs (30 ohm, 45 k pulls).
 */
export function boardModule(o: { draw?: boolean; minVolts?: number; leak?: boolean } = {}, id = 'test-board'): ModuleDef {
  return mod(id, pins([
    { name: 'VIN', type: 'power_in' }, { name: 'GND', type: 'ground' }, { name: '3V3', type: 'power_out' },
    { name: 'IO1', type: 'io' }, { name: 'IO2', type: 'io' },
    { name: 'USB', type: 'usb', usb: { connector: 'micro-B', gender: 'receptacle', role: 'device' } },
  ]), {
    model: 'mcu',
    sim: {
      usbPorts: { USB: { gnd: 'GND' } },
      power: {
        domains: [{ name: 'VIN', pin: 'VIN', ret: 'GND', nominal: 5 }, { name: 'USB', pin: 'USB#vbus', ret: 'USB#gnd', nominal: 5 }, { name: '3V3', pin: '3V3', ret: 'GND', nominal: 3.3 }],
        ...(o.draw === false ? {} : { draw: [{ domain: '3V3', typical: q(0.05, 'A'), peak: { ...q(0.25, 'A'), note: 'radio' }, ...(o.minVolts ? { minVolts: q(o.minVolts, 'V') } : {}) }] }),
        rails: [
          { id: 'usb-diode', inputs: [{ domain: 'USB', via: 'direct' }], output: 'VIN', kind: 'switch', vf: q(0.3, 'V'), reverse: 'blocks' },
          { id: 'ldo', inputs: [{ domain: 'VIN', via: 'direct' }], output: '3V3', kind: 'ldo', vout: q(3.3, 'V'), dropout: q(1.1, 'V'), ioutMax: q(0.8, 'A'), iq: q(0.005, 'A'), reverse: 'blocks' },
        ],
      },
      gpio: { domain: '3V3', pins: ['IO1', 'IO2'], outputResistance: q(30, 'ohm'), pullup: q(45000, 'ohm'), pulldown: q(45000, 'ohm'), ...(o.leak ? { inputLeakage: q(5e-8, 'A') } : {}) },
      limits: [
        { of: { pin: 'IO1' }, kind: 'current', value: 0.02, provenance: 'datasheet', source: 'https://example.com/board' },
        { of: { pin: 'IO1' }, kind: 'absMaxCurrent', value: 0.04, provenance: 'datasheet', source: 'https://example.com/board' },
        { of: { domain: '3V3' }, kind: 'ioTotalCurrent', value: 0.1, provenance: 'datasheet', source: 'https://example.com/board' },
      ],
    },
  })
}

/** A computer's USB-A port: a 5 V supply with 50 milliohm and a 500 mA limit, ground only on the port (ruling R5). */
export function hostModule(id = 'test-host'): ModuleDef {
  return mod(id, pins([{ name: 'USB', type: 'usb', usb: { connector: 'A', gender: 'receptacle', role: 'host', version: '2.0', source: 500 } }]), {
    model: 'computer',
    sim: { power: { domains: [{ name: 'USB', pin: 'USB#vbus', ret: 'USB#gnd', nominal: 5 }], source: { domain: 'USB', voltage: q(5, 'V'), rInternal: q(0.05, 'ohm', 'estimate'), imax: q(0.5, 'A') } } },
  })
}

/** A sheet from a netlist with each net wired pin to pin in order (no layout: the simulator needs only connectivity). Uids are the refs. */
export function netSheet(n: { parts: { ref: string; module: string; values?: Record<string, unknown> }[]; nets: { name: string; pins: string[] }[] }): Diagram {
  const wires = n.nets.flatMap((net) => net.pins.slice(1).map((p, i): [string, string] => [net.pins[i], p]))
  return sheet(n.parts.map((p) => ({ uid: p.ref, module: p.module, designator: p.ref, ...(p.values ? { values: p.values } : {}) })), wires)
}
