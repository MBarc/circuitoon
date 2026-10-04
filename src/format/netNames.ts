// Net names shared by the netlist extractor (agent/extract.ts) and the KiCad export (kicad.ts):
// labels, then roles (GND, a supply rail such as 5V or 3V3), then a pin. Pure.
import { holeGroupOf, isBoard, isSpacer, type ModuleDef, type PinDef, type PinType } from './module.ts'

/** A pin's (or a header pad's) type and supply. Breadboard strips have neither. */
const pinDef = (m: ModuleDef, name: string): { type?: PinType; supply?: string } | undefined =>
  m.pins.find((p): p is PinDef => !isSpacer(p) && p.name === name) ?? holeGroupOf(m, name)
/** A supply rail name worth naming a net after: 5V, 3V3, 12V (not 3.7V or 5V/7V). */
const RAIL = /^\d+V\d*$/

/** A pin on a net, for naming it: its part's ref, the pin name and the part's module. */
export interface NamedPin {
  ref: string
  name: string
  m: ModuleDef
}

/**
 * One unique name per net: its net label first, then ground (GND, GND_2 ...), then a supply rail
 * the consumers share or one source gives (5V, 3V3), then `<ref>_<pin>` of an MCU pin, else a
 * source's pin, else the first component pin. `pins` must be in a stable order (they decide the
 * fallback name). Shared by the netlist extractor and the KiCad export.
 */
export function nameNets(nets: { pins: NamedPin[]; label?: string }[]): string[] {
  const names = new Set<string>()
  const named: (string | undefined)[] = nets.map(() => undefined)
  const claim = (i: number, name: string | undefined) => {
    if (named[i] !== undefined || !name || names.has(name)) return
    named[i] = name
    names.add(name)
  }
  const types = (net: (typeof nets)[number]) => net.pins.map((p) => pinDef(p.m, p.name))
  nets.forEach((net, i) => claim(i, net.label))
  nets.forEach((net, i) => {
    if (!types(net).some((t) => t?.type === 'ground')) return
    let name = 'GND'
    for (let k = 2; names.has(name) && named[i] === undefined; k++) name = `GND_${k}`
    claim(i, name)
  })
  nets.forEach((net, i) => {
    const ins = types(net).filter((t) => t?.type === 'power_in' && t.supply).map((t) => t!.supply!.split('/'))
    if (!ins.length) return
    const common = ins.reduce((a, b) => a.filter((r) => b.includes(r)))
    if (common.length === 1 && RAIL.test(common[0])) claim(i, common[0])
  })
  nets.forEach((net, i) => {
    const outs = [...new Set(types(net).filter((t) => t?.type === 'power_out' && t.supply && RAIL.test(t.supply)).map((t) => t!.supply!))]
    if (outs.length === 1) claim(i, outs[0])
  })
  nets.forEach((net, i) => {
    if (named[i] !== undefined || !net.pins.length) return
    // An MCU's pin names a signal best; else a source's pin; else the first component pin.
    const pick = net.pins.find((p) => p.m.category === 'Microcontrollers') ?? net.pins.find((p) => pinDef(p.m, p.name)?.type === 'power_out') ?? net.pins.find((p) => !isBoard(p.m)) ?? net.pins[0]
    let name = `${pick.ref}_${pick.name}`
    for (let k = 2; names.has(name); k++) name = `${pick.ref}_${pick.name}_${k}`
    claim(i, name)
  })
  return named.map((n) => n!)
}
