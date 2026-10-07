// Firmware spec 7: `circuitoon run` runs a sheet's board code on the virtual clock and prints Serial,
// a pin timeline and the findings; --json gives circuitoon-cli/run/1; --press and --input drive it;
// the exit codes are the spec's. The code runs in a child process that Node's permission model
// confines (no reads outside the code and Pyodide folders, no writes, no processes, no code from
// strings).
import { describe, expect, it } from 'vitest'
import { rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { serializeDiagram } from '../format/diagram.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { piBareLed, piBlink, piButton } from '../run/sheets.testing.ts'
import { nodePy } from '../run/testing.ts'
import { PY_FILES } from '../run/pyFiles.ts'
import { runIsolated } from '../run/node/runProcess.ts'
import { cli, tempDir } from './cliHarness.testing.ts'
import { CliError } from './io.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { NO_LONGER_PUBLISHED } from '../run/node/pyCache.ts'
import { parseDuration, parsePress, runCommand } from './runCmd.ts'
import { parseArgs } from './args.ts'

const PY = resolve('node_modules/pyodide')
const sheet = (d: ReturnType<typeof piBlink>) => {
  const dir = tempDir()
  writeFileSync(join(dir, 's.json'), serializeDiagram(d))
  return dir
}
const run = (dir: string, ...flags: string[]) => cli(['run', 's.json', '--py-dir', PY, ...flags], { cwd: dir })

describe('circuitoon run (spec 7)', () => {
  it('parses durations and presses', () => {
    expect([parseDuration('5s'), parseDuration('500ms'), parseDuration('2.5s'), parseDuration('3'), parseDuration('x')]).toEqual([5000, 500, 2500, 3000, null])
    expect(parsePress('S1@1.5s')).toEqual({ ref: 'S1', atMs: 1500, forMs: 200 })
    expect(parsePress('S1@1.5s:0.05s')).toEqual({ ref: 'S1', atMs: 1500, forMs: 50 })
    expect(parsePress('S1')).toBeNull()
  })
  it('runs blink for 3.5 s: Serial, a 1 Hz timeline, exit 0, and JSON to the schema', async () => {
    const dir = sheet(piBlink())
    const r = await run(dir, '--for', '3.5s')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/0\.000 s {2}U1 GPIO17 high\n\s+1\.000 s {2}U1 GPIO17 low\n\s+2\.000 s {2}U1 GPIO17 high\n\s+3\.000 s {2}U1 GPIO17 low/)
    const j = await run(dir, '--for', '2s', '--json')
    const doc = JSON.parse(j.out)
    expect(schemaErrors(loadSchema('run'), doc)).toEqual([])
    expect(doc).toMatchObject({ format: 'circuitoon-cli/run/1', ok: true, exit: 0, simulatedSeconds: 2, boards: [{ ref: 'U1', status: 'stopped' }] })
    // GPIO17 is an output once the code runs: the saved-state solve before the code starts reports nothing.
    expect(doc.findings.filter((f: { message: string }) => f.message.includes('GPIO17 is an input with nothing driving it'))).toEqual([])
  }, 120_000)
  it('runs with a --py-dir reached through a junction or symlink', async () => {
    const dir = sheet(piBlink())
    const link = join(tempDir(), 'pyodide')
    symlinkSync(PY, link, 'junction')
    const r = await cli(['run', 's.json', '--py-dir', link, '--for', '1s'], { cwd: dir })
    expect([r.code, r.err]).toEqual([0, ''])
  }, 120_000)
  it('presses a button and feeds input()', async () => {
    const pressed = await run(sheet(piButton("from gpiozero import Button\nfrom signal import pause\nb = Button(27)\nb.when_pressed = lambda: print('pressed')\npause()\n")), '--for', '3s', '--press', 'S1@1.5s')
    expect(pressed.out).toContain('[1.500 s] pressed')
    const typed = await run(sheet(piButton("print('Hi', input('Name? '))\n")), '--input', 'Ada')
    expect([typed.code, typed.out.includes('Hi Ada')]).toEqual([0, true])
  }, 120_000)
  it('exits 1 on a Python error, 3 with no code or no power, 2 on bad usage', async () => {
    expect((await run(sheet(piButton("raise ValueError('x')\n")))).code).toBe(1)
    // A blocking finding in the saved state still counts when the code ends before any solve while it runs.
    const bare = await run(sheet(piBareLed("print('hi')\n")), '--json')
    const bareDoc = JSON.parse(bare.out)
    expect([bare.code, bareDoc.exit, bareDoc.findings.some((f: { severity: string }) => f.severity === 'error')]).toEqual([1, 1, true])
    const none = piBlink()
    none.parts = none.parts.map((p) => (p.uid === 'u1' ? { ...p, code: undefined } : p))
    const n = await run(sheet(none))
    expect([n.code, n.err]).toEqual([3, expect.stringContaining('U1 has no code')])
    const dir = sheet(piBlink())
    expect((await run(dir, '--for', '601s')).code).toBe(2)
    expect((await run(dir, '--press', 'D1@1s')).err).toContain('run: --press D1@1s: D1 is not a switch or button')
    expect((await run(dir, '--press', 'S1@1s:1s', '--press', 'S1@1.5s')).code).toBe(2)
    expect((await run(dir, '--board', 'U9')).err).toContain('run: --board U9: no board U9 with code on the sheet')
  }, 120_000)
  it('refuses a press on a part that is not there, a button press with no length and a press after the end (exit 2)', async () => {
    const dir = sheet(piBlink())
    expect(await run(dir, '--press', 'S9@1s')).toMatchObject({ code: 2, err: expect.stringContaining('run: --press S9@1s: there is no S9 on the sheet') })
    expect(await run(dir, '--press', 'S1@1s:0s')).toMatchObject({ code: 2, err: expect.stringContaining('run: --press S1@1s:0s: a button press needs a length, such as S1@1s:0.2s') })
    expect(await run(dir, '--for', '2s', '--press', 'S1@2s')).toMatchObject({ code: 2, err: expect.stringContaining('run: --press S1@2s: it is at or after the end of the run (2 s); make --for longer') })
  })
  it('says the Python runtime is no longer published when Pages has no copy (exit 3)', async () => {
    const dir = sheet(piBlink())
    let err = ''
    const parsed = parseArgs(['run', 's.json'])
    if (!parsed.ok) throw new Error(parsed.error)
    // runCommand throws a CliError; main.ts turns it into the message and exit code asserted here.
    const code = await runCommand(parsed.value, { stdout() {}, stderr: (s) => void (err += s), cwd: dir, env: { CIRCUITOON_CACHE: tempDir() } }, { fetch: (async () => new Response('', { status: 404 })) as typeof fetch }).catch((e: CliError) => ((err += `${e.message}
`), e.code))
    expect([code, err]).toEqual([3, `${NO_LONGER_PUBLISHED}\n`])
  }, 60_000)
  // Node lets worker threads read their process's working folder on top of the allow list, so the
  // child starts in its own code folder; no thread of it may read the home folder or this test's cwd.
  it('runs the code in a child process that reads only its folders and denies writes, processes, addons, WASI and code from strings, in the code thread too', async () => {
    const outside = join(tempDir(), 'secret.txt')
    writeFileSync(outside, 'not for the sheet')
    const inHome = join(homedir(), `.circuitoon-probe-${process.pid}.txt`)
    writeFileSync(inHome, 'not for the sheet')
    const inCwd = resolve('package.json')
    try {
      const d = piBlink()
      const modules = Object.fromEntries(Object.keys(d.modules).flatMap((id) => (libraryLookup(id) ? [[id, libraryLookup(id)!]] : [])))
      const r = await runIsolated({ diagram: d, boards: ['u1'], forMs: 1500, inputs: [], presses: [], py: nodePy(), modules, files: PY_FILES, probe: [outside, inHome, inCwd] }, [PY])
      // The probed paths: the home folder and the CLI's cwd (added by runIsolated), then the three files.
      const sealed = { permission: true, codeFromStrings: false, read: [false, false, false, false, false], write: false, childProcess: false, addons: false, wasi: false }
      expect(r.probe).toEqual(sealed)
      // The code thread, probed after Pyodide loads and before the script (the home folder first).
      expect(r.result.boards[0].probe).toEqual({ ...sealed, read: [false, ...sealed.read] })
      expect(r.result.boards[0].status).toBe('stopped')
      expect(r.result.timeline.filter((e) => e.pin === 'GPIO17').map((e) => e.state)).toEqual(['high', 'low'])
    } finally {
      rmSync(inHome, { force: true })
    }
  }, 120_000)
})
