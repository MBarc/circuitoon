// circuitoon verify and check: exit codes, stable finding ids, JSON schema, the not-checked list,
// check working on a sheet without an intent, and the --json error envelope (amendment A10).
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NO_INTENT } from '../agent/verify.ts'
import { NOT_CHECKED } from '../agent/notChecked.ts'
import { cli, tempDir } from './cliHarness.testing.ts'
import { READABILITY_RULES } from '../agent/readabilityWarnings.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { ledNetlist } from '../agent/fixtures.testing.ts'
import { validateDiagram } from '../format/diagram.ts'
import { coveredHoles, holeKey, plugsOf, takenHoles } from '../format/breadboard.ts'
import { type CliFinding, cliFinding, findingsText, notCheckedText, uniqueIds } from './verifyCmd.ts'

const laidOut = async () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'n.json'), JSON.stringify(ledNetlist()))
  expect((await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })).code).toBe(0)
  return dir
}
const edit = (dir: string, change: (sheet: Record<string, unknown> & { connections: Record<string, unknown>[] }) => void) => {
  const sheet = JSON.parse(readFileSync(join(dir, 'sheet.json'), 'utf8'))
  change(sheet)
  writeFileSync(join(dir, 'sheet.json'), JSON.stringify(sheet))
}
/** A second wire on the battery's header pin: a capacity error for verify. */
const doubleWire = (dir: string) =>
  edit(dir, (s) => {
    const bt = (s.parts as { uid: string; designator: string }[]).find((p) => p.designator === 'BT1')!
    const w = s.connections.find((c) => (c.from as { part: string }).part === bt.uid)!
    s.connections.push({ ...w, uid: 'hand' })
  })

describe('circuitoon verify and check', () => {
  it('passes a laid-out sheet, with JSON matching the schema and the not-checked list', async () => {
    const dir = await laidOut()
    const v = await cli(['verify', 'sheet.json', '--json'], { cwd: dir })
    expect(v.code).toBe(0)
    const out = JSON.parse(v.out)
    expect(schemaErrors(loadSchema('findings'), out)).toEqual([])
    expect(out).toMatchObject({ format: 'circuitoon-cli/verify/1', ok: true, findings: [] })
    expect(out.notChecked.join(' ')).toContain('SPI bus conflicts')
    const c = await cli(['check', 'sheet.json', '--json'], { cwd: dir })
    expect(c.code).toBe(0)
    const cout = JSON.parse(c.out)
    expect(schemaErrors(loadSchema('findings'), cout)).toEqual([])
    expect(cout).toMatchObject({ format: 'circuitoon-cli/check/1', ok: true })
    const text = await cli(['verify', 'sheet.json'], { cwd: dir })
    expect(text.code).toBe(0)
    expect(text.out).toContain('No findings.')
    expect(text.out).toContain('Not checked:')
    expect((await cli(['check', 'sheet.json'], { cwd: dir })).out).toContain('Not checked:')
  })

  it('blocks a second wire on a header pin (exit 1) with a stable id', async () => {
    const dir = await laidOut()
    doubleWire(dir)
    const a = await cli(['verify', 'sheet.json', '--json'], { cwd: dir })
    const b = await cli(['verify', 'sheet.json', '--json'], { cwd: dir })
    expect(a.code).toBe(1)
    const out = JSON.parse(a.out)
    expect(schemaErrors(loadSchema('findings'), out)).toEqual([])
    expect(out.ok).toBe(false)
    const ids = out.findings.map((f: { id: string }) => f.id)
    expect(ids.some((id: string) => id.startsWith('capacity|'))).toBe(true)
    expect(JSON.parse(b.out).findings.map((f: { id: string }) => f.id)).toEqual(ids)
    const c = await cli(['check', 'sheet.json', '--json'], { cwd: dir })
    expect(c.code).toBe(1)
    const cids = JSON.parse(c.out).findings.map((f: { id: string }) => f.id)
    expect(cids.some((id: string) => id.startsWith('capacity|'))).toBe(true)
    expect(new Set(cids).size).toBe(cids.length)
    const text = await cli(['verify', 'sheet.json'], { cwd: dir })
    expect(text.code).toBe(1)
    expect(text.out).toMatch(/^ERROR capacity: /m)
    expect(text.out).toContain('Not checked:')
  })

  it("blocks a wire end under R1's body in verify and check, reported once by check", async () => {
    const dir = await laidOut()
    edit(dir, (s) => {
      const r = validateDiagram(s)
      if (!r.ok) throw new Error(r.errors.join('; '))
      const c = coveredHoles(r.diagram).find((h) => r.diagram.parts.find((p) => p.uid === h.by)!.designator === 'R1')!
      const w = s.connections.find((x) => (x.to as { hole?: number }).hole !== undefined)!
      w.to = { part: c.board, pin: c.group, hole: c.hole }
    })
    const v = await cli(['verify', 'sheet.json', '--json'], { cwd: dir })
    expect(v.code).toBe(1)
    expect(JSON.parse(v.out).findings.filter((f: CliFinding) => f.rule === 'covered-hole').map((f: CliFinding) => f.message)).toEqual([expect.stringMatching(/, under R1's body: /)])
    const c = await cli(['check', 'sheet.json', '--json'], { cwd: dir })
    expect(c.code).toBe(1)
    expect(JSON.parse(c.out).findings.filter((f: CliFinding) => f.rule === 'covered-hole')).toHaveLength(1)
  })

  it('reports two wire ends in one breadboard hole once in check: hole-shared, not also capacity', async () => {
    const dir = await laidOut()
    edit(dir, (s) => {
      // A second wire from a used hole to a free hole of the same strip.
      const r = validateDiagram(s)
      if (!r.ok) throw new Error(r.errors.join('; '))
      const w = s.connections.find((x) => (x.to as { hole?: number }).hole !== undefined)!
      const to = w.to as { part: string; pin: string; hole: number }
      const taken = takenHoles(r.diagram)
      const free = [0, 1, 2, 3, 4].find((i) => !taken.has(holeKey(to.part, to.pin, i)))!
      s.connections.push({ uid: 'hand', from: { ...to }, to: { ...to, hole: free } })
    })
    const v = await cli(['verify', 'sheet.json', '--json'], { cwd: dir })
    expect(JSON.parse(v.out).findings.filter((f: CliFinding) => f.rule === 'capacity')).toHaveLength(1)
    const c = await cli(['check', 'sheet.json', '--json'], { cwd: dir })
    expect(c.code).toBe(1)
    const found: CliFinding[] = JSON.parse(c.out).findings
    expect(found.filter((f) => f.rule === 'hole-shared').map((f) => f.severity)).toEqual(['error'])
    expect(found.filter((f) => f.rule === 'capacity')).toEqual([])
    const g = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: { CIRCUITOON_BROWSER: join(dir, 'no-such-browser.exe') } })
    expect(g.code).toBe(1)
    const blocking: CliFinding[] = JSON.parse(readFileSync(join(dir, 'out', 'gate.json'), 'utf8')).blocking
    expect(blocking.filter((f) => f.rule === 'hole-shared')).toHaveLength(1)
    expect(blocking.filter((f) => f.rule === 'capacity')).toEqual([])
  })

  it('reports a wire end beside a leg once in check and gate: leg-hole-shared, not also capacity', async () => {
    const dir = await laidOut()
    edit(dir, (s) => {
      // A wire from a free hole of R1's strip into the hole R1's leg fills.
      const r = validateDiagram(s)
      if (!r.ok) throw new Error(r.errors.join('; '))
      const r1 = r.diagram.parts.find((p) => p.designator === 'R1')!
      const leg = plugsOf(r.diagram).find((pl) => pl.part === r1.uid)!
      const taken = takenHoles(r.diagram)
      const free = [0, 1, 2, 3, 4].find((i) => !taken.has(holeKey(leg.board, leg.group, i)))!
      s.connections.push({ uid: 'hand', from: { part: leg.board, pin: leg.group, hole: free }, to: { part: leg.board, pin: leg.group, hole: leg.hole } })
    })
    const v = await cli(['verify', 'sheet.json', '--json'], { cwd: dir })
    expect(JSON.parse(v.out).findings.filter((f: CliFinding) => f.rule === 'capacity')).toHaveLength(1)
    const c = await cli(['check', 'sheet.json', '--json'], { cwd: dir })
    expect(c.code).toBe(1)
    const found: CliFinding[] = JSON.parse(c.out).findings
    expect(found.filter((f) => f.rule === 'leg-hole-shared').map((f) => f.severity)).toEqual(['error'])
    expect(found.filter((f) => f.rule === 'capacity')).toEqual([])
    const g = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: { CIRCUITOON_BROWSER: join(dir, 'no-such-browser.exe') } })
    expect(g.code).toBe(1)
    const blocking: CliFinding[] = JSON.parse(readFileSync(join(dir, 'out', 'gate.json'), 'utf8')).blocking
    expect(blocking.filter((f) => f.rule === 'leg-hole-shared')).toHaveLength(1)
    expect(blocking.filter((f) => f.rule === 'capacity')).toEqual([])
  })

  it('verify needs an intent; check still works without one', async () => {
    const dir = await laidOut()
    edit(dir, (s) => void delete s.intent)
    const v = await cli(['verify', 'sheet.json', '--json'], { cwd: dir })
    expect(v.code).toBe(1)
    expect(JSON.parse(v.out).findings.map((f: { message: string }) => f.message)).toEqual([NO_INTENT])
    const c = await cli(['check', 'sheet.json', '--json'], { cwd: dir })
    expect(c.code).toBe(0)
    const cout = JSON.parse(c.out)
    expect(schemaErrors(loadSchema('findings'), cout)).toEqual([])
    expect(cout.findings.some((f: { message: string }) => f.message === NO_INTENT)).toBe(false)
  })

  it('check reports the wiring checker findings on a sheet without an intent', async () => {
    const dir = await laidOut()
    edit(dir, (s) => {
      delete s.intent
      // Short the battery: a wire straight from + to -.
      const bt = (s.parts as { uid: string; designator: string }[]).find((p) => p.designator === 'BT1')!
      s.connections.push({ uid: 'short', from: { part: bt.uid, pin: '+' }, to: { part: bt.uid, pin: '-' } })
    })
    const c = await cli(['check', 'sheet.json', '--json'], { cwd: dir })
    expect(c.code).toBe(1)
    const out = JSON.parse(c.out)
    expect(schemaErrors(loadSchema('findings'), out)).toEqual([])
    expect(out.findings.some((f: { rule: string; severity: string }) => f.rule === 'short' && f.severity === 'error')).toBe(true)
  })

  it('exits 2 on a file that is not a sheet, with the JSON error envelope under --json', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'x.json'), '{"format":"nope"}')
    expect((await cli(['verify', 'x.json'], { cwd: dir })).code).toBe(2)
    expect((await cli(['check', 'missing.json'], { cwd: dir })).code).toBe(2)
    for (const argv of [['verify', 'x.json', '--json'], ['check', 'missing.json', '--json'], ['verify', '--json'], ['check', '--json']]) {
      const r = await cli(argv, { cwd: dir })
      expect(r.code).toBe(2)
      const out = JSON.parse(r.out)
      expect(schemaErrors(loadSchema('error'), out)).toEqual([])
      expect(out).toMatchObject({ format: 'circuitoon-cli/error/1', ok: false, exit: 2, error: { code: 'input' } })
    }
  })

  it('prints a note (info) and never blocks on it: a parallel battery bank', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'sheet.json'), readFileSync(new URL('../format/fixtures/battery-bank-1s4p.circuitoon.json', import.meta.url)))
    // Michael's sheet also has w9 and w11 in c2-top hole 2 (hole-shared, an error): move w9's end to a free hole of that strip.
    edit(dir, (s) => {
      const r = validateDiagram(s)
      if (!r.ok) throw new Error(r.errors.join('; '))
      const w = s.connections.find((x) => x.uid === 'w9')!
      const at = w.from as { part: string; pin: string; hole: number }
      const taken = takenHoles(r.diagram)
      w.from = { ...at, hole: [0, 1, 2, 3, 4].find((i) => !taken.has(holeKey(at.part, at.pin, i)))! }
    })
    const c = await cli(['check', 'sheet.json', '--json'], { cwd: dir })
    expect(c.code).toBe(0)
    const out = JSON.parse(c.out)
    expect(schemaErrors(loadSchema('findings'), out)).toEqual([])
    expect(out.ok).toBe(true)
    // The hand-drawn sheet also has readability warnings (many crossings, and wires drawn into
    // neighbouring holes of one strip that lie on top of each other there): never blocking.
    const readable = new Set<string>(READABILITY_RULES)
    // Its ESP32 and OLED copies predate the library's pin and I2C data (Ruling D1): warnings, never blocking.
    expect(out.findings.filter((f: CliFinding) => !readable.has(f.rule)).map((f: CliFinding) => `${f.severity} ${f.rule}`)).toEqual(['warning module-drift', 'warning module-drift', 'warning module-drift', 'info battery-bank'])
    expect(out.findings.filter((f: CliFinding) => f.rule === 'module-drift').every((f: CliFinding) => f.message.includes('the library has newer data for this part; run `circuitoon update` or use Update parts in the editor') || f.message.includes('The library has newer data for this part; run `circuitoon update` or use Update parts in the editor'))).toBe(true)
    expect(out.findings.filter((f: CliFinding) => readable.has(f.rule)).every((f: CliFinding) => f.severity === 'warning')).toBe(true)
    const text = await cli(['check', 'sheet.json'], { cwd: dir })
    expect(text.code).toBe(0)
    expect(text.out).toContain('INFO battery-bank: BT1-BT4 form a parallel battery bank (4P, 3.7 V).')
  })

  it('reports module-drift in check on a sheet without an intent: a warning for a name-only change', async () => {
    const dir = await laidOut()
    edit(dir, (s) => {
      delete s.intent
      ;(s.modules as Record<string, { name: string }>).resistor.name = 'Resistor (old)'
    })
    const c = await cli(['check', 'sheet.json', '--json'], { cwd: dir })
    expect(c.code).toBe(0)
    const drift = JSON.parse(c.out).findings.filter((f: CliFinding) => f.rule === 'module-drift')
    expect(drift.map((f: CliFinding) => f.severity)).toEqual(['warning'])
    expect(drift[0].parts).toEqual(['R1'])
  })
  it("reports module-drift in check on a sheet without an intent when it hides an old copy's covered holes", async () => {
    // The DIP-28 as drawn before Ruling C2, seated with a wire end under its old body.
    const dir = tempDir()
    const dip = JSON.parse(readFileSync(join('modules', 'mcp23017-dip28.json'), 'utf8'))
    dip.pins = dip.pins.map((p: { side: string }) => ({ ...p, side: p.side === 'bottom' ? 'left' : 'right' }))
    dip.size = { w: 10, h: 19 }
    dip.art = { w: 100, h: 190, pinLabels: 'inside', shapes: [{ type: 'rect', x: 0, y: 0, w: 100, h: 190, fill: '#1E2126' }] }
    writeFileSync(join(dir, 'sheet.json'), JSON.stringify({
      format: 'circuitoon-diagram/1', title: 'old dip',
      modules: { 'breadboard-half': JSON.parse(readFileSync(join('modules', 'breadboard-half.json'), 'utf8')), 'mcp23017-dip28': dip },
      parts: [
        { uid: 'BB1', designator: 'BB1', module: 'breadboard-half', x: 0, y: 0 },
        { uid: 'U1', designator: 'U1', module: 'mcp23017-dip28', x: 60, y: 20, rotation: 90, mount: { board: 'BB1' } },
      ],
      connections: [{ uid: 'w1', from: { part: 'BB1', pin: 'c5-top', hole: 2 }, to: { part: 'BB1', pin: 'c25-top', hole: 0 } }],
    }))
    const c = await cli(['check', 'sheet.json', '--json'], { cwd: dir })
    expect(c.code).toBe(1)
    const rules = JSON.parse(c.out).findings.map((f: CliFinding) => `${f.severity} ${f.rule}`)
    expect(rules).toContain('error module-drift')
    expect(rules).not.toContain('error covered-hole')
    // Without an intent, verify's other findings stay out of check.
    expect(rules).not.toContain('error intent')
  })
  it('keeps only the finding fields, prints plain text, and makes every id unique', () => {
    const f: CliFinding = { id: 'mount|a', rule: 'mount', severity: 'warning', message: 'm', parts: ['p'], pins: [], wires: [] }
    expect(cliFinding({ ...f, subject: 'x', target: 'y' } as CliFinding)).toEqual(f)
    expect(findingsText([f])).toBe('WARNING mount: m')
    expect(notCheckedText().split('\n')).toEqual(['Not checked:', ...NOT_CHECKED.map((n) => `  - ${n}`)])
    expect(uniqueIds([f, f, { ...f, id: 'mount|a#1' }]).map((x) => x.id)).toEqual(['mount|a', 'mount|a#1', 'mount|a#1#1'])
  })
})

describe('readability warnings in check', () => {
  it('lists a crowded pair of wires as a warning and still exits 0', async () => {
    const dir = tempDir()
    const two = { format: 'circuitoon-module/1', id: 'two', name: 'Two', pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }] }
    const p = (uid: string, x: number, y: number) => ({ uid, designator: uid.toUpperCase(), module: 'two', x, y })
    const w = (uid: string, a: string, b: string, y: number) => ({ uid, from: { part: a, pin: 'R' }, to: { part: b, pin: 'L' }, route: [[60, y], [180, y]] })
    writeFileSync(join(dir, 's.json'), JSON.stringify({ format: 'circuitoon-diagram/1', title: 't', modules: { two }, parts: [p('r1', 0, 0), p('r2', 200, 0), p('r3', 0, 10), p('r4', 200, 10)], connections: [w('w1', 'r1', 'r2', 20), w('w2', 'r3', 'r4', 30)] }))
    const r = await cli(['check', 's.json', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    const out = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('findings'), out)).toEqual([])
    expect(out.findings.filter((f: CliFinding) => f.rule === 'wires-crowded').map((f: CliFinding) => f.severity)).toEqual(['warning'])
  })
})
