import { describe, expect, it } from 'vitest'
import { exportFileName, readDiagramFile } from './files.ts'
import { serializeDiagram } from '../format/diagram.ts'
import { buttonLed } from '../samples/buttonLed.ts'

const file = (name: string, text: string) => new File([text], name, { type: 'application/json' })

describe('readDiagramFile', () => {
  it('opens a valid diagram', async () => {
    const r = await readDiagramFile(file('led.circuitoon.json', serializeDiagram(buttonLed)))
    expect(r).toEqual({ ok: true, diagram: buttonLed, warnings: [] })
  })
  it('explains a file that is not JSON', async () => {
    expect(await readDiagramFile(file('notes.json', 'hello'))).toEqual({ ok: false, message: 'notes.json is not valid JSON, so nothing was opened.' })
  })
  it('explains a JSON file that is not a diagram', async () => {
    const r = await readDiagramFile(file('module.json', '{}'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/^module\.json is not a Circuitoon diagram: format: missing/)
  })
})

describe('readDiagramFile never rejects', () => {
  it('opens a part with module "constructor" with a warning', async () => {
    const d = structuredClone(buttonLed)
    d.parts[0].module = 'constructor'
    const r = await readDiagramFile(file('proto.json', serializeDiagram(d)))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings[0]).toMatch(/module "constructor" is not embedded/)
  })
  it('turns an unexpected throw during validation into a message', async () => {
    // A getter that throws stands in for any bug inside validateDiagram.
    const bad = new File(['{}'], 'boom.json')
    Object.defineProperty(bad, 'text', { value: async () => '{"format": "circuitoon-diagram/1", "title": "t", "modules": {"x": {"format": "circuitoon-module/1", "id": "x", "name": "X", "pins": [{"name": "A", "side": "left"}]}}, "parts": [{"uid": "p1", "designator": "X1", "module": "x", "x": 0, "y": 0}], "connections": [{"uid": "w1", "from": {"part": "p1", "pin": "A"}, "to": {"part": "p1", "pin": "A"}}]}' })
    const realSome = Array.prototype.some
    Array.prototype.some = function () {
      throw new Error('kaboom')
    }
    try {
      await expect(readDiagramFile(bad)).resolves.toEqual({ ok: false, message: 'boom.json could not be read: kaboom' })
    } finally {
      Array.prototype.some = realSome
    }
  })
})

describe('readDiagramFile size limit', () => {
  it('refuses files over 5 MB without reading them', async () => {
    const big = new File(['x'], 'huge.json')
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 })
    Object.defineProperty(big, 'text', { value: () => Promise.reject(new Error('should not read')) })
    expect(await readDiagramFile(big)).toEqual({ ok: false, message: 'huge.json is larger than 5 MB, so it was not opened.' })
  })
  it('still opens a file of exactly 5 MB or less', async () => {
    const r = await readDiagramFile(file('led.circuitoon.json', serializeDiagram(buttonLed)))
    expect(r.ok).toBe(true)
  })
})

describe('exportFileName', () => {
  it('makes a safe file name from the title', () => {
    expect(exportFileName('LED: blink/test')).toBe('LED- blink-test.circuitoon.json')
    expect(exportFileName('  ')).toBe('Untitled sheet.circuitoon.json')
  })
})
