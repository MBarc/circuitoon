// circuitoon link: a URL plus the notice; over a limit (64 KB of payload, 2,000 parts, 10,000
// connections: amendment A9), no link and the sheet written as a file; failures as one JSON error
// envelope under --json (amendment A10).
import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serializeDiagram, validateDiagram } from '../format/diagram.ts'
import { LINK_NOTICE, openLinkPayload, payloadFromHash } from '../format/link.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { cli, tempDir } from './cliHarness.testing.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { ledNetlist } from '../agent/fixtures.testing.ts'

const laidOut = async () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'n.json'), JSON.stringify(ledNetlist()))
  expect((await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })).code).toBe(0)
  return dir
}
/** One JSON error envelope on stdout, with its exit code and error code. */
const envelope = (r: { code: number; out: string }, exit: number, code: string, message: string) => {
  expect(r.code).toBe(exit)
  const out = JSON.parse(r.out)
  expect(schemaErrors(loadSchema('error'), out)).toEqual([])
  expect(out).toMatchObject({ format: 'circuitoon-cli/error/1', ok: false, exit, error: { code } })
  expect(out.error.message).toContain(message)
}

describe('circuitoon link', () => {
  it('prints a link and the notice', async () => {
    const dir = await laidOut()
    const r = await cli(['link', 'sheet.json', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    const out = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('link'), out)).toEqual([])
    expect(out).toMatchObject({ format: 'circuitoon-cli/link/1', ok: true, file: null, reason: null, notice: LINK_NOTICE })
    expect(out.url.startsWith('https://mbarc.github.io/circuitoon/#/editor?d=v1.')).toBe(true)
    expect(out.chars).toBe(payloadFromHash(new URL(out.url).hash)!.length)
    // The link opens the sheet as it is on disk.
    const opened = await openLinkPayload(payloadFromHash(new URL(out.url).hash)!)
    expect(opened.ok).toBe(true)
    if (opened.ok) expect(serializeDiagram(opened.diagram)).toBe(readFileSync(join(dir, 'sheet.json'), 'utf8'))
    const text = await cli(['link', 'sheet.json'], { cwd: dir })
    expect(text.out).toBe(`${out.url}\n${LINK_NOTICE}\n`)
  })
  it('refuses an oversized link and writes the sheet as a file to import instead', async () => {
    const dir = await laidOut()
    const sheet = JSON.parse(readFileSync(join(dir, 'sheet.json'), 'utf8'))
    sheet.annotations = Array.from({ length: 200 }, (_, i) => ({ uid: `n${i}`, type: 'text', x: 0, y: i * 40, text: randomBytes(360).toString('base64') }))
    writeFileSync(join(dir, 'sheet.json'), JSON.stringify(sheet))
    const r = await cli(['link', 'sheet.json', '-o', 'out', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    const out = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('link'), out)).toEqual([])
    expect(out).toMatchObject({ ok: false, url: null })
    expect(out.chars).toBeGreaterThan(65536)
    expect(out.reason).toBe(`The link would be ${out.chars.toLocaleString('en')} characters, more than the 65,536 a link may carry, so no link was made.`)
    expect(out.file).toBe(join('out', `${sheet.title}.circuitoon.json`))
    expect(existsSync(join(dir, out.file))).toBe(true)
    expect(validateDiagram(JSON.parse(readFileSync(join(dir, out.file), 'utf8'))).ok).toBe(true)
    const text = await cli(['link', 'sheet.json', '-o', 'out'], { cwd: dir })
    expect(text.code).toBe(0)
    expect(text.out).toBe(`${out.reason} Wrote ${out.file}: open it in Circuitoon with Import JSON.\n`)
  })
  it('falls back to a file for 2,001 parts, however short the link would be (A9)', async () => {
    const dir = tempDir()
    const d = {
      format: 'circuitoon-diagram/1', title: 'Many resistors', modules: { resistor: libraryLookup('resistor') },
      parts: Array.from({ length: 2001 }, (_, i) => ({ uid: `p${i}`, designator: `R${i + 1}`, module: 'resistor', x: (i % 50) * 100, y: Math.floor(i / 50) * 60 })),
      connections: [],
    }
    writeFileSync(join(dir, 'many.json'), JSON.stringify(d))
    const r = await cli(['link', 'many.json', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    const out = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('link'), out)).toEqual([])
    expect(out).toMatchObject({ ok: false, url: null, file: 'Many resistors.circuitoon.json' })
    expect(out.chars).toBeLessThan(65536)
    expect(out.reason).toBe('The sheet has 2,001 parts, more than the 2,000 a link may carry, so no link was made.')
    expect(validateDiagram(JSON.parse(readFileSync(join(dir, out.file), 'utf8'))).ok).toBe(true)
  })
  it('never overwrites the sheet itself: a sheet already named for import is the file', async () => {
    const dir = tempDir()
    const d = {
      format: 'circuitoon-diagram/1', title: 'Many', modules: { resistor: libraryLookup('resistor') },
      parts: Array.from({ length: 2001 }, (_, i) => ({ uid: `p${i}`, designator: `R${i + 1}`, module: 'resistor', x: (i % 50) * 100, y: Math.floor(i / 50) * 60 })),
      connections: [],
    }
    const text = JSON.stringify(d)
    writeFileSync(join(dir, 'Many.circuitoon.json'), text)
    const out = JSON.parse((await cli(['link', 'Many.circuitoon.json', '--json'], { cwd: dir })).out)
    expect(out).toMatchObject({ ok: false, file: 'Many.circuitoon.json' })
    expect(readFileSync(join(dir, 'Many.circuitoon.json'), 'utf8')).toBe(text)
  })
  it('reports failures as a JSON error envelope (A10)', async () => {
    const dir = await laidOut()
    envelope(await cli(['link', '--json'], { cwd: dir }), 2, 'input', 'link: give a sheet file')
    envelope(await cli(['link', 'missing.json', '--json'], { cwd: dir }), 2, 'input', 'missing.json: cannot read the file')
    writeFileSync(join(dir, 'n2.json'), JSON.stringify(ledNetlist()))
    envelope(await cli(['link', 'n2.json', '--json'], { cwd: dir }), 2, 'input', 'n2.json is not a Circuitoon sheet')
    envelope(await cli(['link', 'sheet.json', 'extra.json', '--json'], { cwd: dir }), 2, 'input', 'link: give one sheet file')
  })
})
