// The run's own process (firmware spec 2.6, second line of defence for untrusted sheets): `circuitoon
// run` drives the boards in a child Node process started with --disallow-code-generation-from-strings
// and Node's permission model. It may read only the CLI's own code, the engine and the Pyodide folder,
// in every thread; it may not write files, start processes, load addons or WASI, or build code from
// strings; it may start worker threads (the code workers and the engine need them). Node grants worker
// threads read access to the process's working folder on top of the allow list (the main thread gets
// no such grant), so the child is started in its own code folder, which is on the list anyway. The
// child's main thread and every code thread (codeWorker.ts, before user code) probe the home folder,
// the CLI's working folder and any test paths, and refuse to run if one is readable or if writes,
// processes, addons, WASI or code generation are open. Everything the child needs (the sheet, the
// built-in parts, our Python files, Pyodide's location) arrives in one IPC message; the result goes
// back the same way. Like the workers, the child runs this same file: the CLI bundle, or this .ts file
// under vitest (with sourceHooks.ts standing in for what Vite fills at build time).
import { fork } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isMainThread } from 'node:worker_threads'
import type { ModuleDef } from '../../format/module.ts'
import { makeEngine } from '../../sim/engine/engine.ts'
import { createNodeEngineHost, engineDir } from '../../sim/engine/nodeEngine.ts'
import { type DriveOptions, type DriveResult, drive } from '../driver.ts'
import type { SandboxProbe } from '../protocol.ts'
import { PROBE_ENV, probeSandbox, sandboxHole } from './codeWorker.ts'

const CHILD = '--circuitoon-run-child'
/** Node 22.13 and newer: the permission model without the experimental flag. */
export const PERMISSION = process.allowedNodeEnvironmentFlags.has('--permission')

export type RunJob = Omit<DriveOptions, 'engine' | 'spawn' | 'library'> & {
  /** The built-in parts the sheet uses, by id (the child has no catalog). */
  modules: Record<string, ModuleDef>
  /** Paths outside its folders that no thread of the child may read (the home folder, the CLI's working folder, test files). */
  probe?: string[]
}
/** A run's real-time cap: at least 120 s, or --for if longer, plus the never-pauses limit; the child is killed past it. */
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
  const inside = (p: string) => read.some((r) => {
    const rel = relative(r, p)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
  const probe = [homedir(), process.cwd(), ...(job.probe ?? [])].filter((p) => !inside(p))
  const execArgv = [
    '--disallow-code-generation-from-strings',
    // --allow-worker warns on every start; the confinement is checked below instead.
    '--disable-warning=SecurityWarning',
    ...(PERMISSION ? ['--permission', '--allow-worker', ...read.map((p) => `--allow-fs-read=${p}`)] : []),
    ...(source ? [`--import=${pathToFileURL(join(here, 'sourceHooks.ts')).href}`] : []),
  ]
  const { NODE_OPTIONS: _, ...env } = process.env
  // cwd: here, because Node lets worker threads read the working folder whatever the allow list says.
  const child = fork(file, [CHILD], { cwd: here, execArgv, env, serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let err = ''
  child.stderr!.on('data', (b: Buffer) => (err += b.toString()))
  try {
    const reply = await new Promise<Reply>((ok, fail) => {
      child.once('message', (m) => ok(m as Reply))
      child.once('error', fail)
      child.once('exit', (code) => fail(new Error(`the run's process ended early (exit ${code})${err.trim() ? `: ${err.trim()}` : ''}`)))
      const cap = Math.max(RUN_REAL_CAP_MS, job.forMs) + (job.realLimitMs ?? 5000)
      setTimeout(() => fail(new Error(`the run took more than ${cap / 1000} s of real time and was stopped`)), cap).unref()
      child.send({ ...job, probe })
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
    // The code threads probe the same paths (their env is a copy of this one).
    process.env[PROBE_ENV] = JSON.stringify(probe ?? [])
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
