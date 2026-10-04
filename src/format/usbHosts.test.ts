// The USB host parts and hubs (scripts/gen-usb.mjs): the Raspberry Pi 40-pin header in physical
// order, the shared USB budgets, the hubs' ports and pads, and the USB rules and KiCad export on
// real library parts. Sources: .superpowers/usb-pinouts.md.
import { describe, expect, it } from 'vitest'
import { checkDiagram } from './checks.ts'
import type { Connection, Diagram, PartInstance } from './diagram.ts'
import { type ModuleDef, layoutModule, usbBudgets, usbHubOf } from './module.ts'
import { load } from './builtinModules.testing.ts'
import { toKicadNetlist } from './kicad.ts'
import { billOfMaterials } from './bom.ts'

// Written out from Raspberry Pi's GPIO pinout diagram (pins 1-40), not from the generator.
const J8_BY_PIN = [
  '3V3', '5V', 'GPIO2', '5V', 'GPIO3', 'GND', 'GPIO4', 'GPIO14', 'GND', 'GPIO15', 'GPIO17', 'GPIO18', 'GPIO27', 'GND', 'GPIO22', 'GPIO23',
  '3V3', 'GPIO24', 'GPIO10', 'GND', 'GPIO9', 'GPIO25', 'GPIO11', 'GPIO8', 'GND', 'GPIO7', 'GPIO0', 'GPIO1', 'GPIO5', 'GND', 'GPIO6', 'GPIO12',
  'GPIO13', 'GND', 'GPIO19', 'GPIO16', 'GPIO26', 'GPIO20', 'GND', 'GPIO21',
]
const PIS = ['rpi-4-model-b', 'rpi-5', 'rpi-zero-2-w']

describe('the Raspberry Pi 40-pin header', () => {
  for (const id of PIS)
    it(`${id}: pins 1-40 in physical order, odd pins inner, even on the edge, pin 1 at the left`, () => {
      const m = load(id)
      const holes = m.holes!
      expect(holes.map((g) => g.label ?? g.name)).toEqual(J8_BY_PIN)
      holes.forEach((g, i) => {
        const [x, y] = g.at[0]
        expect([x, y], `${id} pin ${i + 1}`).toEqual([30 + Math.floor(i / 2) * 10, i % 2 ? 20 : 30])
      })
      expect(m.internal).toEqual([['GND', 'GND 2', 'GND 3', 'GND 4', 'GND 5', 'GND 6', 'GND 7', 'GND 8'], ['3V3', '3V3 2'], ['5V', '5V 2']])
      expect(holes.find((g) => g.name === '3V3')).toMatchObject({ type: 'power_out', supply: '3V3' })
      expect(holes.find((g) => g.name === '5V')).toMatchObject({ type: 'power_in', supply: '5V' })
      expect(holes.filter((g) => g.caps?.note).map((g) => g.name)).toEqual(['GPIO2', 'GPIO3', 'GPIO0', 'GPIO1'])
      // KiCad: the 2 x 20 socket, pad n = physical pin n.
      expect(m.kicad?.footprint).toBe('Connector_PinSocket_2.54mm:PinSocket_2x20_P2.54mm_Vertical')
      expect(holes.map((g) => m.kicad!.pins![g.name])).toEqual(J8_BY_PIN.map((_, i) => String(i + 1)))
    })
  it('the Pi 4 and Pi 5 USB stacks sit where the mechanical drawings put them', () => {
    const at = (id: string) => Object.fromEntries(layoutModule(load(id)).pins.map((p) => [p.name, `${p.side} ${p.side === 'top' || p.side === 'bottom' ? p.edge.x : p.edge.y}`]))
    // Pi 4: Ethernet top right, USB 3.0 in the middle, USB 2.0 at the bottom; USB-C 11.2 mm from the left.
    expect(at('rpi-4-model-b')).toEqual({ 'USB3-1': 'right 110', 'USB3-2': 'right 120', 'USB2-1': 'right 180', 'USB2-2': 'right 190', 'USB-C': 'bottom 40', CAMERA: 'bottom 180', DISPLAY: 'left 110' })
    // Pi 5: USB 2.0 top right, USB 3.0 in the middle, Ethernet at the bottom.
    expect(at('rpi-5')).toEqual({ 'USB2-1': 'right 30', 'USB2-2': 'right 40', 'USB3-1': 'right 100', 'USB3-2': 'right 110', 'USB-C': 'bottom 40', 'CAM/DISP 1': 'bottom 190', 'CAM/DISP 0': 'bottom 210' })
    expect(at('rpi-zero-2-w')).toEqual({ USB: 'bottom 160', 'PWR IN': 'bottom 210', CAMERA: 'right 60' })
  })
  it('shared USB budgets: Pi 4 1.2 A; Pi 5 1.6 A with a 5 A supply, 600 mA with a 3 A one', () => {
    expect(usbBudgets({}, load('rpi-4-model-b')).map((b) => [b.ports.length, b.mA])).toEqual([[4, 1200]])
    expect(usbBudgets({}, load('rpi-5')).map((b) => b.mA)).toEqual([1600])
    expect(usbBudgets({ settings: { supply: '5V 3A' } }, load('rpi-5')).map((b) => b.mA)).toEqual([600])
    expect(usbBudgets({}, load('rpi-zero-2-w'))).toEqual([])
  })
})

describe('the hubs', () => {
  it('Circuitneato FE1.1s: USB-C upstream, sockets 4 3 2 1 left to right, the 2 x 3 pads, self-powered when 5V is wired', () => {
    const m = load('usb-hub-fe11s-circuitneato')
    const pos = Object.fromEntries(layoutModule(m).pins.map((p) => [p.label ?? p.name, `${p.side} ${p.side === 'top' || p.side === 'bottom' ? p.edge.x : p.edge.y}`]))
    expect(pos).toEqual({ 'USB-C': 'left 20', 4: 'bottom 40', 3: 'bottom 140', 2: 'bottom 240', 1: 'bottom 340' })
    expect(m.holes!.map((g) => `${g.name} ${g.at[0].join(',')}`)).toEqual(['D+ 340,20', 'D- 350,20', 'GND 360,20', 'SCL 340,30', 'SDA 350,30', '5V 360,30'])
    expect(usbHubOf(m)).toEqual({ power: { pin: '5V' } })
  })
  it('the generic powered hub: B upstream, four A downstream, DC input', () => {
    const m = load('usb-hub-powered-4port')
    expect(m.pins.filter((p) => !('spacer' in p)).map((p) => ('name' in p ? p.name : ''))).toEqual(['UP', 'DC+', 'DC-', 'P1', 'P2', 'P3', 'P4'])
    expect(usbHubOf(m)).toEqual({ power: { pin: 'DC+' } })
  })
})

// ---- The rules and the export on library parts ----

let n = 0
function sheet(parts: [string, string, Record<string, string>?][], wires: [string, string, Connection['ends']?][]): Diagram {
  const modules: Record<string, ModuleDef> = {}
  const ps: PartInstance[] = parts.map(([des, id, settings], i) => {
    modules[id] = load(id)
    return { uid: des.toLowerCase(), designator: des, module: id, x: i * 400, y: 0, ...(settings ? { settings } : {}) }
  })
  const ep = (s: string) => ({ part: s.split('|')[0], pin: s.split('|')[1] })
  return { format: 'circuitoon-diagram/1', title: 't', modules, parts: ps, connections: wires.map(([a, b, ends]) => ({ uid: `w${++n}`, from: ep(a), to: ep(b), ...(ends ? { ends } : {}) })) }
}
const usb = (d: Diagram) => checkDiagram(d).filter((f) => f.rule.startsWith('usb')).map((f) => `${f.severity} ${f.rule}: ${f.message}`)

describe('USB rules on library parts', () => {
  it('an ESP32 cabled to a Pi 4, and an RTL-SDR plugged into it: only the ESP32\'s unknown draw is noted', () => {
    const d = sheet([['U1', 'rpi-4-model-b'], ['U2', 'esp32-devkit-v1-30'], ['U3', 'rtl-sdr-blog-v4']],
      [['u1|USB2-1', 'u2|USB', { from: 'usb-a', to: 'usb-micro-b' }], ['u1|USB3-1', 'u3|USB']])
    expect(usb(d)).toEqual([
      'info usb-power-unknown: The current U1 USB2 is asked for is not fully known: U2 USB has no sourced draw, against the 500 mA the port supplies. Check its datasheet.',
    ])
    expect(checkDiagram(d).map((f) => f.rule)).not.toContain('no-power')
  })
  it('a Pi 5 on a 3 A supply: two RTL-SDRs and a TP4056 charging over its 600 mA', () => {
    const d = sheet([['U1', 'rpi-5', { supply: '5V 3A' }], ['U2', 'rtl-sdr-blog-v4'], ['U3', 'rtl-sdr-blog-v4']], [['u1|USB3-1', 'u2|USB'], ['u1|USB3-2', 'u3|USB']])
    expect(usb(d)).toEqual([])
    // 540 mA is under 600 mA: quiet. A charger's 1 A on top tips it over.
    const over = sheet([['U1', 'rpi-5', { supply: '5V 3A' }], ['U2', 'rtl-sdr-blog-v4'], ['U3', 'tp4056-module']], [['u1|USB3-1', 'u2|USB'], ['u1|USB2-1', 'u3|USB-C', { from: 'usb-a', to: 'usb-c' }]])
    expect(usb(over)).toEqual([
      'warning usb-power: U1 USB2 supplies 500 mA, but U3 USB-C draws 1000 mA. The port can shut down or brown out. Use a powered hub, or a supply for U3.',
      "warning usb-power: U1's USB ports share 600 mA (600 mA across all four ports with a 3 A supply, shared with the fan header), but U2 USB and U3 USB-C draw 1270 mA together. Move a device to a powered hub, or give it its own supply.",
    ])
    // With the 27 W supply the shared limit is 1.6 A; the charger still overloads its own port.
    const big = { ...over, parts: over.parts.map((p) => (p.uid === 'u1' ? { ...p, settings: { supply: '5V 5A (27 W)' } } : p)) }
    expect(usb(big).map((f) => f.split(':')[0])).toEqual(['warning usb-power'])
  })
  it('a hub tree: a computer port feeding a bus-powered hub with two RTL-SDRs', () => {
    const d = sheet([['J1', 'computer-usb-port'], ['H1', 'usb-hub-powered-4port'], ['U1', 'rtl-sdr-blog-v4'], ['U2', 'rtl-sdr-blog-v4']],
      [['j1|USB', 'h1|UP', { from: 'usb-a', to: 'usb-b' }], ['h1|P1', 'u1|USB'], ['h1|P2', 'u2|USB']])
    expect(usb(d)).toEqual([
      'warning usb-hub-bus-power: H1 is a bus-powered hub, so H1 1 gives at most 100 mA, but U1 USB draws 270 mA. Power the hub from its own supply, or plug U1 into the host directly.',
      'warning usb-hub-bus-power: H1 is a bus-powered hub, so H1 2 gives at most 100 mA, but U2 USB draws 270 mA. Power the hub from its own supply, or plug U2 into the host directly.',
      'warning usb-power: J1 USB supplies 500 mA, but H1 UP and the devices on its hub draw 540 mA, and more where the draw is unknown. The port can shut down or brown out. Use a powered hub, or a supply for H1.',
    ])
  })
  it('the same tree with the hub on its own 5 V adapter: quiet', () => {
    const d = sheet([['J1', 'computer-usb-port'], ['H1', 'usb-hub-powered-4port'], ['U1', 'rtl-sdr-blog-v4'], ['U2', 'rtl-sdr-blog-v4'], ['PS1', 'adapter-barrel-us']],
      [['j1|USB', 'h1|UP', { from: 'usb-a', to: 'usb-b' }], ['h1|P1', 'u1|USB'], ['h1|P2', 'u2|USB'], ['ps1|+', 'h1|DC+'], ['ps1|-', 'h1|DC-']])
    expect(usb(d).filter((f) => !f.startsWith('info'))).toEqual([])
  })
  it('the FE1.1s with its 5V pad unwired is bus-powered: its stated 500 mA ports give 100 mA', () => {
    const d = sheet([['J1', 'computer-usb-port'], ['H1', 'usb-hub-fe11s-circuitneato'], ['U1', 'rtl-sdr-blog-v4']],
      [['j1|USB', 'h1|USB-C', { from: 'usb-a', to: 'usb-c' }], ['h1|P1', 'u1|USB']])
    expect(usb(d)).toEqual([
      'warning usb-hub-bus-power: H1 is a bus-powered hub, so H1 1 gives at most 100 mA, but U1 USB draws 270 mA. Power the hub from its own supply, or plug U1 into the host directly.',
    ])
  })
  it('jumper wires from a Pi\'s GPIO to a USB port are an error', () => {
    const d = sheet([['U1', 'rpi-4-model-b'], ['U2', 'esp32-devkitc-v4']], [['u1|GPIO14', 'u2|USB']])
    expect(usb(d).map((f) => f.split(':')[0])).toEqual(['error usb-to-pin'])
  })
})

describe('KiCad: USB links are off-board', () => {
  it('an ESP32 cabled to a Pi 4 and an RTL-SDR plugged in: no USB footprints or nets, a note per link, the BOM has them', () => {
    const d = sheet([['U1', 'rpi-4-model-b'], ['U2', 'esp32-devkit-v1-30'], ['U3', 'rtl-sdr-blog-v4']],
      [['u1|USB2-1', 'u2|USB', { from: 'usb-a', to: 'usb-micro-b' }], ['u1|USB3-1', 'u3|USB']])
    const x = toKicadNetlist(d)
    expect(x.text).not.toContain('Connector_USB')
    expect(x.text).not.toMatch(/VBUS|_D\+|_D-/)
    expect(x.notes.filter((s) => /USB/.test(s))).toEqual(['U1 USB2 to U2 USB is a USB cable, off-board', 'U1 USB3 to U3 USB is a USB plug-in, off-board'])
    expect(x.warnings.filter((w) => /USB/.test(w))).toEqual([])
    const bom = billOfMaterials(d)
    expect(bom.wires.map((w) => [w.cable, w.count])).toEqual([['USB A to micro-B cable', 1]])
    expect(bom.parts.map((p) => p.module)).toContain('rtl-sdr-blog-v4')
  })
  it('a panel-mount extension keeps its own header footprint; its USB link is still off-board', () => {
    const d = sheet([['U1', 'esp32-devkitc-v4'], ['X1', 'usb-panel-mount-microusb']], [['x1|PLUG', 'u1|USB']])
    const x = toKicadNetlist(d)
    expect(x.text).toMatch(/\(comp \(ref "X1"\)\n {6}\(value "USB panel mount"\)\n {6}\(footprint "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical"\)/)
    expect(x.notes).toContain('U1 USB to X1 PLUG is a USB plug-in, off-board')
    expect(x.text).not.toContain('Connector_USB')
  })
})
