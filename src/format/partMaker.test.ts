import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Part } from '../render/Part.tsx'
import { HOLE_FILL, buildPart, customId, lintModule, moduleFromSpec, parsePinLines, plateText, slugify, specFromModule, unmodeled, validateSpec, type PartSpec } from './partMaker.ts'
import { MODULE_PX_MAX, isSpacer, pinRoom, layoutModule, validateModule, type ModuleDef, type PinDef } from './module.ts'
import { load, moduleFiles } from './builtinModules.testing.ts'

const builtinModules = () => moduleFiles().map(load)

const INA: PartSpec = {
  name: 'INA219 current sensor (CJMCU-219)',
  category: 'Sensors',
  source: ['https://www.ti.com/lit/ds/symlink/ina219.pdf', 'https://example.com/cjmcu-219'],
  pins: {
    left: [{ name: 'VCC', type: 'power_in', supply: '3V3/5V' }, { name: 'GND', type: 'ground' }, { name: 'SCL', type: 'input' }, { name: 'SDA', type: 'io' }],
    right: [{ name: 'VIN+', type: 'passive' }, { name: 'VIN-', type: 'passive' }],
  },
}
const pinsOf = (m: ModuleDef) => m.pins.filter((p): p is PinDef => !isSpacer(p))
const holes = (m: ModuleDef) => (m.art?.shapes ?? []).filter((s) => s.fill === HOLE_FILL)

describe('moduleFromSpec', () => {
  it('builds a valid custom module with the pins in physical order', () => {
    const m = moduleFromSpec(INA)
    expect(validateModule(m).ok).toBe(true)
    expect(m.custom).toBe(true)
    expect(m.id).toBe('custom-ina219-current-sensor-cjmcu-219')
    expect(m.category).toBe('Sensors')
    expect(m.source).toBe('https://www.ti.com/lit/ds/symlink/ina219.pdf https://example.com/cjmcu-219')
    expect(pinsOf(m).map((p) => `${p.side}:${p.name}`)).toEqual(['left:VCC', 'left:GND', 'left:SCL', 'left:SDA', 'right:VIN+', 'right:VIN-'])
    expect(pinsOf(m)[0]).toMatchObject({ type: 'power_in', supply: '3V3/5V' })
  })

  it('never takes a built-in id', () => {
    const ids = new Set(builtinModules().map((m) => m.id))
    for (const name of ['Resistor', 'LED', 'esp32-devkitc-v4']) expect(ids.has(customId({ name }))).toBe(false)
    expect(customId({ name: 'x', id: 'custom-foo' })).toBe('custom-foo')
    expect(customId({ name: 'My Sensor (v2)' })).toBe('custom-my-sensor-v2')
    expect(slugify('!!!')).toBe('part')
  })

  it('draws a rounded Sticker body, a header strip with a hole on every pin and a name plate', () => {
    const m = moduleFromSpec(INA)
    const [body] = m.art!.shapes
    expect(body).toMatchObject({ x: 0, y: 0, w: m.art!.w, h: m.art!.h, radius: 6, fill: '#2F9E6E' })
    expect(body.outline).not.toBe(false)
    expect(m.art!.pinLabels).toBe('inside')
    expect(holes(m)).toHaveLength(6)
    const lay = layoutModule(m)
    for (const p of lay.pins) {
      const near = holes(m).some((h) => Math.abs(h.x + h.w / 2 - p.edge.x) <= 12 && Math.abs(h.y + h.h / 2 - p.edge.y) <= 12)
      expect(near, p.name).toBe(true)
    }
    expect(m.art!.shapes.some((s) => s.label === 'INA219 current sensor')).toBe(true)
    expect(lintModule(m)).toEqual({ ok: true, errors: [], warnings: [] })
  })

  it('auto-sizes the body to the pins and their labels, and keeps a size that is given', () => {
    const small = moduleFromSpec({ name: 'X', pins: { left: ['A'] } })
    const long = moduleFromSpec({ name: 'X', pins: { left: ['A_VERY_LONG_PIN_NAME'], right: ['ANOTHER_LONG_ONE'] } })
    expect(long.size!.w).toBeGreaterThan(small.size!.w)
    const many = moduleFromSpec({ name: 'X', pins: { left: Array.from({ length: 20 }, (_, i) => `P${i}`) } })
    expect(many.size!.h).toBeGreaterThanOrEqual(22)
    const given = buildPart({ name: 'A long name for a part', body: { w: 6, h: 4 }, pins: { left: ['VCCX', 'GNDX'] } })
    expect(given.ok).toBe(true)
    if (!given.ok) return
    expect(given.module.size).toEqual({ w: 6, h: 4 })
    expect(given.notes.join(' ')).toContain('name plate')
  })

  it('grows a body until labels on two sides no longer cross in a corner', () => {
    const m = moduleFromSpec({ name: 'Q', pins: { left: ['LEFTPIN1', 'LEFTPIN2', 'LEFTPIN3'], top: ['TOPPIN1', 'TOPPIN2', 'TOPPIN3', 'TOPPIN4'] } })
    const lay = layoutModule(m)
    const firstLeft = Math.min(...lay.pins.filter((p) => p.side === 'left').map((p) => p.edge.y))
    expect(firstLeft).toBeGreaterThan(12 + Math.ceil(7 * 4.5 + 3))
  })

  it('numbers repeated names in physical order with the silkscreen as the label', () => {
    const r = buildPart({ name: 'X', pins: { left: [{ name: 'GND', type: 'ground' }, 'VCC'], right: [{ name: 'GND', type: 'ground' }, 'GND'] } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(pinsOf(r.module).map((p) => [p.name, p.label])).toEqual([['GND', 'GND'], ['VCC', 'VCC'], ['GND 2', 'GND'], ['GND 3', 'GND']])
    expect(r.notes[0]).toContain('GND -> GND 2')
  })

  it('keeps gaps as spacers and splits the header strip around them', () => {
    const m = moduleFromSpec({ name: 'X', pins: { bottom: ['A', null, 'B', { spacer: true }, 'C'] } })
    expect(m.pins.filter(isSpacer)).toHaveLength(2)
    expect(holes(m)).toHaveLength(3)
    expect(m.art!.shapes.filter((s) => s.fill === '#E0B43C')).toHaveLength(3)
  })

  it('draws a chip with the names past the pin tips and a pin 1 mark', () => {
    const m = moduleFromSpec({ name: 'NE555 timer', style: 'chip', pins: { bottom: ['GND', 'TRIG', 'OUT', 'RESET'], top: ['VCC', 'DIS', 'THR', 'CTRL'] } })
    expect(m.art!.pinLabels).toBe('tips')
    expect(m.art!.shapes[0].fill).toBe('#2B2F36')
    expect(holes(m)).toHaveLength(0)
    expect(validateModule(m).ok).toBe(true)
  })

  it('respects the 4000 px geometry cap', () => {
    const r = buildPart({ name: 'X', pins: { left: Array.from({ length: 450 }, (_, i) => `P${i}`) } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toContain(`${MODULE_PX_MAX} px`)
    expect(validateSpec({ name: 'X', body: { w: 401 }, pins: { left: ['A'] } }).ok).toBe(false)
  })

  it('reports every spec problem by path and never throws from buildPart', () => {
    const r = validateSpec({ name: '', colour: 'red', body: { color: 'green' }, pins: { middle: [], left: [{ name: 'A', type: 'power' }, 3, ''] } })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toEqual(expect.arrayContaining([
      'colour: unknown field (allowed: format, name, id, category, source, description, uses, photo, version, style, body, art, pins, internal)',
      'name: required',
      'body.color: must be a colour like "#2F9E6E"',
      'pins.middle: unknown side (left, right, top or bottom)',
      'pins.left[0].type: must be one of power_in, power_out, ground, input, output, io, passive, nc',
      'pins.left[1]: must be a name, null (a gap) or { "name", "type"?, "supply"?, ... }',
      'pins.left[2]: a pin name may not be empty',
    ]))
    expect(validateSpec({ name: 'X', pins: {} }).ok).toBe(false)
    expect(buildPart(null).ok).toBe(false)
    expect(() => moduleFromSpec({ name: 'X' })).toThrow(/pins/)
    // Bad caps reach validateModule and come back as errors, not a throw.
    const caps = buildPart({ name: 'X', pins: { left: [{ name: 'A', caps: { inputOnly: true, outputOnly: true } }] } })
    expect(caps.ok).toBe(false)
  })

  it('carries a description and uses onto the part, trimmed, and back', () => {
    const m = moduleFromSpec({ ...INA, description: ' Measures current. ', uses: [' battery monitor ', 'solar logger'] })
    expect(m).toMatchObject({ description: 'Measures current.', uses: ['battery monitor', 'solar logger'] })
    expect(specFromModule(m)).toMatchObject({ description: 'Measures current.', uses: ['battery monitor', 'solar logger'] })
    expect(unmodeled(m)).toEqual([])
    expect(validateSpec({ ...INA, description: 7, uses: 'x' }).ok).toBe(false)
  })

  it('reads its own module back as a spec that rebuilds it exactly', () => {
    for (const spec of [INA, { ...INA, style: 'chip' as const, body: { color: '#1E4F8A' } }, { name: 'Sized', body: { w: 30, h: 12 }, pins: { top: ['A', null, 'B'] } }]) {
      const m = moduleFromSpec(spec)
      expect(moduleFromSpec(specFromModule(m))).toEqual(m)
    }
  })

  it('cuts a long name for the plate', () => {
    expect(plateText('ESP32 DevKit V1 (30 pin, DOIT)')).toBe('ESP32 DevKit V1')
    expect(plateText('An extraordinarily long part name here').length).toBeLessThanOrEqual(22)
  })
})

describe('lintModule', () => {
  const base = () => moduleFromSpec(INA)
  const codes = (r: ReturnType<typeof lintModule>) => ({ errors: r.errors.map((e) => e.code), warnings: r.warnings.map((w) => w.code) })

  it('reports duplicate pin names as their own error', () => {
    const m = base()
    ;(m.pins[1] as PinDef).name = 'VCC'
    const r = lintModule(m)
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toMatchObject({ code: 'duplicate-pin', pin: 'VCC' })
  })

  it('reports validation errors', () => {
    expect(codes(lintModule({ format: 'circuitoon-module/1', id: 'Bad Id', name: 'x', pins: [] })).errors).toEqual(['invalid', 'invalid'])
    expect(lintModule('nope').ok).toBe(false)
  })

  it('catches impossible capabilities', () => {
    const m = base()
    ;(m.pins[2] as PinDef).caps = { outputOnly: true } // SCL is typed input
    ;(m.pins[3] as PinDef).type = 'output'
    ;(m.pins[3] as PinDef).caps = { inputOnly: true }
    expect(codes(lintModule(m)).errors).toEqual(['type-caps', 'type-caps'])
    const both = base()
    ;(both.pins[3] as PinDef).caps = { inputOnly: true, outputOnly: true }
    expect(lintModule(both).errors[0].message).toContain('both inputOnly and outputOnly')
    const power = base()
    ;(power.pins[0] as PinDef).caps = { strapping: 'high' }
    expect(codes(lintModule(power)).warnings).toContain('caps-on-power')
  })

  it('warns about power pins without a type or a supply, and supplies it cannot read', () => {
    const m = moduleFromSpec({ name: 'X', source: 'https://example.com/a', pins: { left: ['VCC', 'GND', { name: 'VIN', type: 'power_in' }, { name: 'V5', type: 'power_in', supply: 'FIVE' }, { name: 'G', type: 'ground', supply: '5V' }] } })
    const r = lintModule(m)
    expect(r.ok).toBe(true)
    expect(r.warnings.map((w) => `${w.code}:${w.pin}`)).toEqual(['power-untyped:VCC', 'power-untyped:GND', 'power-no-supply:VIN', 'supply-unknown:V5', 'ground-supply:G'])
    expect(r.warnings[1].message).toContain('Set it to ground')
  })

  it('warns about a part with no types, no source, or not marked custom', () => {
    const m = moduleFromSpec({ name: 'X', pins: { left: ['A', 'B'] } })
    expect(codes(lintModule(m)).warnings).toEqual(['no-types', 'no-source'])
    const lib = builtinModules().find((x) => x.id === 'resistor')!
    expect(codes(lintModule(lib)).warnings).toContain('not-custom')
    expect(codes(lintModule({ ...base(), source: 'see the datasheet' })).warnings).toEqual(['source-not-url'])
  })

  it('finds art that does not match the pins', () => {
    const moved = base()
    const hole = moved.art!.shapes.find((s) => s.fill === HOLE_FILL)!
    hole.y += 5
    expect(codes(lintModule(moved)).errors).toEqual(['art-pins'])
    const small = base()
    small.art = { ...small.art!, w: 40, h: 30 }
    small.size = undefined
    small.pins.push(...Array.from({ length: 6 }, (_, i) => ({ name: `X${i}`, side: 'left' as const, type: 'io' as const })))
    expect(codes(lintModule(small)).warnings).toContain('art-pins')
  })

  it('passes every built-in part apart from the custom marking', () => {
    for (const m of builtinModules()) expect(lintModule(m).errors, m.id).toEqual([])
  })
})

describe('custom marking in the module format', () => {
  it('accepts custom: true only with a custom- id', () => {
    const m = moduleFromSpec(INA)
    expect(validateModule({ ...m, custom: false }).ok).toBe(false)
    const r = validateModule({ ...m, id: 'ina219' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual(['custom: a custom part\'s id must start with "custom-"'])
  })
  it('is never set on a built-in part', () => {
    for (const m of builtinModules()) {
      expect(m.custom, m.id).toBeUndefined()
      expect(m.id.startsWith('custom-'), m.id).toBe(false)
    }
  })
})

describe('parsePinLines', () => {
  it('reads a number, a name, a type and a supply, in any separator', () => {
    const r = parsePinLines('1 VCC power 3v3\n2, GND, ground\n3\tSDA\tio\nSCL | in\n5; OUT; output')
    expect(r.errors).toEqual([])
    expect(r.pins.map((p) => p.pin)).toEqual([
      { name: 'VCC', type: 'power_in', supply: '3V3' },
      { name: 'GND', type: 'ground' },
      { name: 'SDA', type: 'io' },
      { name: 'SCL', type: 'input' },
      { name: 'OUT', type: 'output' },
    ])
  })
  it('takes a bare name and never guesses its type', () => {
    expect(parsePinLines('GND').pins).toEqual([{ side: 'left', pin: { name: 'GND' } }])
  })
  it('switches sides on a side line and skips blanks, comments and a header row', () => {
    const r = parsePinLines('Pin Name Type\n# the left header\nVCC\n\nright:\n  # indented comment\nA0\nTop\nB', 'left')
    expect(r.errors).toEqual([])
    expect(r.pins.map((p) => `${p.side}:${p.pin.name}`)).toEqual(['left:VCC', 'right:A0', 'top:B'])
    expect(parsePinLines('X', 'bottom').pins[0].side).toBe('bottom')
  })
  it('reports a line it cannot read by number and leaves it out', () => {
    const r = parsePinLines('VCC\nGPIO4 sometimes')
    expect(r.pins).toHaveLength(1)
    expect(r.errors).toEqual(['Line 2: "sometimes" is not a pin type or a supply voltage (types: power, power_out, ground, in, out, io, passive, nc; supplies like 3V3 or 5V).'])
  })
  it('keeps punctuation in pin names: only a line starting with # is a comment', () => {
    const r = parsePinLines('2 RESET# input\n3 #CS in\n4 -\n5 V- ground\n6 IN-')
    expect(r.errors).toEqual([])
    expect(r.pins.map((p) => p.pin)).toEqual([
      { name: 'RESET#', type: 'input' },
      { name: '#CS', type: 'input' },
      { name: '-' },
      { name: 'V-', type: 'ground' },
      { name: 'IN-' },
    ])
  })
  it('rejects an ambiguous line instead of rewriting it', () => {
    const r = parsePinLines('1 - ground\nA0 # analog\nOK')
    expect(r.pins.map((p) => p.pin)).toEqual([{ name: 'OK' }])
    expect(r.errors).toEqual([
      'Line 1: a lone "-" could be a pin named "-" or a separator. Write the pin name right after the number (for example "1 GND ground"), or "1 -" alone for a pin named "-".',
      'Line 2: "#" is not a pin type or a supply voltage (types: power, power_out, ground, in, out, io, passive, nc; supplies like 3V3 or 5V).',
    ])
  })
  it('reads a pin number written as "pin 3" or "3." and a power_out with a split supply', () => {
    expect(parsePinLines('pin 3 VOUT power_out 3V3/5V\n4. EN in').pins.map((p) => p.pin)).toEqual([
      { name: 'VOUT', type: 'power_out', supply: '3V3/5V' },
      { name: 'EN', type: 'input' },
    ])
  })
})

describe('limits', () => {
  const huge = 150_000
  it('rejects an oversized pin list before building, instead of overflowing the stack', () => {
    const r = buildPart({ name: 'Huge', pins: { left: Array.from({ length: huge }, (_, i) => `P${i}`) } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/pins\.left: at most 398 pins and gaps a side/)
    expect(buildPart({ name: 'Gaps', pins: { top: ['A', ...Array(huge).fill(null)] } }).ok).toBe(false)
    expect(buildPart({ name: 'Max', pins: { left: Array.from({ length: 398 }, (_, i) => `${i}`) } }).ok).toBe(true)
    expect(validateSpec({ name: 'Long', pins: { left: ['x'.repeat(61)] } })).toMatchObject({ ok: false, errors: expect.arrayContaining(['pins.left[0]: a pin name is at most 60 characters']) })
  })
  it('refuses an oversized paste with one error, never parsing it', () => {
    const r = parsePinLines(Array.from({ length: huge }, (_, i) => `${i} P${i} io`).join('\n'))
    expect(r.pins).toEqual([])
    expect(r.errors).toEqual([expect.stringMatching(/too long to paste/)])
    expect(parsePinLines('A\n'.repeat(1592)).pins).toHaveLength(1592)
  })
  it('a validated module with many pins measures without spreading them as arguments', () => {
    const m = { format: 'circuitoon-module/1', id: 'x', name: 'x', art: { w: 10, h: 10, pinLabels: 'tips', shapes: [] }, pins: Array.from({ length: huge }, (_, i) => ({ name: `P${i}`, side: 'left' })) } as unknown as ModuleDef
    expect(() => validateModule(m)).not.toThrow()
    expect(validateModule(m).ok).toBe(false)
    expect(pinRoom(m)).toBe(8 + 2 + Math.ceil(7 * 4.5 + 3))
  })
})

describe('small custom parts', () => {
  it('a one- or two-pin part draws every pin name, in both styles', () => {
    for (const style of ['board', 'chip'] as const)
      for (const names of [['SDA', 'SCL'], ['OUT']]) {
        const m = moduleFromSpec({ name: 'Tiny', style, pins: { left: names } })
        const svg = renderToStaticMarkup(createElement('svg', null, createElement(Part, { module: m })))
        for (const n of names) expect(svg, `${style} ${n}`).toContain(`>${n}</text>`)
      }
  })
  it('the labels are explicit but never stick to a renamed pin when edited', () => {
    const m = moduleFromSpec({ name: 'Tiny', pins: { left: ['SDA', { name: 'GND 2', label: 'GND' }] } })
    expect(m.pins).toMatchObject([{ name: 'SDA', label: 'SDA' }, { name: 'GND 2', label: 'GND' }])
    expect(specFromModule(m).pins.left).toEqual([{ name: 'SDA' }, { name: 'GND 2', label: 'GND' }])
    expect(moduleFromSpec(specFromModule(m))).toEqual(m)
  })
})

describe('unmodeled', () => {
  it('a part saved before pin labels were explicit still edits fully', () => {
    const m = moduleFromSpec({ name: 'Old', pins: { left: ['SDA', 'SCL', 'GND'] } })
    const old = { ...m, pins: m.pins.map((p) => (isSpacer(p) ? p : { name: p.name, side: p.side })) }
    expect(unmodeled(old)).toEqual([])
  })
})
