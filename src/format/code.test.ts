// Firmware spec 3.1: `code: { language, source, file? }` on a part. Wrong types or an oversized
// source drop the code with a warning naming the part; unknown keys inside code are dropped; a
// language this build does not know is kept with a warning; the format stays circuitoon-diagram/1;
// code counts against a link's 64K-character payload.
import { describe, expect, it } from 'vitest'
import { DIAGRAM_FORMAT, type Diagram, serializeDiagram, validateDiagram } from './diagram.ts'
import { diagramLink } from './link.ts'
import { SOURCE_MAX_BYTES, checkCode, fileProblem, utf8Bytes } from './code.ts'

const sheet = (code: unknown): Diagram => ({
  format: DIAGRAM_FORMAT, title: 't', modules: {}, connections: [],
  parts: [{ uid: 'u1', designator: 'U1', module: 'rpi-4-model-b', x: 0, y: 0, code } as Diagram['parts'][number]],
})
const load = (code: unknown) => {
  const r = validateDiagram(JSON.parse(JSON.stringify(sheet(code))))
  if (!r.ok) throw new Error(r.errors.join('; '))
  return { code: r.diagram.parts[0].code, warnings: r.warnings.filter((w) => w.includes('.code')) }
}

describe('checkCode', () => {
  it('keeps valid code as it is', () => {
    const c = { language: 'python-rpi', source: 'print(1)\n', file: 'blink.py' }
    expect(checkCode(c, 'U1')).toEqual({ code: c, warnings: [] })
    expect(checkCode(c, 'U1').code).toBe(c)
  })
  it('drops code with wrong types or an oversized source, naming the part', () => {
    for (const bad of [null, 'x', { language: 3, source: '' }, { language: 'python-rpi' }, { language: 'python-rpi', source: 7 }]) {
      const r = checkCode(bad, 'U1')
      expect(r.code).toBeNull()
      expect(r.warnings[0]).toMatch(/^U1's code was dropped: /)
    }
    // 256 KB counts UTF-8 bytes: a 3-byte character pushes a just-short string over.
    const big = `${'a'.repeat(SOURCE_MAX_BYTES - 2)}€`
    expect(utf8Bytes(big)).toBe(SOURCE_MAX_BYTES + 1)
    expect(checkCode({ language: 'python-rpi', source: big }, 'U1')).toEqual({ code: null, warnings: ["U1's code was dropped: its source is over 256 KB"] })
  })
  it('drops unknown keys inside code with a warning, and a bad file name only', () => {
    expect(checkCode({ language: 'python-rpi', source: 's', run: true }, 'U1')).toEqual({
      code: { language: 'python-rpi', source: 's' }, warnings: ["U1's code had keys this version does not know (run), which were dropped"],
    })
    expect(checkCode({ language: 'python-rpi', source: 's', file: 'a/b.py' }, 'U1')).toEqual({
      code: { language: 'python-rpi', source: 's' }, warnings: ["U1's code file name was dropped: it has a path separator"],
    })
    expect(fileProblem('x'.repeat(256))).toBe('it is over 255 characters')
    expect(fileProblem('main.py')).toBeNull()
  })
  it('keeps a language this build does not know, with a warning', () => {
    const r = checkCode({ language: 'lua', source: 's' }, 'U1')
    expect(r.code).toEqual({ language: 'lua', source: 's' })
    expect(r.warnings).toEqual(['U1\'s code is in "lua", which this version of Circuitoon does not know; it is kept but will not run'])
  })
})

describe('code in a sheet (spec 3.1)', () => {
  it('loads, saves and stays circuitoon-diagram/1', () => {
    const c = { language: 'python-rpi', source: 'from gpiozero import LED\n', file: 'blink.py' }
    const { code, warnings } = load(c)
    expect(code).toEqual(c)
    expect(warnings).toEqual([])
    const again = JSON.parse(serializeDiagram(sheet(c)))
    expect(again.format).toBe('circuitoon-diagram/1')
    expect(again.parts[0].code).toEqual(c)
  })
  it('drops bad code on load with a warning at the part', () => {
    const { code, warnings } = load({ language: 'python-rpi', source: 5 })
    expect(code).toBeUndefined()
    expect(warnings).toEqual(["parts[0].code: U1's code was dropped: its source must be text"])
  })
  it('counts code against the link payload (64K characters)', async () => {
    // Incompressible text: about 1.3 base64 characters per byte after deflate.
    let x = 1 // 32-bit LCG via Math.imul: x * 1103515245 overflows 2^53 and degenerates into compressible noise
    const noise = Array.from({ length: 120_000 }, () => String.fromCharCode(33 + (((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) >>> 16) % 90))).join('')
    const r = await diagramLink(sheet({ language: 'python-rpi', source: noise }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.limit.limit).toBe('chars')
  })
})
