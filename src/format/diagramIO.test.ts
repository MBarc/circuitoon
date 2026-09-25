import { describe, expect, it } from 'vitest'
import { computeRoutes, emptyDiagram, isValidColor, serializeDiagram, validateDiagram, wireColor, wirePaths, type Diagram } from './diagram.ts'
import { buttonLed } from '../samples/buttonLed.ts'

describe('validateDiagram', () => {
  it('accepts the sample sheet with no warnings', () => {
    const r = validateDiagram(JSON.parse(serializeDiagram(buttonLed)))
    expect(r).toEqual({ ok: true, diagram: buttonLed, warnings: [] })
  })
  it('round-trips document data exactly', () => {
    const r = validateDiagram(JSON.parse(serializeDiagram(buttonLed)))
    expect(r.ok && serializeDiagram(r.diagram)).toBe(serializeDiagram(buttonLed))
  })
  it('refuses unknown formats and duplicate uids, naming the path', () => {
    const bad = { ...structuredClone(buttonLed), format: 'circuitoon-diagram/9' } as unknown as Diagram
    bad.connections[1].uid = 'p1'
    const r = validateDiagram(bad)
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.errors).toEqual([
        'format: unsupported "circuitoon-diagram/9" (expected "circuitoon-diagram/1")',
        'connections[1].uid: duplicate "p1"',
      ])
  })
  it('loads connections to missing pins, with a warning', () => {
    const d = structuredClone(buttonLed)
    d.connections[0].to.pin = 'nope'
    const r = validateDiagram(d)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings).toEqual(['connections[0].to: part "p2" has no pin "nope"'])
  })
  it('refuses non-string wire labels and annotation text', () => {
    const d = structuredClone(buttonLed) as unknown as { connections: Record<string, unknown>[]; annotations?: unknown[] }
    d.connections[0].label = { a: 1 }
    d.annotations = [{ uid: 'a1', type: 'text', x: 0, y: 0, text: 5, label: [] }]
    const r = validateDiagram(d)
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.errors).toEqual([
        'connections[0].label: must be a string',
        'annotations[0].label: must be a string',
        'annotations[0].text: must be a string',
      ])
  })
  it('warns (and still loads) when a route has a step that is neither horizontal nor vertical', () => {
    const d = structuredClone(buttonLed)
    d.connections[1].route = [[100, 20], [100, 60], [140, 90], [140, 120]]
    const r = validateDiagram(d)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings).toEqual(['connections[1].route[2]: diagonal step from route[1] (each step should be horizontal or vertical)'])
  })
  it('requires parts[i].values to be an object when present', () => {
    const d = structuredClone(buttonLed) as unknown as { parts: Record<string, unknown>[] }
    d.parts[0].values = 7
    const r = validateDiagram(d)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual(['parts[0].values: must be an object'])
  })
  it('warns when a value-shaped entry is missing a finite number value or string unit', () => {
    const d = structuredClone(buttonLed) as unknown as { parts: Record<string, unknown>[] }
    ;(d.parts[2].values as Record<string, unknown>).resistance = 'lots'
    const r = validateDiagram(d)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings).toEqual(['parts[2].values.resistance: value must be a finite number with a string unit'])
  })
  it('does not warn about a value-less entry that is not a known value param, such as an LED color', () => {
    const r = validateDiagram(JSON.parse(serializeDiagram(buttonLed)))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings).toEqual([])
  })
  it('checks wire color and gauge', () => {
    const d = structuredClone(buttonLed) as unknown as { connections: Record<string, unknown>[] }
    d.connections[0].color = 'chartreuse'
    d.connections[1].gauge = 40
    const r = validateDiagram(d)
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.errors.slice(-2)).toEqual([
        'connections[0].color: must be a named color or #RRGGBB',
        'connections[1].gauge: must be a whole number from 16 to 30',
      ])
  })
})

describe('prototype keys are plain names', () => {
  it('warns about a part whose module is "constructor" instead of throwing, and it still draws', () => {
    const d = structuredClone(buttonLed)
    d.parts[0].module = 'constructor'
    const r = validateDiagram(JSON.parse(serializeDiagram(d)))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.warnings).toContain('parts[0]: module "constructor" is not embedded in this file')
    expect(() => wirePaths(r.diagram, computeRoutes(r.diagram))).not.toThrow()
  })
  it('warns about a module named "toString" too', () => {
    const d = structuredClone(buttonLed)
    d.parts[1].module = 'toString'
    const r = validateDiagram(JSON.parse(serializeDiagram(d)))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings[0]).toBe('parts[1]: module "toString" is not embedded in this file')
  })
  it('does not treat Object prototype names as colors', () => {
    expect(isValidColor('constructor')).toBe(false)
    expect(isValidColor('toString')).toBe(false)
    expect(wireColor('constructor')).toBe(wireColor('black'))
  })
})

describe('helpers', () => {
  it('knows valid colors', () => {
    expect(isValidColor('Red')).toBe(true)
    expect(isValidColor('#a1B2c3')).toBe(true)
    expect(isValidColor('#abc')).toBe(false)
  })
  it('makes an empty sheet that validates', () => {
    expect(validateDiagram(emptyDiagram()).ok).toBe(true)
  })
})
