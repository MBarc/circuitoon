// The diagram and module fields the agent toolkit adds: `intent` and `routing` survive a load and a
// save, annotations are validated (types, finite coordinates, bounded text), and pins and header
// pads may declare how many wire ends they take.
import { describe, expect, it } from 'vitest'
import { ANNOTATION_LABEL_MAX, ANNOTATION_TEXT_MAX, serializeDiagram, validateDiagram } from './diagram.ts'
import { terminalCapacity, validateModule } from './module.ts'
import { buttonLed } from '../samples/buttonLed.ts'

type Raw = Record<string, unknown> & { connections: Record<string, unknown>[] }
const base = () => structuredClone(buttonLed) as unknown as Raw

describe('diagram fields for the agent toolkit', () => {
  it('keeps intent and routing flags through a load and a save', () => {
    const d = base()
    d.intent = { format: 'circuitoon-netlist/1', title: 't', parts: [], nets: [] }
    d.connections[0].routing = true
    const r = validateDiagram(d)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const again = JSON.parse(serializeDiagram(r.diagram))
    expect(again.intent).toEqual(d.intent)
    expect(again.connections[0].routing).toBe(true)
  })
  it('refuses a routing flag that is not a boolean and an intent that is not an object', () => {
    const d = base()
    d.intent = 'netlist'
    d.connections[0].routing = 'yes'
    const r = validateDiagram(d)
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.errors).toEqual([
        'connections[0].routing: must be true or false',
        'intent: must be an object (a circuitoon-netlist/1 document)',
      ])
  })
  it('accepts frames and text notes with finite coordinates and bounded text', () => {
    const d = base()
    d.annotations = [
      { uid: 'a1', type: 'frame', x: 0, y: 0, w: 200, h: 100, label: 'Power' },
      { uid: 'a2', type: 'text', x: 10, y: 120, text: 'Tilt switches go in the balls.' },
    ]
    expect(validateDiagram(d).ok).toBe(true)
  })
  it('refuses unknown types, bad coordinates, empty frames, overlong text and a note without text', () => {
    const d = base()
    d.annotations = [
      { uid: 'a1', type: 'arrow', x: 0, y: 0 },
      { uid: 'a2', type: 'frame', x: Infinity, y: 0, w: 0, h: 10 },
      { uid: 'a3', type: 'text', x: 0, y: 1e9, text: 'x'.repeat(ANNOTATION_TEXT_MAX + 1) },
      { uid: 'a4', type: 'frame', x: 0, y: 0, w: 10, h: 10, label: 'y'.repeat(ANNOTATION_LABEL_MAX + 1) },
      { uid: 'a5', type: 'text', x: 0, y: 0 },
    ]
    const r = validateDiagram(d)
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.errors).toEqual([
        'annotations[0].type: must be "frame" or "text"',
        'annotations[1]: x and y must be numbers within +-100000',
        'annotations[1].w: must be a number above 0, at most 200000',
        'annotations[2]: x and y must be numbers within +-100000',
        `annotations[2].text: at most ${ANNOTATION_TEXT_MAX} characters`,
        `annotations[3].label: at most ${ANNOTATION_LABEL_MAX} characters`,
        'annotations[4].text: required on a text note',
      ])
  })
})

describe('terminal capacity', () => {
  const mod = (extra: Record<string, unknown> = {}) => ({ format: 'circuitoon-module/1', id: 'blk', name: 'Block', pins: [{ name: 'A', side: 'left' }], ...extra })
  it('defaults every pin and pad to one wire end', () => {
    const r = validateModule(mod({ holes: [{ name: 'P', at: [[10, 10]], holeStyle: 'pad' }] }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(terminalCapacity(r.module, 'A')).toBe(1)
    expect(terminalCapacity(r.module, 'P')).toBe(1)
  })
  it('takes a declared capacity on a pin and on a header pad', () => {
    const r = validateModule(mod({ pins: [{ name: 'A', side: 'left', capacity: 2 }], holes: [{ name: 'P', at: [[10, 10]], holeStyle: 'pad', capacity: 3 }] }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(terminalCapacity(r.module, 'A')).toBe(2)
    expect(terminalCapacity(r.module, 'P')).toBe(3)
  })
  it('refuses a capacity outside 1 to 8, and one on a breadboard hole group', () => {
    const r = validateModule(mod({ pins: [{ name: 'A', side: 'left', capacity: 0 }], holes: [{ name: 'S', at: [[10, 10]], capacity: 2 }] }))
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.errors).toEqual([
        'pins[0].capacity: must be a whole number from 1 to 8',
        'holes[0].capacity: only pins and header pads (holeStyle "pad") take a capacity',
      ])
  })
})
