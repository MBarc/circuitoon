// circuitoon explain: a netlist and the sheet laid out from it read back in plain English (every
// connection by net, what each pin in use does, unconnected parts, the pin-rule findings), as text
// and as JSON matching its schema. Explaining never blocks.
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cli, tempDir } from './cliHarness.testing.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { USAGE } from './main.ts'

const EXAMPLES = join(import.meta.dirname, '..', '..', 'plugin', 'skills', 'circuitoon-design', 'references', 'examples')
const bme = () => JSON.parse(readFileSync(join(EXAMPLES, 'esp32-bme280.netlist.json'), 'utf8'))

/** A folder holding `n.json` (the netlist) and, laid out from it, `sheet.json`. */
const files = async (netlist: unknown, layout = true) => {
  const dir = tempDir()
  writeFileSync(join(dir, 'n.json'), JSON.stringify(netlist))
  if (layout) expect((await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })).code).toBe(0)
  return dir
}

describe('circuitoon explain', () => {
  it('reads a netlist back: connections by net, pins in use, unconnected parts and findings', async () => {
    const dir = await files(bme(), false)
    const r = await cli(['explain', 'n.json'], { cwd: dir })
    expect(r.code).toBe(0)
    expect(r.out).toContain('Explain: ESP32 with a BME280 on I2C (netlist)')
    expect(r.out).toContain('  SDA: ESP32 DevKitC V4 (U1) IO21 -> BME280 sensor module (U2) SDA')
    expect(r.out).toContain('  GND: ESP32 DevKitC V4 (U1) GND -> BME280 sensor module (U2) GND')
    expect(r.out).toContain('    U1 IO21: input/output')
    expect(r.out).toContain('    U2 SDA: input/output, I2C data (SDA)')
    expect(r.out).toContain('U2 BME280 sensor module (4-pin, I2C: VIN GND SCL SDA) [bme280-module-4pin]: I2C address 0x76')
    expect(r.out).toMatch(/Not connected:\n {2}none\n/)
    expect(r.out).toMatch(/Pin rule findings:\n {2}INFO i2c-pullups-unknown: .*check whether a module provides pull-ups/)
  })
  it('explains the sheet laid out from it with the same connections, from its real connectivity', async () => {
    const dir = await files(bme())
    const net = JSON.parse((await cli(['explain', 'n.json', '--json'], { cwd: dir })).out)
    const sheet = JSON.parse((await cli(['explain', 'sheet.json', '--json'], { cwd: dir })).out)
    expect(sheet.source).toBe('sheet')
    // By label: a board's joined GND pins read as one GND, whichever of them the layout wired.
    const ends = (x: { nets: { ends: { designator: string; label: string }[] }[] }) => x.nets.map((n) => n.ends.map((e) => `${e.designator}.${e.label}`).join(' ')).sort()
    expect(ends(sheet)).toEqual(ends(net))
    expect(sheet.findings.map((f: { rule: string }) => f.rule)).toEqual(['i2c-pullups-unknown'])
  })
  it('says what each limited pin does and reports the rule it breaks, without blocking', async () => {
    const dir = await files({
      format: 'circuitoon-netlist/1', title: 'Relay on an input-only pin',
      parts: [{ ref: 'U1', module: 'esp32-devkit-v1-30' }, { ref: 'K1', module: 'relay-module-1ch-5v' }, { ref: 'S1', module: 'push-button' }],
      nets: [{ name: 'VIN', pins: ['U1.VIN', 'K1.DC+'] }, { name: 'GND', pins: ['U1.GND', 'K1.DC-'] }, { name: 'RELAY', pins: ['U1.D34', 'K1.IN'] }],
    }, false)
    const r = await cli(['explain', 'n.json', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    const out = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('explain'), out)).toEqual([])
    expect(out.ok).toBe(false)
    const d34 = out.parts.find((p: { designator: string }) => p.designator === 'U1').pins.find((p: { pin: string }) => p.pin === 'D34')
    // Said once: no "input, input only", and the note adds what the caps do not say.
    expect(d34.does).toBe("input only, no internal pull-up or pull-down. GPIO34 is one of the ESP32's sensor inputs, GPIO34-39.")
    expect(out.findings).toMatchObject([{ rule: 'pin-input-only', severity: 'error', parts: ['U1', 'K1'], wires: [] }])
    expect(out.unconnected).toEqual([{ part: 'S1', designator: 'S1', module: 'push-button', name: 'Push button' }])
    const text = (await cli(['explain', 'n.json'], { cwd: dir })).out
    expect(text).toContain('  RELAY: ESP32 DevKit V1 (U1) D34 -> Relay module 1 channel 5 V (K1) IN')
    expect(text).toMatch(/Not connected:\n {2}S1 Push button \[push-button\]/)
    expect(text).toContain('ERROR pin-input-only: U1 D34 is input only')
  })
  it('notes a sheet whose copy of a part is older than the library', async () => {
    const dir = await files(bme())
    const sheet = JSON.parse(readFileSync(join(dir, 'sheet.json'), 'utf8'))
    const m = sheet.modules['esp32-devkitc-v4']
    for (const p of m.pins) delete p.caps
    writeFileSync(join(dir, 'old.json'), JSON.stringify(sheet))
    const out = JSON.parse((await cli(['explain', 'old.json', '--json'], { cwd: dir })).out)
    expect(out.notes).toHaveLength(1)
    expect(out.notes[0]).toMatch(/^The sheet's copy of esp32-devkitc-v4 differs from the current library only in .*pins \(pin data\).*run `circuitoon update` or use Update parts in the editor\. Until then, its pin capabilities and I2C data are the old copy's\.$/)
  })
  it('exits 2 on a file that is neither a sheet nor a netlist, and is in the usage', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'x.json'), JSON.stringify({ format: 'nope' }))
    const r = await cli(['explain', 'x.json'], { cwd: dir })
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/not a Circuitoon sheet or netlist/)
    expect(USAGE).toContain('explain <sheet.json|netlist.json> [--json]')
  })
})

describe('circuitoon explain and layout on USB links', () => {
  const usb = {
    format: 'circuitoon-netlist/1', title: 'Pi 4 with an ESP32 and an RTL-SDR on USB',
    parts: [{ ref: 'U1', module: 'rpi-4-model-b' }, { ref: 'U2', module: 'esp32-devkit-v1-30' }, { ref: 'U3', module: 'rtl-sdr-blog-v4' }],
    nets: [{ name: 'USB-ESP', pins: ['U1.USB2-1', 'U2.USB'] }, { name: 'USB-SDR', pins: ['U1.USB3-1', 'U3.USB'] }],
  }
  it('lays a cable between two sockets and plugs the dongle straight in; explain names each port', async () => {
    const dir = await files(usb)
    const sheet = JSON.parse(readFileSync(join(dir, 'sheet.json'), 'utf8'))
    const link = (a: string) => sheet.connections.find((c: { from: { pin: string }; to: { pin: string } }) => c.from.pin === a || c.to.pin === a)
    expect(link('USB2-1').ends).toBeDefined()
    expect([link('USB2-1').ends.from, link('USB2-1').ends.to].sort()).toEqual(['usb-a', 'usb-micro-b'])
    expect(link('USB3-1').ends).toBeUndefined()
    const r = await cli(['explain', 'sheet.json'], { cwd: dir })
    expect(r.code).toBe(0)
    expect(r.out).toContain('    U2 USB: USB micro-B receptacle, device, 2.0 full speed, draw not known')
    expect(r.out).toContain('    U3 USB: USB A plug, device, 2.0, draws 270 mA')
    expect(r.out).toContain('    U1 USB3: USB A receptacle, host, 3.0 super speed')
    expect(r.out).toMatch(/INFO usb-power-unknown: The current U1 USB2 is asked for is not fully known/)
  })
})
