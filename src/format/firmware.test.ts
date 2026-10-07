// Firmware spec 3.2: modules declare `firmware: { languages }` (known ids only, ruling R2); the
// library's firmware and sim reach a stored copy with the same id and terminals (withLibraryData);
// a custom part accepts no language in this slice; code a board does not accept is kept and warned about.
import { describe, expect, it } from 'vitest'
import { load } from './builtinModules.testing.ts'
import { DIAGRAM_FORMAT, validateDiagram } from './diagram.ts'
import { type ModuleDef, validateModule } from './module.ts'
import { withLibraryData } from './simModel.ts'
import { languagesOf } from './code.ts'
import { lintModule } from './partMaker.ts'
import { libraryLookup } from '../agent/catalog.ts'

const pi = () => load('rpi-4-model-b')

describe('module firmware (spec 3.2)', () => {
  it('gives the three Pis python-rpi and nothing else a language', () => {
    for (const id of ['rpi-4-model-b', 'rpi-5', 'rpi-zero-2-w']) expect(languagesOf(load(id)), id).toEqual(['python-rpi'])
    expect(languagesOf(load('arduino-uno-r3'))).toEqual([])
    expect(languagesOf(load('rpi-pico'))).toEqual([])
  })
  it('accepts only known language ids', () => {
    const bad = (firmware: unknown) => validateModule({ ...pi(), firmware })
    expect(bad({ languages: ['arduino-avr'] }).ok).toBe(true)
    expect(bad({ languages: ['cobol'] })).toEqual({ ok: false, errors: ['firmware.languages[0]: unknown language "cobol" (python-rpi, arduino-avr, micropython)'] })
    expect(bad({ languages: [] })).toEqual({ ok: false, errors: ['firmware: must be { "languages": [<language id>, ...] }'] })
    expect(bad({ langs: ['python-rpi'] }).ok).toBe(false)
  })
  it('carries the library firmware and sim to an old stored copy, and returns a matching copy unchanged', () => {
    const lib = pi()
    const old = JSON.parse(JSON.stringify(lib)) as ModuleDef
    delete old.firmware
    const data = withLibraryData(old, () => lib)
    expect(languagesOf(data)).toEqual(['python-rpi'])
    expect(withLibraryData(lib, () => lib)).toBe(lib)
    const gone = old.pins.findIndex((p) => 'name' in p && p.type !== 'usb') // slice(1) would drop a USB port, which the terminals leave out
    const moved = { ...old, pins: old.pins.filter((_, i) => i !== gone) }
    expect(withLibraryData(moved, () => lib)).toBe(moved)
  })
  it('gives a custom part no language, and the part check says so', () => {
    const custom = { ...pi(), id: 'custom-my-pi', custom: true as const }
    expect(languagesOf(custom)).toEqual([])
    expect(withLibraryData(custom, libraryLookup)).toBe(custom)
    expect(lintModule(custom).warnings).toContainEqual({ code: 'firmware-custom', message: 'Code on custom parts is not supported yet, so this part\'s "firmware" is ignored.' })
  })
  it('keeps code a board does not accept, with a warning that names the board and the language', () => {
    const uno = load('arduino-uno-r3')
    const r = validateDiagram({
      format: DIAGRAM_FORMAT, title: 't', modules: { [uno.id]: uno }, connections: [],
      parts: [{ uid: 'u1', designator: 'U1', module: uno.id, x: 0, y: 0, code: { language: 'python-rpi', source: 'print(1)' } }],
    }, { library: libraryLookup })
    if (!r.ok) throw new Error(r.errors.join('; '))
    expect(r.diagram.parts[0].code?.language).toBe('python-rpi')
    expect(r.warnings).toContain("parts[0].code: U1 is an Arduino Uno R3; its code is Raspberry Pi Python and won't run")
  })
})
