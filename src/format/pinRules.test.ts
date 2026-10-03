// The pin-capability rules (pin-flash, pin-input-only, pin-output-only, pin-strapping,
// pin-no-pullup) and the I2C rules (i2c-pullups, i2c-pullups-unknown, i2c-address-clash,
// i2c-address-floating), each shown firing and staying quiet, through the wiring checker.
import { describe, expect, it } from 'vitest'
import { type Finding, checkDiagram } from './checks.ts'
import type { Connection, Diagram, PartInstance } from './diagram.ts'
import { type ModuleDef, type PinDef, validateModule } from './module.ts'
import { buildPinModel, i2cAddress } from './pinRules.ts'

const mod = (id: string, pins: PinDef[], extra: Partial<ModuleDef> = {}): ModuleDef => ({ format: 'circuitoon-module/1', id, name: id, pins, ...extra })

/** An ESP32-like board on USB, with one pin of each kind. */
const esp = mod('esp', [
  { name: '5V', side: 'left', type: 'power_in', supply: '5V' },
  { name: '3V3', side: 'left', type: 'power_out', supply: '3V3' },
  { name: 'GND', side: 'left', type: 'ground' },
  { name: 'IO34', side: 'left', type: 'input', caps: { inputOnly: true, noPullup: true, note: 'GPIO34-39 have no output driver.' } },
  { name: 'SD0', side: 'left', caps: { flash: true, note: 'SD0 is GPIO7, a flash data line.' } },
  { name: 'IO0', side: 'right', type: 'io', caps: { strapping: 'high', note: 'Low at reset starts the download mode.' } },
  { name: 'IO2', side: 'right', type: 'io', caps: { strapping: 'low' } },
  { name: 'IO5', side: 'right', type: 'io', caps: { strapping: 'either' } },
  { name: 'IO12', side: 'right', type: 'io', caps: { strapping: 'low', note: 'High at reset selects 1.8 V flash.' } },
  { name: 'IO13', side: 'right', type: 'io' },
  { name: 'IO21', side: 'right', type: 'io' },
  { name: 'IO22', side: 'right', type: 'io' },
], { electrical: { model: 'mcu', external: [{ pin: '5V', volts: 5, via: 'USB' }] } })
/** An MCP23017-like expander: GPA7 output only, address 0x20 + A2A1A0, no pull-ups. */
const exp = mod('exp', [
  { name: 'VDD', side: 'left', type: 'power_in', supply: '3V3/5V' },
  { name: 'VSS', side: 'left', type: 'ground' },
  { name: 'SCL', side: 'left', type: 'input' },
  { name: 'SDA', side: 'left', type: 'io' },
  { name: 'A0', side: 'bottom', type: 'input' },
  { name: 'A1', side: 'bottom', type: 'input' },
  { name: 'A2', side: 'bottom', type: 'input' },
  { name: 'GPA0', side: 'right', type: 'io' },
  { name: 'GPA7', side: 'right', type: 'output', caps: { outputOnly: true } },
], { electrical: { model: 'io-expander', i2c: { sda: 'SDA', scl: 'SCL', pullups: false, address: { base: 0x20, pins: [{ pin: 'A0', add: 1 }, { pin: 'A1', add: 2 }, { pin: 'A2', add: 4 }] } } } })
/** An OLED with pull-ups on board, its address set by a resistor (a part setting). */
const oled = mod('oled', [
  { name: 'VCC', side: 'top', type: 'power_in', supply: '3V3/5V' },
  { name: 'GND', side: 'top', type: 'ground' },
  { name: 'SCL', side: 'top', type: 'input' },
  { name: 'SDA', side: 'top', type: 'io' },
], { electrical: { model: 'display', settings: { address: ['0x3C', '0x3D'] }, i2c: { sda: 'SDA', scl: 'SCL', pullups: true, address: { setting: 'address' } } } })
/** A sensor whose pull-ups are not known; SDO picks the address and the board pulls it low. */
const sens = mod('sens', [
  { name: 'VCC', side: 'top', type: 'power_in', supply: '3V3' },
  { name: 'GND', side: 'top', type: 'ground' },
  { name: 'SCL', side: 'top', type: 'input' },
  { name: 'SDA', side: 'top', type: 'io' },
  { name: 'SDO', side: 'top', type: 'io' },
], { electrical: { model: 'sensor', i2c: { sda: 'SDA', scl: 'SCL', address: { base: 0x76, pins: [{ pin: 'SDO', add: 1, floating: 0 }] } } } })
const chip = mod('chip', [{ name: 'D', side: 'left', type: 'input' }, { name: 'Q', side: 'right', type: 'output' }])
const res = mod('res', [{ name: '1', side: 'left', type: 'passive' }, { name: '2', side: 'right', type: 'passive' }], { electrical: { model: 'resistor', terminals: { a: '1', b: '2' } } })
const sw = mod('sw', [{ name: '1', side: 'left', type: 'passive' }, { name: '2', side: 'right', type: 'passive' }], { electrical: { model: 'switch', terminals: { a: '1', b: '2' } } })
const led = mod('led', [{ name: 'A', side: 'left', type: 'passive' }, { name: 'K', side: 'right', type: 'passive' }], { electrical: { model: 'led' } })

const MODULES = { esp, exp, oled, sens, chip, res, sw, led }
let seq = 0
const part = (designator: string, module: keyof typeof MODULES, extra: Partial<PartInstance> = {}): PartInstance => ({ uid: designator.toLowerCase(), designator, module, x: seq++ * 200, y: 0, ...extra })
let wn = 0
const wire = (a: string, b: string): Connection => {
  const end = (s: string) => { const [p, pin] = s.split('.'); return { part: p, pin } }
  return { uid: `w${wn++}`, from: end(a), to: end(b) }
}
const sheet = (parts: PartInstance[], connections: Connection[]): Diagram => ({ format: 'circuitoon-diagram/1', title: 't', modules: MODULES, parts, connections })
const only = (d: Diagram, rule: string): Finding[] => checkDiagram(d).filter((f) => f.rule === rule)
/** U1 (esp) powered from USB, with the given extra parts and wires. */
const board = (parts: PartInstance[], wires: Connection[]) => sheet([part('U1', 'esp'), ...parts], wires)

describe('pin-flash', () => {
  it('is an error when anything is wired to a flash pin, naming it and a free GPIO', () => {
    const f = only(board([part('U2', 'chip')], [wire('u1.SD0', 'u2.D')]), 'pin-flash')
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('error')
    expect(f[0].message).toBe("U1 SD0 is a flash pin (SD0 is GPIO7, a flash data line), so nothing may be wired to it, but U2 D is. The board will not run like this. Move it to a free GPIO, such as IO13.")
  })
  it('stays quiet while the flash pin is left free', () => {
    expect(only(board([part('U2', 'chip')], [wire('u1.IO13', 'u2.D')]), 'pin-flash')).toEqual([])
  })
})

describe('pin-input-only', () => {
  it('fires when an input-only pin is the only driver of an input', () => {
    const f = only(board([part('U2', 'chip')], [wire('u1.IO34', 'u2.D')]), 'pin-input-only')
    expect(f).toHaveLength(1)
    expect(f[0].message).toBe('U1 IO34 is input only (GPIO34-39 have no output driver): it cannot drive U2 D, and nothing else on the net does. Move the wire to a GPIO that can output, such as IO13.')
  })
  it('fires on an LED behind a series resistor', () => {
    const d = board([part('R1', 'res'), part('D1', 'led')], [wire('u1.IO34', 'r1.1'), wire('r1.2', 'd1.A'), wire('d1.K', 'u1.GND')])
    expect(only(d, 'pin-input-only').map((f) => f.message)[0]).toContain('cannot drive D1 (an LED)')
  })
  it('stays quiet when something else drives the net, and on a pin that can output', () => {
    expect(only(board([part('U2', 'chip'), part('U3', 'chip')], [wire('u1.IO34', 'u2.D'), wire('u3.Q', 'u2.D')]), 'pin-input-only')).toEqual([])
    expect(only(board([part('U2', 'chip')], [wire('u1.IO13', 'u2.D')]), 'pin-input-only')).toEqual([])
  })
})

describe('pin-output-only', () => {
  it('fires when an output-only pin reads a switch (the tilt-switch case)', () => {
    const d = sheet([part('U1', 'exp'), part('S1', 'sw')], [wire('u1.GPA7', 's1.1'), wire('s1.2', 'u1.VSS')])
    const f = only(d, 'pin-output-only')
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('error')
    expect(f[0].message).toBe('U1 GPA7 is output only, but it is wired to S1 (a switch) as an input. Use another pin to read it, such as GPA0.')
  })
  it('fires when it is wired to a sensor output', () => {
    expect(only(sheet([part('U1', 'exp'), part('U2', 'chip')], [wire('u1.GPA7', 'u2.Q')]), 'pin-output-only')).toHaveLength(1)
  })
  it('stays quiet on a pin that can read, and when the pin drives a load', () => {
    expect(only(sheet([part('U1', 'exp'), part('S1', 'sw')], [wire('u1.GPA0', 's1.1'), wire('s1.2', 'u1.VSS')]), 'pin-output-only')).toEqual([])
    expect(only(sheet([part('U1', 'exp'), part('U2', 'chip')], [wire('u1.GPA7', 'u2.D')]), 'pin-output-only')).toEqual([])
  })
})

describe('pin-strapping', () => {
  it('warns when a pin that must be low at reset is pulled up, with what the boot needs', () => {
    const f = only(board([part('R1', 'res')], [wire('u1.IO12', 'r1.1'), wire('r1.2', 'u1.3V3')]), 'pin-strapping')
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('warning')
    expect(f[0].message).toBe('U1 IO12 is a strapping pin that must be low at reset (High at reset selects 1.8 V flash), but R1 pulls it up to the supply. Move that circuit to a GPIO that is not a strapping pin, such as IO13, or make sure it is low while the board starts.')
  })
  it('warns on a switch to GND on a pin that must be high, and on a pin wired straight to the wrong rail', () => {
    expect(only(board([part('S1', 'sw')], [wire('u1.IO0', 's1.1'), wire('s1.2', 'u1.GND')]), 'pin-strapping')[0].message).toContain('S1 pulls it to GND whenever it is closed at reset')
    expect(only(board([], [wire('u1.IO2', 'u1.3V3')]), 'pin-strapping')[0].message).toContain('it is wired straight to U1 3V3')
  })
  it('stays quiet when the pin only feeds a power input (nothing there holds it high)', () => {
    const sensor = mod('sensor', [{ name: 'VCC', side: 'top', type: 'power_in', supply: '3V3' }])
    const d = { ...board([part('U2', 'chip')], [wire('u1.IO2', 'u2.D')]), parts: [part('U1', 'esp'), part('U2', 'sensor' as keyof typeof MODULES)], connections: [wire('u1.IO2', 'u2.VCC')], modules: { ...MODULES, sensor } }
    expect(only(d, 'pin-strapping')).toEqual([])
  })
  it('stays quiet on a pull to the right level, on an either-level pin, and on a display input', () => {
    expect(only(board([part('R1', 'res')], [wire('u1.IO12', 'r1.1'), wire('r1.2', 'u1.GND')]), 'pin-strapping')).toEqual([])
    expect(only(board([part('R1', 'res')], [wire('u1.IO5', 'r1.1'), wire('r1.2', 'u1.GND')]), 'pin-strapping')).toEqual([])
    expect(only(board([part('U2', 'chip')], [wire('u1.IO12', 'u2.D')]), 'pin-strapping')).toEqual([])
  })
})

describe('pin-no-pullup', () => {
  it('warns on a switch to GND on an input with no pull-up and no resistor', () => {
    const f = only(board([part('S1', 'sw')], [wire('u1.IO34', 's1.1'), wire('s1.2', 'u1.GND')]), 'pin-no-pullup')
    expect(f).toHaveLength(1)
    expect(f[0].message).toBe('U1 IO34 has no internal pull-up or pull-down, and S1 switches it to ground with no resistor to hold it high while S1 is open: the input floats and reads noise. Add a pull-up resistor (10 kOhm) from IO34 to the logic supply, or read S1 on a GPIO with an internal pull-up, such as IO13.')
  })
  it('stays quiet with a pull-up resistor, and on a pin that has its own pull-up', () => {
    expect(only(board([part('S1', 'sw'), part('R1', 'res')], [wire('u1.IO34', 's1.1'), wire('s1.2', 'u1.GND'), wire('u1.IO34', 'r1.1'), wire('r1.2', 'u1.3V3')]), 'pin-no-pullup')).toEqual([])
    expect(only(board([part('S1', 'sw')], [wire('u1.IO13', 's1.1'), wire('s1.2', 'u1.GND')]), 'pin-no-pullup')).toEqual([])
  })
})

/** U1 with an I2C device on IO21 (SDA) and IO22 (SCL), powered and grounded. */
const bus = (devices: [string, keyof typeof MODULES, Partial<PartInstance>?][], extra: Connection[] = [], more: PartInstance[] = []) => {
  const parts = devices.map(([d, m, x]) => part(d, m, x))
  const wires = devices.flatMap(([d, m]) => {
    const u = d.toLowerCase()
    const power = m === 'exp' ? [wire(`${u}.VDD`, 'u1.3V3'), wire(`${u}.VSS`, 'u1.GND')] : [wire(`${u}.VCC`, 'u1.3V3'), wire(`${u}.GND`, 'u1.GND')]
    return [wire(`${u}.SDA`, 'u1.IO21'), wire(`${u}.SCL`, 'u1.IO22'), ...power]
  })
  return board([...parts, ...more], [...wires, ...extra])
}
const strap = (u: string, levels: [string, string, string]) => (['A0', 'A1', 'A2'] as const).map((a, i) => wire(`${u}.${a}`, levels[i] === '1' ? 'u1.3V3' : 'u1.GND'))

describe('i2c-pullups', () => {
  it('warns on a bus where every device says it has no pull-ups and none is wired', () => {
    const f = only(bus([['U2', 'exp']], strap('u2', ['0', '0', '0'])), 'i2c-pullups')
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('warning')
    expect(f[0].message).toBe('The I2C bus at U1 IO21 (SDA) and U1 IO22 (SCL), with U2 on it, has no pull-up on SDA and SCL: U2 has none on board and none is wired, so the bus cannot work. I2C needs one pull-up on SDA and one on SCL: add a 4.7 kOhm resistor from SDA and another from SCL to the logic supply.')
  })
  it('names the one line still missing a pull-up', () => {
    const d = bus([['U2', 'exp']], [...strap('u2', ['0', '0', '0']), wire('u1.IO21', 'r1.1'), wire('r1.2', 'u1.3V3')], [part('R1', 'res')])
    expect(only(d, 'i2c-pullups')[0].message).toContain('has no pull-up on SCL')
  })
  it('stays quiet with resistors to the supply on both lines, or a module with pull-ups on board', () => {
    const wired = bus([['U2', 'exp']], [...strap('u2', ['0', '0', '0']), wire('u1.IO21', 'r1.1'), wire('r1.2', 'u1.3V3'), wire('u1.IO22', 'r2.1'), wire('r2.2', 'u1.3V3')], [part('R1', 'res'), part('R2', 'res')])
    expect(only(wired, 'i2c-pullups')).toEqual([])
    expect(only(bus([['U2', 'exp'], ['DS1', 'oled']], strap('u2', ['0', '0', '0'])), 'i2c-pullups')).toEqual([])
  })
  it('only notes it when a device may have pull-ups on board: check whether a module provides them', () => {
    const d = bus([['U2', 'sens']])
    expect(only(d, 'i2c-pullups')).toEqual([])
    const f = only(d, 'i2c-pullups-unknown')
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('info')
    expect(f[0].message).toContain('check whether a module provides pull-ups')
  })
})

describe('i2c-address-clash', () => {
  it('is an error when two expanders have the same address pins', () => {
    const f = only(bus([['U2', 'exp'], ['U3', 'exp']], [...strap('u2', ['0', '0', '0']), ...strap('u3', ['0', '0', '0'])]), 'i2c-address-clash')
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('error')
    expect(f[0].message).toBe("U2 and U3 are both at I2C address 0x20 on the bus at U1 IO21 (SDA) and U1 IO22 (SCL): they answer together and the bus fails. Give each its own address: wire U3's address pins (A0, A1, A2) differently.")
  })
  it('stays quiet when the address pins differ', () => {
    expect(only(bus([['U2', 'exp'], ['U3', 'exp']], [...strap('u2', ['0', '0', '0']), ...strap('u3', ['1', '0', '0'])]), 'i2c-address-clash')).toEqual([])
  })
  it('reads an address set on the board from the part setting, its first choice by default', () => {
    expect(only(bus([['DS1', 'oled'], ['DS2', 'oled']]), 'i2c-address-clash')[0].message).toContain('0x3C')
    expect(only(bus([['DS1', 'oled'], ['DS2', 'oled', { settings: { address: '0x3D' } }]]), 'i2c-address-clash')).toEqual([])
  })
  it('stays quiet on devices on different buses', () => {
    const d = bus([['U2', 'exp']], [...strap('u2', ['0', '0', '0']), ...strap('u3', ['0', '0', '0']), wire('u3.SDA', 'u1.IO12'), wire('u3.SCL', 'u1.IO13')], [part('U3', 'exp')])
    expect(only(d, 'i2c-address-clash')).toEqual([])
  })
})

describe('i2c-address-floating', () => {
  it('warns that the address is undefined when an address pin is not connected', () => {
    const d = bus([['U2', 'exp']], [wire('u2.A1', 'u1.GND'), wire('u2.A2', 'u1.GND')])
    const f = only(d, 'i2c-address-floating')
    expect(f).toHaveLength(1)
    expect(f[0].message).toBe("U2 A0 is not connected, so U2's I2C address is undefined: each address pin must be tied to GND or the supply. Connect it to GND or to the supply to choose its address.")
  })
  it('uses the level the board pulls a free address pin to, and reads a pin tied to the supply', () => {
    expect(only(bus([['U2', 'sens']]), 'i2c-address-floating')).toEqual([])
    const parts = [{ id: 'u2', designator: 'U2', module: sens }]
    expect(i2cAddress(buildPinModel(parts, []), parts[0])?.address).toBe(0x76)
    const pm = buildPinModel([...parts, { id: 'u1', designator: 'U1', module: esp }], [[['u2', 'SDO'], ['u1', '3V3']]])
    expect(i2cAddress(pm, parts[0])?.address).toBe(0x77)
  })
})

describe('module format: caps and electrical.i2c', () => {
  const base = { format: 'circuitoon-module/1', id: 'x', name: 'x' }
  const errors = (raw: unknown) => { const r = validateModule(raw); return r.ok ? [] : r.errors }
  it('accepts the documented shapes', () => {
    expect(errors(exp)).toEqual([])
    expect(errors(oled)).toEqual([])
    expect(errors(sens)).toEqual([])
    expect(errors(esp)).toEqual([])
  })
  it('rejects unknown or contradictory caps', () => {
    expect(errors({ ...base, pins: [{ name: 'A', side: 'left', caps: { inputOnly: true, outputOnly: true } }] })).toEqual(['pins[0].caps: a pin cannot be both inputOnly and outputOnly'])
    expect(errors({ ...base, pins: [{ name: 'A', side: 'left', caps: { strapping: 'up', fast: true } }] })).toEqual(['pins[0].caps.fast: unknown capability', 'pins[0].caps.strapping: must be "high", "low" or "either"'])
    expect(errors({ ...base, pins: [{ name: 'A', side: 'left', caps: { flash: 'yes' } }] })).toEqual(['pins[0].caps.flash: must be true when present'])
  })
  it('rejects I2C data that names a missing pin, a bad address or a setting that is no address', () => {
    const pins = [{ name: 'SDA', side: 'left' }, { name: 'SCL', side: 'left' }]
    expect(errors({ ...base, pins, electrical: { i2c: { sda: 'SDA', scl: 'CLK' } } })).toEqual(['electrical.i2c.scl: no pin named "CLK"'])
    expect(errors({ ...base, pins, electrical: { i2c: { sda: 'SDA', scl: 'SCL', address: { fixed: 200 } } } })).toEqual(['electrical.i2c.address.fixed: must be a 7-bit address (0 to 127)'])
    expect(errors({ ...base, pins, electrical: { settings: { address: ['low', 'high'] }, i2c: { sda: 'SDA', scl: 'SCL', address: { setting: 'address' } } } }))
      .toEqual(['electrical.i2c.address.setting: every choice of electrical.settings.address must be an address such as "0x3C"'])
    expect(errors({ ...base, pins, electrical: { i2c: { sda: 'SDA', scl: 'SCL', pullups: 'yes' } } })).toEqual(['electrical.i2c.pullups: must be true or false (leave it out when not known)'])
  })
})
