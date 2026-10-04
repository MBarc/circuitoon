// The USB rules (USB design section 3): each fires on the mistake it is for and stays quiet on the
// correct hookup. Small stand-in parts keep each case readable; usbParts.test.ts covers the library.
import { describe, expect, it } from 'vitest'
import { checkDiagram } from './checks.ts'
import type { Connection, Diagram, PartInstance } from './diagram.ts'
import { type ModuleDef, validateModule } from './module.ts'
import { isPluggedIn, usbEndsFor, usbFedParts } from './usb.ts'
import { billOfMaterials } from './bom.ts'
import type { WireEnds } from './cables.ts'

function mod(id: string, pins: unknown[], electrical: Record<string, unknown> = { params: {} }): ModuleDef {
  const r = validateModule({ format: 'circuitoon-module/1', id, name: id, pins, electrical })
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.module
}
const usb = (name: string, side: string, u: Record<string, unknown>) => ({ name, side, type: 'usb', usb: u })
const GPIO = { name: 'IO5', side: 'left', type: 'io' }

const MODULES: Record<string, ModuleDef> = {
  // A computer: two USB 2.0 A host ports (500 mA each by the USB default).
  pc: mod('pc', [usb('USB1', 'right', { connector: 'A', gender: 'receptacle', role: 'host', version: '2.0' }), usb('USB2', 'right', { connector: 'A', gender: 'receptacle', role: 'host', version: '2.0' })]),
  // A host with two ports sharing 600 mA.
  pi: mod('pi', [usb('USB1', 'right', { connector: 'A', gender: 'receptacle', role: 'host', version: '2.0' }), usb('USB2', 'right', { connector: 'A', gender: 'receptacle', role: 'host', version: '2.0' })],
    { params: {}, usbBudget: [{ ports: ['USB1', 'USB2'], mA: 600, note: 'shared' }] }),
  // An ESP32-like board: a micro-B device port with unknown draw, and a GPIO.
  mcu: mod('mcu', [GPIO, usb('USB', 'bottom', { connector: 'micro-B', gender: 'receptacle', role: 'device', version: '2.0' })]),
  // A board whose USB-C port can host (OTG).
  otg: mod('otg', [usb('USB', 'bottom', { connector: 'C', gender: 'receptacle', role: 'dual', source: 500 })]),
  // A dongle on a USB-A plug drawing 270 mA.
  sdr: mod('sdr', [usb('USB', 'left', { connector: 'A', gender: 'plug', role: 'device', draw: 270 })]),
  // A heavy device: 400 mA on a micro-B socket.
  disk: mod('disk', [usb('USB', 'left', { connector: 'micro-B', gender: 'receptacle', role: 'device', draw: 400 })]),
  // A bus-powered hub: B upstream drawing 50 mA itself, two A downstream ports.
  hub: mod('hub', [
    usb('UP', 'left', { connector: 'B', gender: 'receptacle', role: 'device', hub: 'upstream', draw: 50 }),
    usb('P1', 'right', { connector: 'A', gender: 'receptacle', role: 'host', hub: 'downstream', version: '2.0' }),
    usb('P2', 'right', { connector: 'A', gender: 'receptacle', role: 'host', hub: 'downstream', version: '2.0' }),
    { name: 'DC+', side: 'top', type: 'power_in', supply: '5V' }, { name: 'DC-', side: 'top', type: 'ground' },
  ], { params: {}, usbHub: { power: { pin: 'DC+' } } }),
  // A 5 V supply for the hub.
  psu: mod('psu', [{ name: '+', side: 'right', type: 'power_out', supply: '5V' }, { name: '-', side: 'right', type: 'ground' }]),
  // A panel-mount extension: micro-B socket in, micro-B plug out.
  ext: mod('ext', [usb('IN', 'left', { connector: 'micro-B', gender: 'receptacle', role: 'passthrough', through: 'OUT' }), usb('OUT', 'right', { connector: 'micro-B', gender: 'plug', role: 'passthrough', through: 'IN' })]),
  // A charger with a charge-only USB-C input and a battery pin.
  chg: mod('chg', [usb('USB', 'left', { connector: 'C', gender: 'receptacle', role: 'device', power: 'only', draw: 1000 }), { name: 'IN+', side: 'left', type: 'power_in', supply: '5V' }, { name: 'B+', side: 'right', type: 'power_out', supply: '3.7V' }]),
}

let n = 0
type W = [string, string, WireEnds?]
function sheet(parts: [string, string][], wires: W[]): Diagram {
  const ps: PartInstance[] = parts.map(([des, module], i) => ({ uid: des.toLowerCase(), designator: des, module, x: i * 300, y: 0 }))
  const ep = (s: string) => ({ part: s.split('|')[0], pin: s.split('|')[1] })
  const connections: Connection[] = wires.map(([a, b, ends]) => ({ uid: `w${++n}`, from: ep(a), to: ep(b), ...(ends ? { ends } : {}) }))
  return { format: 'circuitoon-diagram/1', title: 't', modules: MODULES, parts: ps, connections }
}
const A_MICRO: WireEnds = { from: 'usb-a', to: 'usb-micro-b' }
const usbFindings = (d: Diagram) => checkDiagram(d).filter((f) => f.rule.startsWith('usb')).map((f) => `${f.rule}: ${f.message}`)
const usbRules = (d: Diagram) => checkDiagram(d).filter((f) => f.rule.startsWith('usb')).map((f) => f.rule)

describe('cable choice', () => {
  it('two sockets get the cable whose plugs fit them; a plug gets none', () => {
    expect(usbEndsFor({ connector: 'A', gender: 'receptacle', role: 'host' }, { connector: 'micro-B', gender: 'receptacle', role: 'device' })).toEqual(A_MICRO)
    expect(usbEndsFor({ connector: 'C', gender: 'receptacle', role: 'dual' }, { connector: 'C', gender: 'receptacle', role: 'device' })).toEqual({ from: 'usb-c', to: 'usb-c' })
    expect(usbEndsFor({ connector: 'A', gender: 'plug', role: 'device' }, { connector: 'A', gender: 'receptacle', role: 'host' })).toBeUndefined()
  })
  it('a plug pushed into a socket is plugged in, not a wire', () => {
    const d = sheet([['J1', 'pc'], ['U1', 'sdr']], [['j1|USB1', 'u1|USB']])
    expect(isPluggedIn(d, d.connections[0])).toBe(true)
    const c = sheet([['J1', 'pc'], ['U1', 'mcu']], [['j1|USB1', 'u1|USB', A_MICRO]])
    expect(isPluggedIn(c, c.connections[0])).toBe(false)
  })
})

describe('correct USB hookups give no USB problem', () => {
  it('a computer to an ESP32 by an A to micro-B cable: only the unknown draw is noted', () => {
    expect(usbFindings(sheet([['J1', 'pc'], ['U1', 'mcu']], [['j1|USB1', 'u1|USB', A_MICRO]]))).toEqual([
      'usb-power-unknown: The current J1 USB1 is asked for is not fully known: U1 USB has no sourced draw, against the 500 mA the port supplies. Check its datasheet.',
    ])
  })
  it('a dongle plugged straight into a host, and an OTG port hosting a known device', () => {
    expect(usbFindings(sheet([['J1', 'pc'], ['U1', 'sdr']], [['j1|USB1', 'u1|USB']]))).toEqual([])
    expect(usbFindings(sheet([['U1', 'otg'], ['U2', 'disk']], [['u1|USB', 'u2|USB', { from: 'usb-c', to: 'usb-micro-b' }]]))).toEqual([])
  })
  it('a self-powered hub (DC wired) feeding 400 mA per port', () => {
    const d = sheet([['J1', 'pc'], ['H1', 'hub'], ['P1', 'psu'], ['U1', 'disk'], ['U2', 'disk']], [
      ['j1|USB1', 'h1|UP', { from: 'usb-a', to: 'usb-b' }], ['p1|+', 'h1|DC+'], ['p1|-', 'h1|DC-'],
      ['h1|P1', 'u1|USB', A_MICRO], ['h1|P2', 'u2|USB', A_MICRO],
    ])
    expect(usbFindings(d)).toEqual([])
  })
  it('an extension passes the bus through: host to device across it', () => {
    const d = sheet([['J1', 'pc'], ['X1', 'ext'], ['U1', 'disk']], [['j1|USB1', 'x1|IN', A_MICRO], ['x1|OUT', 'u1|USB']])
    expect(usbFindings(d)).toEqual([])
  })
  it('a charger fed by USB is powered (no "no power" for its unwired IN+)', () => {
    const d = sheet([['J1', 'pc'], ['U1', 'chg']], [['j1|USB1', 'u1|USB', { from: 'usb-a', to: 'usb-c' }]])
    expect(usbFedParts(d)).toEqual(new Set(['u1']))
    expect(checkDiagram(d).map((f) => f.rule)).not.toContain('no-power')
  })
})

describe('usb-to-pin', () => {
  it('fires on a USB port wired to a GPIO, and the GPIO rules stay out of that net', () => {
    expect(usbFindings(sheet([['U1', 'mcu'], ['U2', 'mcu']], [['u1|USB', 'u2|IO5']]))).toEqual([
      'usb-to-pin: U1 USB is a USB port, and it is wired to U2 IO5. A USB port connects only to another USB port, by a USB cable or by plugging in: never by jumper wires to pins, which skip the cable\'s shielding and twisted pair and can short VBUS. Remove the wire and connect U1 USB to a USB port.',
    ])
  })
  it('stays quiet on port-to-port links', () => {
    expect(usbRules(sheet([['J1', 'pc'], ['U1', 'disk']], [['j1|USB1', 'u1|USB', A_MICRO]]))).toEqual([])
  })
})

describe('usb-fit', () => {
  it('fires on a cable whose plug does not fit, naming the cable to use', () => {
    expect(usbFindings(sheet([['J1', 'pc'], ['U1', 'disk']], [['j1|USB1', 'u1|USB', { from: 'usb-a', to: 'usb-c' }]]))).toEqual([
      'usb-fit: The cable from J1 USB1 to U1 USB does not fit: its USB-C plug does not fit U1 USB, a micro-B socket. Use a USB A to micro-B cable.',
    ])
  })
  it('fires on two sockets with no cable, and on a Dupont end', () => {
    expect(usbFindings(sheet([['J1', 'pc'], ['U1', 'disk']], [['j1|USB1', 'u1|USB']]))).toEqual([
      'usb-fit: No USB cable is chosen between J1 USB1 (USB-A) and U1 USB (micro-B). Use a USB A to micro-B cable.',
    ])
    expect(usbRules(sheet([['J1', 'pc'], ['U1', 'disk']], [['j1|USB1', 'u1|USB', { from: 'dupont-male', to: 'usb-micro-b' }]]))).toEqual(['usb-fit'])
  })
  it('fires on a plug into the wrong socket, a plug given a cable, two plugs and a crowded port', () => {
    expect(usbFindings(sheet([['U1', 'sdr'], ['U2', 'otg']], [['u1|USB', 'u2|USB']]))).toEqual([
      "usb-fit: U1 USB's USB-A plug does not fit U2 USB, a USB-C socket. Use an adapter or a port with a USB-A socket.",
    ])
    expect(usbRules(sheet([['J1', 'pc'], ['U1', 'sdr']], [['j1|USB1', 'u1|USB', A_MICRO]]))).toEqual(['usb-fit'])
    expect(usbRules(sheet([['U1', 'sdr'], ['U2', 'sdr']], [['u1|USB', 'u2|USB']]))).toEqual(['usb-fit'])
    const crowded = usbFindings(sheet([['J1', 'pc'], ['U1', 'disk'], ['U2', 'disk']], [['j1|USB1', 'u1|USB', A_MICRO], ['j1|USB1', 'u2|USB', A_MICRO]]))
    expect(crowded).toEqual(['usb-fit: J1 USB1 has 2 connections (U1 USB and U2 USB), but a USB port takes one plug. Keep one; to share a port, put a USB hub between them.'])
  })
})

describe('usb-role', () => {
  it('fires on host to host and device to device', () => {
    expect(usbFindings(sheet([['J1', 'pc'], ['J2', 'pc']], [['j1|USB1', 'j2|USB1', { from: 'usb-a', to: 'usb-a' }]]))).toEqual([
      'usb-role: J1 USB1 (a host port) is connected to J2 USB1 (a host port): two hosts cannot talk, and both may drive VBUS into each other. Connect a host to a device, or to a hub\'s upstream port.',
    ])
    expect(usbFindings(sheet([['U1', 'mcu'], ['U2', 'disk']], [['u1|USB', 'u2|USB', { from: 'usb-micro-b', to: 'usb-micro-b' }]]))).toEqual([
      'usb-role: U1 USB and U2 USB are both device ports: neither can host the other, and neither supplies VBUS. Connect each to a host, such as a computer, a Raspberry Pi or a hub\'s downstream port.',
    ])
  })
  it('fires on a hub upstream port facing a device, also across an extension', () => {
    const d = sheet([['H1', 'hub'], ['X1', 'ext'], ['U1', 'disk']], [['h1|UP', 'x1|IN', { from: 'usb-b', to: 'usb-micro-b' }], ['x1|OUT', 'u1|USB']])
    expect(usbFindings(d)).toEqual([
      'usb-role: H1 UP is a hub\'s upstream port, and it is connected to U1 USB, which is a device, not a host. A hub\'s upstream port must face a host or another hub\'s downstream port: connect it to one.',
    ])
  })
  it('stays quiet on dual ports and on a hub chain', () => {
    expect(usbRules(sheet([['U1', 'otg'], ['U2', 'otg']], [['u1|USB', 'u2|USB', { from: 'usb-c', to: 'usb-c' }]]))).toEqual([])
    const chain = sheet([['J1', 'pc'], ['H1', 'hub'], ['H2', 'hub'], ['P1', 'psu'], ['P2', 'psu']], [
      ['j1|USB1', 'h1|UP', { from: 'usb-a', to: 'usb-b' }], ['h1|P1', 'h2|UP', { from: 'usb-a', to: 'usb-b' }],
      ['p1|+', 'h1|DC+'], ['p1|-', 'h1|DC-'], ['p2|+', 'h2|DC+'], ['p2|-', 'h2|DC-'],
    ])
    expect(usbRules(chain)).toEqual([])
  })
})

describe('power budget', () => {
  it('a bus-powered hub tree over the host port\'s 500 mA', () => {
    const d = sheet([['J1', 'pc'], ['H1', 'hub'], ['U1', 'disk'], ['U2', 'sdr']], [
      ['j1|USB1', 'h1|UP', { from: 'usb-a', to: 'usb-b' }], ['h1|P1', 'u1|USB', A_MICRO], ['h1|P2', 'u2|USB'],
    ])
    expect(usbFindings(d)).toEqual([
      'usb-hub-bus-power: H1 is a bus-powered hub, so H1 P1 gives at most 100 mA, but U1 USB draws 400 mA. Power the hub from its own supply, or plug U1 into the host directly.',
      'usb-hub-bus-power: H1 is a bus-powered hub, so H1 P2 gives at most 100 mA, but U2 USB draws 270 mA. Power the hub from its own supply, or plug U2 into the host directly.',
      'usb-power: J1 USB1 supplies 500 mA, but H1 UP and the devices on its hub draw 720 mA. The port can shut down or brown out. Use a powered hub, or a supply for H1.',
    ])
  })
  it('a shared budget over its limit, under it, and a single port under its own', () => {
    const over = sheet([['J1', 'pi'], ['U1', 'disk'], ['U2', 'sdr']], [['j1|USB1', 'u1|USB', A_MICRO], ['j1|USB2', 'u2|USB']])
    expect(usbFindings(over)).toEqual([
      "usb-power: J1's USB ports share 600 mA (shared), but U1 USB and U2 USB draw 670 mA together. Move a device to a powered hub, or give it its own supply.",
    ])
    const under = sheet([['J1', 'pi'], ['U1', 'disk']], [['j1|USB1', 'u1|USB', A_MICRO]])
    expect(usbRules(under)).toEqual([])
  })
  it('unknown draws are a note at the paying port, never a warning', () => {
    const d = sheet([['J1', 'pc'], ['H1', 'hub'], ['P1', 'psu'], ['U1', 'mcu']], [
      ['j1|USB1', 'h1|UP', { from: 'usb-a', to: 'usb-b' }], ['p1|+', 'h1|DC+'], ['p1|-', 'h1|DC-'], ['h1|P1', 'u1|USB', A_MICRO],
    ])
    expect(checkDiagram(d).filter((f) => f.rule.startsWith('usb')).map((f) => `${f.severity} ${f.rule} ${f.target}`)).toEqual(['info usb-power-unknown H1 P1'])
  })
})

describe('bill of materials', () => {
  it('lists a USB cable by kind, never its plugs as loose connectors, and buys nothing for a plug-in', () => {
    const d = sheet([['J1', 'pc'], ['U1', 'mcu'], ['U2', 'sdr']], [['j1|USB1', 'u1|USB', A_MICRO], ['j1|USB2', 'u2|USB']])
    const bom = billOfMaterials(d)
    expect(bom.wires.map((w) => [w.cable, w.count])).toEqual([['USB A to micro-B cable', 1]])
    expect(bom.connectors).toEqual([])
  })
})
