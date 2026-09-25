import { describe, expect, it } from 'vitest'
import { emptyDiagram, isValidColor, serializeDiagram, validateDiagram, type Diagram } from './diagram.ts'
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
