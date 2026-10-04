// USB ports in the module format (USB design 1.1) and the additive library update (Ruling U1).
import { describe, expect, it } from 'vitest'
import { type ModuleDef, layoutModule, usbBudgets, usbHubOf, usbOf, usbPorts, validateModule } from './module.ts'
import { moduleDrift } from './moduleDrift.ts'

const base = (pins: unknown[], electrical: Record<string, unknown> = { params: {} }) => ({
  format: 'circuitoon-module/1', id: 'board', name: 'Board', pins, size: { w: 8, h: 8 }, electrical,
})
const port = (usb: Record<string, unknown>, name = 'USB', side = 'bottom') => ({ name, side, type: 'usb', usb })
const errorsOf = (raw: unknown) => {
  const r = validateModule(raw)
  return r.ok ? [] : r.errors
}
const DEVICE = { connector: 'micro-B', gender: 'receptacle', role: 'device' }

describe('USB port validation', () => {
  it('takes a well-formed port and reads it back', () => {
    const r = validateModule(base([{ name: 'GND', side: 'left', type: 'ground' }, port({ ...DEVICE, version: '2.0', speed: 'full', draw: 250 })]))
    expect(r.ok).toBe(true)
    const m = (r as { module: ModuleDef }).module
    expect(usbPorts(m).map((p) => p.name)).toEqual(['USB'])
    expect(usbOf(m, 'USB')).toEqual({ ...DEVICE, version: '2.0', speed: 'full', draw: 250 })
    expect(usbOf(m, 'GND')).toBeUndefined()
  })
  it('requires the usb object on a usb pin, and only there', () => {
    expect(errorsOf(base([{ name: 'USB', side: 'bottom', type: 'usb' }]))).toEqual([expect.stringMatching(/^pins\[0\]\.usb: required/)])
    expect(errorsOf(base([{ name: 'D+', side: 'left', type: 'io', usb: DEVICE }]))).toEqual(['pins[0].usb: only on a pin with type "usb"'])
  })
  it('rejects unknown connectors, genders, roles, versions, speeds and fields', () => {
    const e = errorsOf(base([port({ connector: 'micro-AB', gender: 'male', role: 'otg', version: '3.2', speed: 'turbo', color: 'blue' })]))
    expect(e).toEqual(expect.arrayContaining([
      'pins[0].usb.color: unknown field',
      'pins[0].usb.connector: must be one of A, B, mini-B, micro-B, C',
      'pins[0].usb.gender: must be "receptacle" or "plug"',
      'pins[0].usb.role: must be one of host, device, dual, passthrough',
      'pins[0].usb.version: must be one of 1.1, 2.0, 3.0',
      'pins[0].usb.speed: must be one of low, full, high, super',
    ]))
  })
  it('checks currents: mA in range, a source only on a host or dual port, a draw only on a device or dual one', () => {
    expect(errorsOf(base([port({ ...DEVICE, draw: -1 })]))).toEqual([expect.stringMatching(/usb\.draw: must be mA/)])
    expect(errorsOf(base([port({ ...DEVICE, draw: 9000 })]))).toEqual([expect.stringMatching(/usb\.draw: must be mA/)])
    expect(errorsOf(base([port({ ...DEVICE, source: 500 })]))).toEqual(['pins[0].usb.source: only a host or dual port supplies current'])
    expect(errorsOf(base([port({ connector: 'A', gender: 'receptacle', role: 'host', draw: 10 })]))).toEqual(['pins[0].usb.draw: only a device or dual port draws current'])
    expect(errorsOf(base([port({ connector: 'micro-B', gender: 'receptacle', role: 'dual', source: 500, draw: 30 })]))).toEqual([])
  })
  it('a charge-only port is a device port; hub ports match their role', () => {
    expect(errorsOf(base([port({ connector: 'A', gender: 'receptacle', role: 'host', power: 'only' })]))).toEqual(['pins[0].usb.power: a charge-only port is a device port'])
    expect(errorsOf(base([port({ ...DEVICE, hub: 'downstream' })]))).toEqual([
      'pins[0].usb.hub: "upstream" on a device port or "downstream" on a host port',
      'electrical.usbHub: required on a part with hub ports (how its downstream ports are powered)',
    ])
  })
  it('passthrough ports name each other', () => {
    const ok = [port({ connector: 'micro-B', gender: 'receptacle', role: 'passthrough', through: 'P' }, 'S', 'left'), port({ connector: 'micro-B', gender: 'plug', role: 'passthrough', through: 'S' }, 'P', 'right')]
    expect(errorsOf(base(ok))).toEqual([])
    const lone = [port({ connector: 'micro-B', gender: 'receptacle', role: 'passthrough', through: 'X' }, 'S', 'left')]
    expect(errorsOf(base(lone))).toEqual([expect.stringMatching(/^pins: USB port "S" passes through to "X"/)])
    expect(errorsOf(base([port({ ...DEVICE, through: 'S' })]))).toEqual([expect.stringMatching(/usb\.through: a passthrough port names its other end/)])
  })
  it('vbus names the board\'s own pin or pad, never a USB port, on a device or dual port', () => {
    const v5 = { name: '5V', side: 'left', type: 'power_in', supply: '5V' }
    expect(errorsOf(base([v5, port({ ...DEVICE, vbus: '5V' })]))).toEqual([])
    expect(errorsOf({ ...base([port({ ...DEVICE, vbus: 'VB' })]), holes: [{ name: 'VB', at: [[20, 20]], holeStyle: 'pad', type: 'power_in' }] })).toEqual([])
    expect(errorsOf(base([v5, port({ ...DEVICE, vbus: 'VIN' })]))).toEqual(['pins: USB port "USB" has vbus "VIN", which must name one of the part\'s own pins or pads (not a USB port)'])
    expect(errorsOf(base([port({ ...DEVICE, vbus: 'USB2' }), port(DEVICE, 'USB2')]))).toEqual(['pins: USB port "USB" has vbus "USB2", which must name one of the part\'s own pins or pads (not a USB port)'])
    expect(errorsOf(base([v5, port({ connector: 'A', gender: 'receptacle', role: 'host', vbus: '5V' })]))).toEqual(['pins[1].usb.vbus: only a device or dual port feeds the board\'s VBUS'])
  })
  it('never on a hole group', () => {
    const raw = { ...base([{ name: 'GND', side: 'left', type: 'ground' }]), holes: [{ name: 'U', at: [[20, 20]], holeStyle: 'pad', type: 'usb' }] }
    expect(errorsOf(raw)).toEqual(['holes[0]: a USB port is a pin on the body edge, not a hole group'])
  })
  it('validates shared budgets and the setting they apply under', () => {
    const host = (n: string) => port({ connector: 'A', gender: 'receptacle', role: 'host', version: '2.0' }, n, 'right')
    const settings = { supply: ['5V 5A', '5V 3A'] }
    const good = base([host('USB1'), host('USB2')], { params: {}, settings, usbBudget: [{ ports: ['USB1', 'USB2'], mA: 1600, setting: ['supply', '5V 5A'] }, { ports: ['USB1', 'USB2'], mA: 600, setting: ['supply', '5V 3A'] }] })
    const r = validateModule(good)
    expect(r.ok).toBe(true)
    const m = (r as { module: ModuleDef }).module
    expect(usbBudgets({}, m).map((b) => b.mA)).toEqual([1600])
    expect(usbBudgets({ settings: { supply: '5V 3A' } }, m).map((b) => b.mA)).toEqual([600])
    const bad = base([host('USB1')], { params: {}, usbBudget: [{ ports: ['USB9'], mA: 0, setting: ['supply', 'x'], extra: 1 }] })
    expect(errorsOf(bad)).toEqual([
      'electrical.usbBudget[0].extra: unknown field',
      'electrical.usbBudget[0].ports[0]: no USB port named "USB9"',
      'electrical.usbBudget[0].mA: must be a current in mA, above 0',
      'electrical.usbBudget[0].setting: must be [setting name, choice] from electrical.settings',
    ])
  })
  it('a hub has one upstream port, downstream ports and its power', () => {
    const up = port({ connector: 'B', gender: 'receptacle', role: 'device', hub: 'upstream' }, 'UP', 'left')
    const down = port({ connector: 'A', gender: 'receptacle', role: 'host', hub: 'downstream' }, 'P1', 'right')
    const dc = { name: 'DC+', side: 'top', type: 'power_in', supply: '5V' }
    const r = validateModule(base([up, down, dc], { params: {}, usbHub: { power: { pin: 'DC+' } } }))
    expect(r.ok).toBe(true)
    expect(usbHubOf((r as { module: ModuleDef }).module)).toEqual({ power: { pin: 'DC+' } })
    expect(errorsOf(base([up, down], { params: {}, usbHub: { power: 'mains' } }))).toEqual([expect.stringMatching(/^electrical\.usbHub: must be/)])
    expect(errorsOf(base([down], { params: {}, usbHub: { power: 'bus' } }))).toEqual(['electrical.usbHub: a hub has exactly one upstream port and at least one downstream port'])
  })
})

describe('Ruling U1: adding USB ports to a library part is an update', () => {
  const header = [{ name: 'GND', side: 'left', type: 'ground' }, { name: '5V', side: 'left', type: 'power_in', supply: '5V' }]
  const mod = (pins: unknown[]): ModuleDef => {
    const r = validateModule({ ...base(pins), id: 'b' })
    if (!r.ok) throw new Error(r.errors.join('; '))
    return r.module
  }
  it('an appended port on a free side', () => {
    const stored = mod(header)
    const lib = mod([...header, port(DEVICE)])
    expect(moduleDrift(stored, lib)).toEqual({ kind: 'update', moved: false, what: ['USB port USB'] })
  })
  it('a port in a slot the stored copy kept as a spacer', () => {
    const stored = mod([...header, { spacer: true, side: 'left' }, { name: 'IN', side: 'left', type: 'input' }])
    const lib = mod([...header, port(DEVICE, 'USB', 'left'), { name: 'IN', side: 'left', type: 'input' }])
    expect(layoutModule(lib).pins.find((p) => p.name === 'IN')!.edge).toEqual(layoutModule(stored).pins.find((p) => p.name === 'IN')!.edge)
    expect(moduleDrift(stored, lib)?.kind).toBe('update')
  })
  it('still blocks when the port moves another pin or replaces one', () => {
    // Appended on the side the header uses: the header pins shift.
    expect(moduleDrift(mod(header), mod([...header, port(DEVICE, 'USB', 'left')]))).toMatchObject({ kind: 'block', moved: true })
    // The RTL-SDR case: contact pins become one port.
    const contacts = mod([{ name: 'VBUS', side: 'left', type: 'power_in', supply: '5V' }, { name: 'D-', side: 'left', type: 'io' }])
    expect(moduleDrift(contacts, mod([port({ connector: 'A', gender: 'plug', role: 'device' }, 'USB', 'left')]))?.kind).toBe('block')
  })
})
