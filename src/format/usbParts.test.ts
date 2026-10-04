// The USB ports of the built-in parts (USB design 1.1), pinned: connector, gender, role, version,
// speed, current, and where each sits on the body. Sources are cited where each generator adds the
// port; .superpowers/usb-pinouts.md has a table per part for the independent review. A wrong port is
// worse than a missing one, so a change here must be re-checked against the source.
import { describe, expect, it } from 'vitest'
import { layoutModule, usbPorts } from './module.ts'
import { load, moduleFiles, withoutUsb } from './builtinModules.testing.ts'
import { moduleDrift } from './moduleDrift.ts'

/** Parts that came with their ports (not an update of an older part). */
const NEW_PARTS = ['rpi-4-model-b', 'rpi-5', 'rpi-zero-2-w', 'computer-usb-port', 'usb-hub-fe11s-circuitneato', 'usb-hub-powered-4port']

type Want = [name: string, side: string, at: number, usb: Record<string, unknown>]
const PORTS: Record<string, Want[]> = {
  'arduino-due': [['PROG', 'top', 80, { connector: 'micro-B', gender: 'receptacle', role: 'device', version: '2.0', speed: 'full', vbus: '5V' }], ['NATIVE', 'top', 140, { connector: 'micro-B', gender: 'receptacle', role: 'dual', version: '2.0', speed: 'high', vbus: '5V' }]],
  'arduino-leonardo': [['USB', 'top', 150, { connector: 'micro-B', gender: 'receptacle', role: 'device', version: '2.0', speed: 'full', vbus: '5V' }]],
  'arduino-mega-2560': [['USB', 'top', 150, { connector: 'B', gender: 'receptacle', role: 'device', version: '2.0', speed: 'full', vbus: '5V' }]],
  'arduino-micro': [['USB', 'top', 40, { connector: 'micro-B', gender: 'receptacle', role: 'device', version: '2.0', speed: 'full', vbus: '5V' }]],
  'arduino-nano-33-ble': [['USB', 'top', 40, { connector: 'micro-B', gender: 'receptacle', role: 'device', version: '2.0', speed: 'full' }]],
  'arduino-nano-33-iot': [['USB', 'top', 40, { connector: 'micro-B', gender: 'receptacle', role: 'device', version: '2.0', speed: 'full' }]],
  'arduino-nano-esp32': [['USB', 'top', 40, { connector: 'C', gender: 'receptacle', role: 'device', version: '1.1', speed: 'full', vbus: 'VBUS' }]],
  'arduino-nano-every': [['USB', 'top', 40, { connector: 'micro-B', gender: 'receptacle', role: 'device', version: '2.0', speed: 'full', vbus: '5V' }]],
  'arduino-nano-rp2040-connect': [['USB', 'top', 40, { connector: 'micro-B', gender: 'receptacle', role: 'device', version: '1.1', speed: 'full' }]],
  'arduino-nano': [['USB', 'top', 40, { connector: 'mini-B', gender: 'receptacle', role: 'device', version: '2.0', speed: 'full', vbus: '5V' }]],
  'arduino-uno-r3': [['USB', 'top', 150, { connector: 'B', gender: 'receptacle', role: 'device', version: '2.0', speed: 'full', vbus: '5V' }]],
  'arduino-uno-r4-minima': [['USB', 'top', 150, { connector: 'C', gender: 'receptacle', role: 'device', version: '2.0', speed: 'full', vbus: '5V' }]],
  'arduino-uno-r4-wifi': [['USB', 'top', 150, { connector: 'C', gender: 'receptacle', role: 'device', version: '1.1', speed: 'full', vbus: '5V' }]],
  'arduino-zero': [['PROG', 'top', 90, { connector: 'micro-B', gender: 'receptacle', role: 'device', version: '2.0' }], ['NATIVE', 'top', 150, { connector: 'micro-B', gender: 'receptacle', role: 'dual', version: '2.0', speed: 'full', vbus: '5V' }]],
  'computer-usb-port': [['USB', 'right', 60, { connector: 'A', gender: 'receptacle', role: 'host', version: '2.0', speed: 'high' }]],
  'esp32-c3-supermini': [['USB', 'top', 40, { connector: 'C', gender: 'receptacle', role: 'device', speed: 'full', vbus: '5V' }]],
  'esp32-devkit-v1-30': [['USB', 'bottom', 60, { connector: 'micro-B', gender: 'receptacle', role: 'device', version: '2.0', speed: 'full', vbus: 'VIN' }]],
  'esp32-devkitc-v4': [['USB', 'bottom', 60, { connector: 'micro-B', gender: 'receptacle', role: 'device', version: '2.0', speed: 'full', vbus: '5V' }]],
  'esp32-s3-devkitc-1': [['UART', 'bottom', 50, { connector: 'micro-B', gender: 'receptacle', role: 'device', version: '2.0', speed: 'full', vbus: '5V' }], ['USB', 'bottom', 70, { connector: 'micro-B', gender: 'receptacle', role: 'dual', version: '1.1', speed: 'full', vbus: '5V' }]],
  'esp32-terminal-board-38': [['USB', 'left', 100, { connector: 'micro-B', gender: 'receptacle', role: 'device', version: '2.0', speed: 'full', vbus: '5V' }]],
  'ip5306-usbc-module': [['USB-C', 'right', 50, { connector: 'C', gender: 'receptacle', role: 'device', power: 'only', draw: 2000 }]],
  'rpi-4-model-b': [['USB3-1', 'right', 110, { connector: 'A', gender: 'receptacle', role: 'host', version: '3.0', speed: 'super' }], ['USB3-2', 'right', 120, { connector: 'A', gender: 'receptacle', role: 'host', version: '3.0', speed: 'super' }], ['USB2-1', 'right', 180, { connector: 'A', gender: 'receptacle', role: 'host', version: '2.0', speed: 'high' }], ['USB2-2', 'right', 190, { connector: 'A', gender: 'receptacle', role: 'host', version: '2.0', speed: 'high' }], ['USB-C', 'bottom', 40, { connector: 'C', gender: 'receptacle', role: 'device', version: '2.0', draw: 600 }]],
  'rpi-5': [['USB2-1', 'right', 30, { connector: 'A', gender: 'receptacle', role: 'host', version: '2.0', speed: 'high' }], ['USB2-2', 'right', 40, { connector: 'A', gender: 'receptacle', role: 'host', version: '2.0', speed: 'high' }], ['USB3-1', 'right', 100, { connector: 'A', gender: 'receptacle', role: 'host', version: '3.0', speed: 'super' }], ['USB3-2', 'right', 110, { connector: 'A', gender: 'receptacle', role: 'host', version: '3.0', speed: 'super' }], ['USB-C', 'bottom', 40, { connector: 'C', gender: 'receptacle', role: 'device', draw: 800 }]],
  'rpi-pico-2-w': [['USB', 'top', 60, { connector: 'micro-B', gender: 'receptacle', role: 'dual', version: '1.1', speed: 'full', vbus: 'VBUS' }]],
  'rpi-pico-2': [['USB', 'top', 60, { connector: 'micro-B', gender: 'receptacle', role: 'dual', version: '1.1', speed: 'full', vbus: 'VBUS' }]],
  'rpi-pico-h': [['USB', 'top', 60, { connector: 'micro-B', gender: 'receptacle', role: 'dual', version: '1.1', speed: 'full', vbus: 'VBUS' }]],
  'rpi-pico-w': [['USB', 'top', 60, { connector: 'micro-B', gender: 'receptacle', role: 'dual', version: '1.1', speed: 'full', vbus: 'VBUS' }]],
  'rpi-pico': [['USB', 'top', 60, { connector: 'micro-B', gender: 'receptacle', role: 'dual', version: '1.1', speed: 'full', vbus: 'VBUS' }]],
  'rpi-zero-2-w': [['USB', 'bottom', 160, { connector: 'micro-B', gender: 'receptacle', role: 'dual', version: '2.0', speed: 'high' }], ['PWR IN', 'bottom', 210, { connector: 'micro-B', gender: 'receptacle', role: 'device', power: 'only', draw: 350 }]],
  'rtl-sdr-blog-v4': [['USB', 'left', 30, { connector: 'A', gender: 'plug', role: 'device', version: '2.0', draw: 270 }]],
  'tp4056-module': [['USB-C', 'left', 40, { connector: 'C', gender: 'receptacle', role: 'device', power: 'only', draw: 1000, vbus: 'IN+' }]],
  'usb-hub-fe11s-circuitneato': [['USB-C', 'left', 20, { connector: 'C', gender: 'receptacle', role: 'device', hub: 'upstream', version: '2.0', speed: 'high', draw: 100 }], ['P4', 'bottom', 40, { connector: 'A', gender: 'receptacle', role: 'host', hub: 'downstream', version: '2.0', speed: 'high', source: 500 }], ['P3', 'bottom', 140, { connector: 'A', gender: 'receptacle', role: 'host', hub: 'downstream', version: '2.0', speed: 'high', source: 500 }], ['P2', 'bottom', 240, { connector: 'A', gender: 'receptacle', role: 'host', hub: 'downstream', version: '2.0', speed: 'high', source: 500 }], ['P1', 'bottom', 340, { connector: 'A', gender: 'receptacle', role: 'host', hub: 'downstream', version: '2.0', speed: 'high', source: 500 }]],
  'usb-hub-powered-4port': [['UP', 'left', 30, { connector: 'B', gender: 'receptacle', role: 'device', hub: 'upstream', version: '2.0', speed: 'high' }], ['P1', 'right', 30, { connector: 'A', gender: 'receptacle', role: 'host', hub: 'downstream', version: '2.0', speed: 'high' }], ['P2', 'right', 60, { connector: 'A', gender: 'receptacle', role: 'host', hub: 'downstream', version: '2.0', speed: 'high' }], ['P3', 'right', 90, { connector: 'A', gender: 'receptacle', role: 'host', hub: 'downstream', version: '2.0', speed: 'high' }], ['P4', 'right', 120, { connector: 'A', gender: 'receptacle', role: 'host', hub: 'downstream', version: '2.0', speed: 'high' }]],
  'usb-panel-mount-microusb': [['SOCKET', 'left', 40, { connector: 'micro-B', gender: 'receptacle', role: 'passthrough', through: 'PLUG' }], ['PLUG', 'top', 110, { connector: 'micro-B', gender: 'plug', role: 'passthrough', through: 'SOCKET' }]],
  'usb-panel-mount-usbc': [['SOCKET', 'left', 40, { connector: 'C', gender: 'receptacle', role: 'passthrough', through: 'PLUG' }], ['PLUG', 'top', 110, { connector: 'C', gender: 'plug', role: 'passthrough', through: 'SOCKET' }]],
  'wemos-d1-mini': [['USB', 'bottom', 50, { connector: 'micro-B', gender: 'receptacle', role: 'device', version: '2.0', speed: 'full', vbus: '5V' }]],
  'xiao-esp32c3': [['USB', 'top', 50, { connector: 'C', gender: 'receptacle', role: 'device', speed: 'full', vbus: '5V' }]],
  'xiao-esp32s3': [['USB', 'top', 50, { connector: 'C', gender: 'receptacle', role: 'device', speed: 'full', vbus: '5V' }]],
}

describe('USB ports of the built-in parts', () => {
  it('every part with a port is listed, and only those', () => {
    const withPorts = moduleFiles().map((f) => load(f)).filter((m) => usbPorts(m).length).map((m) => m.id).sort()
    expect(withPorts).toEqual(Object.keys(PORTS).sort())
  })
  for (const [id, want] of Object.entries(PORTS))
    it(`${id}: ${want.map((w) => w[0]).join(', ')}`, () => {
      const m = load(id)
      const lay = layoutModule(m)
      const got = usbPorts(m).map((p): Want => {
        const e = lay.pins.find((q) => q.name === p.name)!.edge
        return [p.name, p.side, p.side === 'top' || p.side === 'bottom' ? e.x : e.y, { ...p.usb }]
      })
      expect(got).toEqual(want)
    })
})

describe('Ruling U1 on the library: a sheet saved before the ports gets Update parts, not a block', () => {
  // Parts that existed before the ports; the RTL-SDR is the one whose pins became its port.
  const ADDED = Object.keys(PORTS).filter((id) => id !== 'rtl-sdr-blog-v4' && !NEW_PARTS.includes(id))
  for (const id of ADDED)
    it(id, () => {
      const lib = load(id)
      const drift = moduleDrift(withoutUsb(lib), lib)
      expect(drift?.kind).toBe('update')
      expect(drift?.what.join(' ')).toMatch(/^USB ports? /)
    })
})
