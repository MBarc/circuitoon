import { describe, expect, it } from 'vitest'
import { cleanBaseName, defaultBaseName, exportFileName, readDiagramFile, saveWithPicker } from './files.ts'
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

describe('cleanBaseName', () => {
  it('strips characters Windows and macOS refuse, and control characters', () => {
    expect(cleanBaseName('a\\b/c:d*e?f"g<h>i|j')).toBe('abcdefghij')
    expect(cleanBaseName('tab\there\u0000\u001f\u007fend')).toBe('tabhereend')
  })
  it('trims, and drops trailing dots that Windows would drop anyway', () => {
    expect(cleanBaseName('  Night light  ')).toBe('Night light')
    expect(cleanBaseName('draft...')).toBe('draft')
  })
  it('drops a typed .circuitoon.json or .json suffix, so the name never doubles it', () => {
    expect(cleanBaseName('lamp.circuitoon.json')).toBe('lamp')
    expect(cleanBaseName('lamp.CIRCUITOON.JSON')).toBe('lamp')
    expect(cleanBaseName('lamp.json')).toBe('lamp')
    expect(cleanBaseName('v1.2 lamp')).toBe('v1.2 lamp')
  })
  it('falls back to "circuitoon" when nothing is left', () => {
    expect(cleanBaseName('')).toBe('circuitoon')
    expect(cleanBaseName('  ')).toBe('circuitoon')
    expect(cleanBaseName('***')).toBe('circuitoon')
    expect(cleanBaseName('.circuitoon.json')).toBe('circuitoon')
  })
})

describe('defaultBaseName', () => {
  it('comes from the title, like the exported file name, without the suffix', () => {
    expect(defaultBaseName('LED: blink/test')).toBe('LED- blink-test')
    expect(defaultBaseName('  ')).toBe('Untitled sheet')
  })
  it('offers the name last chosen for this sheet instead', () => {
    expect(defaultBaseName('Night light', 'bench copy')).toBe('bench copy')
    expect(defaultBaseName('Night light', null)).toBe('Night light')
  })
})

describe('saveWithPicker', () => {
  type Opts = { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }
  const fakePicker = (name: string) => {
    const calls: Opts[] = []
    const written: string[] = []
    const picker = async (opts: Opts) => {
      calls.push(opts)
      return { name, createWritable: async () => ({ write: async (t: string) => void written.push(t), close: async () => {} }) }
    }
    return { picker, calls, written }
  }
  it('suggests the name with the .circuitoon.json type and writes through the handle', async () => {
    const f = fakePicker('bench.circuitoon.json')
    const r = await saveWithPicker(f.picker, 'Night light', '{"x":1}')
    expect(r).toEqual({ status: 'saved', base: 'bench' })
    expect(f.calls[0].suggestedName).toBe('Night light.circuitoon.json')
    expect(f.calls[0].types[0].accept).toEqual({ 'application/json': ['.circuitoon.json'] })
    expect(f.written).toEqual(['{"x":1}'])
  })
  it('retries with plain .json when the browser refuses the two-part extension', async () => {
    const f = fakePicker('a.json')
    let first = true
    const picky = async (opts: Opts) => {
      if (first) {
        first = false
        throw new TypeError('bad extension')
      }
      return f.picker(opts)
    }
    expect(await saveWithPicker(picky, 'a', 't')).toEqual({ status: 'saved', base: 'a' })
    expect(f.calls[0].types[0].accept).toEqual({ 'application/json': ['.json'] })
  })
  it('does nothing when the user cancels', async () => {
    const abort = async () => {
      throw new DOMException('The user aborted a request.', 'AbortError')
    }
    expect(await saveWithPicker(abort, 'a', 't')).toEqual({ status: 'cancelled' })
  })
  it('reports a picker it cannot use as unavailable, so the in-app dialog opens instead', async () => {
    const denied = async () => {
      throw new DOMException('Not allowed', 'SecurityError')
    }
    expect(await saveWithPicker(denied, 'a', 't')).toEqual({ status: 'unavailable' })
  })
  it('reports a failed write with a message', async () => {
    const broken = async () => ({ name: 'a.circuitoon.json', createWritable: async () => ({ write: async () => { throw new Error('disk full') }, close: async () => {} }) })
    expect(await saveWithPicker(broken, 'a', 't')).toEqual({ status: 'failed', message: 'a.circuitoon.json could not be saved: disk full' })
  })
})

describe('cleanBaseName limits', () => {
  it('caps the name at 120 characters, dropping a trailing space or dot the cut leaves', () => {
    expect(cleanBaseName('a'.repeat(300))).toBe('a'.repeat(120))
    expect(cleanBaseName(`${'b'.repeat(119)} tail`)).toBe('b'.repeat(119))
  })
  it('prefixes Windows reserved device names, in any case, with an underscore', () => {
    for (const name of ['CON', 'prn', 'Aux', 'nul', 'COM1', 'com9', 'LPT1', 'lpt9', 'con.backup'])
      expect(cleanBaseName(name)).toBe(`_${name}`)
    for (const name of ['CONSOLE', 'COM10', 'LPT0', 'my con', 'aux2'])
      expect(cleanBaseName(name)).toBe(name)
  })
})

describe('defaultBaseName limits', () => {
  it('offers a title-based name already made safe: capped, device names prefixed', () => {
    expect(defaultBaseName('x'.repeat(200))).toBe('x'.repeat(120))
    expect(defaultBaseName('nul')).toBe('_nul')
  })
})
