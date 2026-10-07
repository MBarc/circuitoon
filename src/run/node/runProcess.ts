// The run's own process (firmware spec 2.6, second line of defence for untrusted sheets): `circuitoon
// run` drives the boards in a child Node process started with --disallow-code-generation-from-strings
// and Node's permission model. It may not write files, start processes, or load addons or WASI, and
// it may not build code from strings; it may start worker threads (the code workers and the engine
// need them). Reads are confined to the CLI's own code, the engine and the Pyodide folder on the
// child's main thread only: Node does not confine reads in worker threads, so in the code threads
// reads rely on the in-worker sandbox (curated jsglobals, network and storage APIs removed,
// pyodide_js and NODEFS removed, code generation off). Each code thread probes itself before user
// code runs (codeWorker.ts) and refuses to run if writes, processes, WASI or code generation are open. Everything it needs (the sheet, the built-in parts,
// our Python files, Pyodide's location) arrives in one IPC message; the result goes back the same way.
// Like the workers, the child runs this same file: the CLI bundle, or this .ts file under vitest (with
// sourceHooks.ts standing in for what Vite fills at build time).
import { fork } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isMainThread } from 'node:worker_threads'
import type { ModuleDef } from '../../format/module.ts'
import { makeEngine } from '../../sim/engine/engine.ts'
import { createNodeEngineHost, engineDir } from '../../sim/engine/nodeEngine.ts'
import { type DriveOptions, type DriveResult, drive } from '../driver.ts'
import type { SandboxProbe } from '../protocol.ts'
import { probeSandbox, sandboxHole } from './codeWorker.ts'

const CHILD = '--circuitoon-run-child'
/** Node 22.13 and newer: the permission model without the experimental flag. */
export const PERMISSION = process.allowedNodeEnvironmentFlags.has('--permission')

export type RunJob = Omit<DriveOptions, 'engine' | 'spawn' | 'library'> & {
  /** The built-in parts the sheet uses, by id (the child has no catalog). */
  modules: Record<string, ModuleDef>
  /** Paths the child tries to read, for its sandbox report (the tests). */
  probe?: string[]
}
/** A run's real-time cap whatever --for says, on top of the never-pauses limit: the child is killed past it. */
export const RUN_REAL_CAP_MS = 120_000
export type RunResult = Omit<DriveResult, 'solves'>
type Reply = { ok: true; result: RunResult; probe: SandboxProbe } | { ok: false; error: string; probe: SandboxProbe }

/** Why the child is not confined as it should be, or null. */
function hole(p: SandboxProbe): string | null {
  if (PERMISSION && !p.permission) return 'the permission model is off'
  return sandboxHole(p)
}

/** Runs `job` in the confined child; `readPaths` are the extra folders it may read (Pyodide's). */
export async function runIsolated(job: RunJob, readPaths: string[]): Promise<{ result: RunResult; probe: SandboxProbe }> {
  const file = fileURLToPath(import.meta.url)
  const source = file.endsWith('.ts')
  const here = dirname(file)
  // The code itself: the bundle's folder, or src/ from the source tree.
  const read = [source ? resolve(here, '..', '..') : here, engineDir(), ...readPaths].filter((p): p is string => !!p)
  const execArgv = [
    '--disallow-code-generation-from-strings',
    // --allow-worker warns on every start; the confinement is checked below instead.
    '--disable-warning=SecurityWarning',
    ...(PERMISSION ? ['--permission', '--allow-worker', ...read.map((p) => `--allow-fs-read=${p}`)] : []),
    ...(source ? [`--import=${pathToFileURL(join(here, 'sourceHooks.ts')).href}`] : []),
  ]
  const { NODE_OPTIONS: _, ...env } = process.env
  const child = fork(file, [CHILD], { execArgv, env, serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let err = ''
  child.stderr!.on('data', (b: Buffer) => (err += b.toString()))
  try {
    const reply = await new Promise<Reply>((ok, fail) => {
      child.once('message', (m) => ok(m as Reply))
      child.once('error', fail)
      child.once('exit', (code) => fail(new Error(`the run's process ended early (exit ${code})${err.trim() ? `: ${err.trim()}` : ''}`)))
      const cap = RUN_REAL_CAP_MS + (job.realLimitMs ?? 5000)
      setTimeout(() => fail(new Error(`the run took more than ${cap / 1000} s of real time and was stopped`)), cap).unref()
      child.send(job)
    })
    const why = hole(reply.probe)
    if (why) throw new Error(`the run's sandbox did not hold (${why}); not running the code`)
    if (!reply.ok) throw new Error(reply.error)
    return { result: reply.result, probe: reply.probe }
  } finally {
    child.kill()
  }
}

// The child: only when this file was started as the run's process.
if (isMainThread && process.argv.includes(CHILD) && process.send) {
  process.on('disconnect', () => process.exit(0))
  process.once('message', (job: RunJob) => {
    const { modules, probe, ...o } = job
    const sandbox = probeSandbox(probe ?? [])
    const send = (r: Reply) => process.send!(r, () => process.exit(0))
    // Never runs the code in a process that is not confined.
    if (hole(sandbox)) return send({ ok: false, error: 'not confined', probe: sandbox })
    const engine = makeEngine(createNodeEngineHost())
    drive({ ...o, engine, library: (id) => (Object.hasOwn(modules, id) ? modules[id] : undefined) })
      .then(({ solves: _, ...result }) => send({ ok: true, result, probe: sandbox }))
      .catch((e: unknown) => send({ ok: false, error: e instanceof Error ? e.message : String(e), probe: sandbox }))
      .finally(() => engine.dispose())
  })
}
