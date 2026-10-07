// `circuitoon run <sheet> [--board U1|all] [--for 5s] [--input "line"]... [--press S1@1.5s[:0.2s]]...
// [--json] [--py-dir <path>]` (firmware spec 7): runs the boards' code in Node workers on a virtual
// clock with the live simulation (src/run/driver.ts), inside a confined child process
// (src/run/node/runProcess.ts; it denies writes, processes and code generation), then prints each board's Serial, the pin timeline (steady PWM as one
// line per duty change) and the findings seen. Deterministic and faster than real time. Exit 0 clean;
// 1 a Python error, a blocking finding, lost power or code that never pauses; 2 usage; 3 a board that
// could not start (no code, no sim data, no power) or no Python runtime.
import type { ModuleDef } from '../format/module.ts'
import { switchGroups } from '../format/simState.ts'
import { libraryLookup } from '../agent/catalog.ts'
import type { Press } from '../run/driver.ts'
import { boardKindOf } from '../run/boards.ts'
import { cacheRoot, ensurePy } from '../run/node/pyCache.ts'
import { runIsolated } from '../run/node/runProcess.ts'
import { PY_FILES } from '../run/pyFiles.ts'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, flag, loadSheet, pathIn, printJson } from './io.ts'

export const RUN_FORMAT = 'circuitoon-cli/run/1'
export const RUN_MAX_MS = 600_000
const USAGE = 'run: usage: circuitoon run <sheet.json> [--board <ref>|all] [--for 5s] [--input "line"]... [--press S1@1.5s[:0.2s]]... [--json] [--py-dir <dir>]'

export function parseDuration(s: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(s.trim())
  return m ? Math.round(Number(m[1]) * (m[2] === 'ms' ? 1 : 1000)) : null
}

export function parsePress(spec: string): { ref: string; atMs: number; forMs: number } | null {
  const m = /^([A-Za-z][A-Za-z0-9_]*)@([^:]+)(?::(.+))?$/.exec(spec)
  const at = m ? parseDuration(m[2]) : null
  const len = m?.[3] === undefined ? 200 : parseDuration(m[3])
  return m && at !== null && len !== null ? { ref: m[1], atMs: at, forMs: len } : null
}

const secs = (ms: number) => `${(ms / 1000).toFixed(3)} s`

export async function runCommand(args: Args, io: Io, opts: { fetch?: typeof fetch; realLimitMs?: number } = {}): Promise<number> {
  const [input, ...rest] = args.positionals
  if (!input || rest.length) throw new CliError(USAGE, EXIT.input)
  const json = args.flags.has('--json')
  const forArg = flag(args, '--for')
  const forMs = forArg === undefined ? 5000 : parseDuration(forArg)
  if (forMs === null || forMs <= 0 || forMs > RUN_MAX_MS) throw new CliError(`run: --for ${forArg}: give a time from 1ms to 600s, such as 5s`, EXIT.input)
  const { diagram: d, warnings } = loadSheet(io, input)
  for (const w of warnings) io.stderr(`warning: ${w}\n`)
  const byRef = new Map(d.parts.map((p) => [p.designator, p]))
  // Presses (ruling R17): buttons are held for their length, switches flip; button presses may not overlap.
  const presses: Press[] = []
  for (const spec of args.lists?.get('--press') ?? []) {
    const p = parsePress(spec)
    if (!p) throw new CliError(`run: --press ${spec}: write it as REF@TIME[:LENGTH], such as S1@1.5s:0.2s`, EXIT.input)
    const part = byRef.get(p.ref)
    if (!part) throw new CliError(`run: --press ${spec}: there is no ${p.ref} on the sheet`, EXIT.input)
    if (p.atMs >= forMs) throw new CliError(`run: --press ${spec}: it is at or after the end of the run (${forMs / 1000} s); make --for longer`, EXIT.input)
    const groups = switchGroups(d.modules[part.module])
    if (!groups.some((g) => g.kind === 'switch')) throw new CliError(`run: --press ${spec}: ${p.ref} is not a switch or button`, EXIT.input)
    const button = groups.some((g) => g.momentary)
    if (button && p.forMs <= 0) throw new CliError(`run: --press ${spec}: a button press needs a length, such as ${p.ref}@${spec.split('@')[1].split(':')[0]}:0.2s`, EXIT.input)
    presses.push({ uid: part.uid, atMs: p.atMs, forMs: button ? p.forMs : 0 })
  }
  const held = presses.filter((p) => p.forMs > 0).sort((a, b) => a.atMs - b.atMs)
  for (let i = 1; i < held.length; i++)
    if (held[i].atMs < held[i - 1].atMs + held[i - 1].forMs) throw new CliError('run: two --press button presses overlap; one button is held at a time', EXIT.input)
  const coded = d.parts.filter((p) => p.code)
  const board = flag(args, '--board') ?? 'all'
  let boards: string[]
  if (board === 'all') boards = coded.map((p) => p.uid)
  else {
    const p = byRef.get(board)
    if (!p?.code) throw new CliError(`run: --board ${board}: no board ${board} with code on the sheet`, EXIT.input)
    boards = [p.uid]
  }
  if (!boards.length) {
    const names = d.parts.filter((p) => boardKindOf(d.modules[p.module])).map((p) => p.designator)
    if (json) printJson(io, { format: RUN_FORMAT, ok: false, exit: EXIT.environment, simulatedSeconds: 0, boards: [], timeline: [], findings: [], incomplete: names.map((ref) => ({ ref, why: `${ref} has no code` })), neverPauses: [], lostPower: [] })
    io.stderr(`${names.length ? names.map((n) => `${n} has no code`).join('\n') : 'The sheet has no board with code'}\n`)
    return EXIT.environment
  }
  let py: { dir: string; indexURL: string; lock: string }
  try {
    const pyDir = flag(args, '--py-dir')
    py = await ensurePy({ ...(pyDir ? { pyDir: pathIn(io, pyDir) } : { cacheDir: cacheRoot(io.env) }), ...(opts.fetch ? { fetch: opts.fetch } : {}) })
  } catch (e) {
    throw new CliError(e instanceof Error ? e.message : String(e), EXIT.environment)
  }
  const modules: Record<string, ModuleDef> = {}
  for (const id of Object.keys(d.modules)) {
    const m = libraryLookup(id)
    if (m) modules[id] = m
  }
  const { result: r } = await runIsolated(
    { diagram: d, boards, forMs, inputs: [...(args.lists?.get('--input') ?? [])], presses, py: { indexURL: py.indexURL, lock: py.lock }, files: PY_FILES, modules, ...(opts.realLimitMs ? { realLimitMs: opts.realLimitMs } : {}) },
    [py.dir],
  )
  const refOf = (uid: string) => d.parts.find((p) => p.uid === uid)?.designator ?? uid
  const blocking = r.findings.some((f) => f.severity === 'error')
  const failed = r.boards.some((b) => b.status === 'error') || r.lostPower.length > 0 || r.neverPauses.length > 0 || blocking
  const code = failed ? EXIT.blocked : r.incomplete.length ? EXIT.environment : EXIT.ok
  if (json) {
    printJson(io, {
      format: RUN_FORMAT, ok: code === EXIT.ok, exit: code, simulatedSeconds: r.simulatedMs / 1000,
      boards: r.boards.map((b) => ({ ref: b.ref, status: b.status, serial: b.serial.map((s) => ({ t: s.t / 1000, stream: s.stream, text: s.text })) })),
      timeline: r.timeline.map((e) => ({ t: e.t / 1000, ref: refOf(e.uid), pin: e.pin, state: e.state })),
      findings: r.findings,
      incomplete: r.incomplete.map((x) => ({ ref: refOf(x.uid), why: x.why })),
      neverPauses: r.neverPauses.map(refOf), lostPower: r.lostPower.map(refOf),
    })
    return code
  }
  const lines: string[] = []
  for (const b of r.boards) {
    lines.push(`${b.ref}: ${b.status === 'not-started' ? 'did not start' : b.status} (${secs(r.simulatedMs)} simulated)`)
    for (const s of b.serial) for (const t of s.text.replace(/\n$/, '').split('\n')) lines.push(`  [${secs(s.t)}] ${s.stream === 'err' ? 'error: ' : s.stream === 'note' ? 'note: ' : ''}${t}`)
  }
  for (const x of r.incomplete) lines.push(x.why)
  if (r.timeline.length) lines.push('Pins:', ...r.timeline.map((e) => `  ${secs(e.t).padStart(9)}  ${refOf(e.uid)} ${e.pin} ${e.state}`))
  if (r.findings.length) lines.push('Findings:', ...r.findings.map((f) => `  ${f.severity}: ${f.message}`))
  io.stdout(`${lines.join('\n')}\n`)
  return code
}
