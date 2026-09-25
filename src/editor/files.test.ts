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

describe('exportFileName', () => {
  it('makes a safe file name from the title', () => {
    expect(exportFileName('LED: blink/test')).toBe('LED- blink-test.circuitoon.json')
    expect(exportFileName('  ')).toBe('Untitled sheet.circuitoon.json')
  })
})
