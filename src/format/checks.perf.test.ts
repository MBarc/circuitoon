// The wiring checker on built-in parts: real pinouts give the findings the spec's examples name,
// and a big sheet (200 parts, 500 wires) is checked well inside the 20 ms budget.
import { describe, expect, it } from 'vitest'
import { checkDiagram } from './checks.ts'
import type { Connection, Diagram, PartInstance } from './diagram.ts'
import { analyseMains, hasMainsData } from './mains.ts'
import type { ModuleDef } from './module.ts'
import { load, pinsOf } from './builtinModules.testing.ts'

const ids = ['esp32-devkitc-v4', 'ip5306-usbc-module', 'battery-18650-holder', 'bme280-module-6pin', 'oled-ssd1306-096-i2c', 'resistor', 'led', 'lm2596-buck-module', 'breadboard-full', 'arduino-nano']
const mods: Record<string, ModuleDef> = Object.fromEntries(ids.map((id) => [id, load(id)]))
const sheet = (parts: PartInstance[], connections: Connection[]): Diagram => ({ format: 'circuitoon-diagram/1', title: 't', modules: mods, parts, connections })
const at = (uid: string, designator: string, module: string, x: number): PartInstance => ({ uid, designator, module, x, y: 0 })

describe('checkDiagram on built-in parts', () => {
  it('flags a 5 V supply wired into an ESP32 3V3 pin, and a cell wired to a ground that leads back to it', () => {
    const d = sheet(
      [at('u1', 'U1', 'esp32-devkitc-v4', 0), at('u2', 'U2', 'ip5306-usbc-module', 400), at('bt1', 'BT1', 'battery-18650-holder', 800)],
      [
        { uid: 'w1', from: { part: 'u2', pin: '5V+' }, to: { part: 'u1', pin: '3V3' } },
        { uid: 'w2', from: { part: 'u2', pin: '5V-' }, to: { part: 'u1', pin: 'GND' } },
        { uid: 'w3', from: { part: 'bt1', pin: '+' }, to: { part: 'u1', pin: 'GND' } },
        { uid: 'w4', from: { part: 'bt1', pin: '-' }, to: { part: 'u1', pin: 'GND 2' } },
      ],
    )
    const msgs = checkDiagram(d).map((f) => `${f.rule}: ${f.message}`)
    expect(msgs).toContain('supplies-fight: U2 5V+ (5 V) and U1 3V3 (3.3 V) are wired together: the two supplies fight, and the higher one drives current into the lower one, which can damage both. Remove the wire from U2 5V+ to U1 3V3.')
    expect(msgs).toContain('short: BT1 + is wired to U1 GND, which leads back to BT1 -: short circuit. Nothing limits the current, so BT1 and the wires can overheat. Remove the wire from BT1 + to U1 GND.')
  })
  it('flags a 3.3 V only sensor on 5 V, and a buck set above what a display takes', () => {
    const d = sheet(
      [at('u1', 'U1', 'ip5306-usbc-module', 0), at('u2', 'U2', 'bme280-module-6pin', 400), { ...at('u3', 'U3', 'lm2596-buck-module', 800), values: { voltage: { value: 12, unit: 'V' } } }, at('u4', 'U4', 'oled-ssd1306-096-i2c', 1200)],
      [
        { uid: 'w1', from: { part: 'u1', pin: '5V+' }, to: { part: 'u2', pin: 'VCC' } },
        { uid: 'w2', from: { part: 'u1', pin: '5V-' }, to: { part: 'u2', pin: 'GND' } },
        { uid: 'w3', from: { part: 'u3', pin: 'OUT+' }, to: { part: 'u4', pin: 'VCC' } },
        { uid: 'w4', from: { part: 'u3', pin: 'OUT-' }, to: { part: 'u4', pin: 'GND' } },
      ],
    )
    const msgs = checkDiagram(d).map((f) => f.message)
    expect(msgs).toContain('U2 VCC accepts up to 3.3 V but gets 5 V from U1 5V+. Use a 3.3 V supply instead.')
    expect(msgs).toContain('U4 VCC accepts up to 5 V but U3 OUT+ is set to 12 V. Set U3 to 5 V or move the wire to a 5 V pin.')
  })

  it('checks 200 parts and 500 wires in 20 ms or less (median)', { retry: 2 }, () => {
    // 40 resistors seated on four full boards, and 150 loose real parts wired pin to pin.
    const parts: PartInstance[] = []
    for (let b = 0; b < 4; b++) {
      parts.push({ uid: `bb${b}`, designator: `BB${b + 1}`, module: 'breadboard-full', x: 0, y: b * 400 })
      for (let k = 0; k < 10; k++)
        parts.push({ uid: `r${b}-${k}`, designator: `R${b * 10 + k + 1}`, module: 'resistor', x: 30 + (k % 5) * 90, y: b * 400 + (k < 5 ? 40 : 80), mount: { board: `bb${b}` } })
    }
    const loose = ['esp32-devkitc-v4', 'bme280-module-6pin', 'oled-ssd1306-096-i2c', 'led', 'battery-18650-holder', 'ip5306-usbc-module']
    for (let i = parts.length; i < 200; i++) parts.push(at(`p${i}`, `U${i}`, loose[i % loose.length], 1000 + (i % 15) * 300))
    const pinNames = (p: PartInstance) => pinsOf(mods[p.module]).map((q) => q.name)
    const looseParts = parts.slice(44)
    const connections: Connection[] = []
    let seed = 7
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n)
    while (connections.length < 500) {
      const a = looseParts[rnd(looseParts.length)]
      const b = looseParts[rnd(looseParts.length)]
      const pa = pinNames(a)
      const pb = pinNames(b)
      connections.push({ uid: `w${connections.length}`, from: { part: a.uid, pin: pa[rnd(pa.length)] }, to: { part: b.uid, pin: pb[rnd(pb.length)] } })
    }
    const d = sheet(parts, connections)
    expect(hasMainsData(d)).toBe(false)
    expect(analyseMains(d)).toBeNull()
    const found = checkDiagram(d)
    expect(found.length).toBeGreaterThan(0)
    expect(found.filter((f) => f.rule === 'mount')).toEqual([])
    // A fresh parts array each run, as after an edit, so the mount cache does not carry over.
    const t: number[] = []
    for (let i = 0; i < 13; i++) {
      const next = { ...d, parts: [...d.parts] }
      const s = performance.now()
      checkDiagram(next)
      t.push(performance.now() - s)
    }
    t.sort((a, b) => a - b)
    expect(t[6]).toBeLessThanOrEqual(20)
  })

  it('advises on a shorted loop among 198 loads in 20 ms or less (median), with the same findings', { retry: 2 }, () => {
    // Two Nanos with crossed power leads (a shorted loop) and 198 resistors each across U1 5V and
    // GND: 200 parts, 398 wires. Loop advice must not rebuild the netlist once per wire on the loop nets.
    const parts: PartInstance[] = [at('n1', 'U1', 'arduino-nano', 0), at('n2', 'U2', 'arduino-nano', 300)]
    const connections: Connection[] = [
      { uid: 'x1', from: { part: 'n1', pin: '5V' }, to: { part: 'n2', pin: 'GND' } },
      { uid: 'x2', from: { part: 'n2', pin: '5V' }, to: { part: 'n1', pin: 'GND' } },
    ]
    for (let i = 0; i < 198; i++) {
      parts.push(at(`r${i}`, `R${i + 1}`, 'resistor', 600 + i * 40))
      connections.push({ uid: `a${i}`, from: { part: 'n1', pin: '5V' }, to: { part: `r${i}`, pin: '1' } })
      connections.push({ uid: `b${i}`, from: { part: `r${i}`, pin: '2' }, to: { part: 'n1', pin: 'GND' } })
    }
    const d = sheet(parts, connections)
    expect(checkDiagram(d).map((f) => `${f.severity} ${f.rule}: ${f.message}`)).toEqual([
      'error short: U1 5V and U2 5V are wired in a loop, each + to the next -: short circuit. Nothing limits the current, so they can overheat. Remove one of these wires: U1 5V to U2 GND, or U2 5V to U1 GND.',
    ])
    const t: number[] = []
    for (let i = 0; i < 13; i++) {
      const next = { ...d, parts: [...d.parts] }
      const s = performance.now()
      checkDiagram(next)
      t.push(performance.now() - s)
    }
    t.sort((a, b) => a - b)
    expect(t[6]).toBeLessThanOrEqual(20)
  })
})
