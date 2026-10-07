// The code worker's Python side, shared by both workers and the in-process test harness: our files
// into Pyodide's file system, a fresh interpreter state per run, and running the script through
// _circuitoon.main. Worker side: nothing Vite-specific.
import { makeHw, realClock, virtualClock } from '../bridge.ts'
import { F, H, INPUT, boardMemory, takeLine } from '../memory.ts'
import type { FromCode, ToCode } from '../protocol.ts'
import { noCodeGeneration, sandbox } from './sandbox.ts'

/** What we use of Pyodide's API. */
export interface PyodideLike {
  FS: { mkdirTree(path: string): void; writeFile(path: string, data: string): void; filesystems: Record<string, unknown> }
  runPython(code: string, o?: { globals?: unknown }): unknown
  registerJsModule(name: string, module: object): void
  unregisterJsModule(name: string): void
  setStdout(o: { batched: (line: string) => void }): void
  setStderr(o: { batched: (line: string) => void }): void
  setStdin(o: { stdin: () => string | null }): void
  setInterruptBuffer(buffer: Int32Array): void
  checkInterrupt(): void
  toPy(o: unknown): unknown
}

export const PY_ROOT = '/lib/circuitoon'

export function installFiles(py: PyodideLike, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    const full = `${PY_ROOT}/${path}`
    py.FS.mkdirTree(full.slice(0, full.lastIndexOf('/')))
    py.FS.writeFile(full, text)
  }
  py.runPython(`import sys\nif '${PY_ROOT}' not in sys.path: sys.path.insert(0, '${PY_ROOT}')`)
}

/** Forgets our modules and the user's, so the next run starts fresh (the harness; a worker runs once). */
export function resetModules(py: PyodideLike): void {
  py.runPython(
    "import sys\nfor k in [k for k in sys.modules if k.split('.')[0] in ('_circuitoon', 'circuitoon_hw', 'RPi', 'gpiozero')]: del sys.modules[k]",
  )
}

export function runMain(py: PyodideLike, source: string, file: string): 'done' | 'stopped' | 'error' {
  const g = py.toPy({ SRC: source, FILE: file })
  try {
    return py.runPython('import _circuitoon\n_circuitoon.main(SRC, FILE)', { globals: g }) as 'done' | 'stopped' | 'error'
  } catch (e) {
    // A Stop just after 'ready' lands while Pyodide still compiles this line, outside main's own handler.
    if ((e as { type?: string }).type === 'KeyboardInterrupt') return 'stopped'
    throw e
  }
}

/** makeHw's `fail`: raises a Python ValueError with `message` (a Python exception thrown through JS arrives in Python as itself). */
export function pyValueError(py: PyodideLike): (message: string) => never {
  return py.runPython('def _circuitoon_value_error(message):\n    raise ValueError(message)\n_circuitoon_value_error') as (message: string) => never
}

export type LoadPy = (indexURL: string, lock: string) => Promise<PyodideLike>
const why = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Serial output (spec 5.3): lines collected and posted at most every 16 ms, and at every yield point. */
function outBuffer(post: (m: FromCode) => void) {
  let buf: { stream: 'out' | 'err'; text: string } | null = null
  let last = 0
  const flush = () => {
    if (buf) post({ type: 'out', ...buf })
    buf = null
    last = performance.now()
  }
  return {
    flush,
    push(stream: 'out' | 'err', line: string) {
      if (buf && buf.stream !== stream) flush()
      buf = { stream, text: (buf?.text ?? '') + line + '\n' }
      if (performance.now() - last >= 16) flush()
    },
  }
}

/**
 * The code worker (firmware spec 2.6, 5.2 to 5.4), shared by the browser and Node workers: on
 * 'start', load Pyodide (the caller's loader), remove the network and storage from the scope, write
 * our Python files, register circuitoon_hw, run the script, and say how it ended. One run per worker:
 * Reset starts a fresh one (spec 5.4).
 */
export function serveCode(post: (m: FromCode) => void, listen: (cb: (m: ToCode) => void) => void, loadPy: LoadPy): void {
  listen((m) => {
    if (m.type !== 'start') return
    void (async () => {
      let py: PyodideLike
      try {
        py = await loadPy(m.py.indexURL, m.py.lock)
      } catch (e) {
        return post({ type: 'fatal', error: why(e) })
      }
      const sandboxed = sandbox(globalThis)
      const mem = boardMemory(m.sab)
      const check = () => py.checkInterrupt()
      const clock = m.mode === 'virtual' ? virtualClock(mem, post, check) : realClock(mem, check)
      const out = outBuffer(post)
      const hw = makeHw(mem, clock, { board: m.board, onPrompt: (text) => post({ type: 'prompt', text }), flush: out.flush, fail: pyValueError(py) })
      py.setStdout({ batched: (s) => out.push('out', s) })
      py.setStderr({ batched: (s) => out.push('err', s) })
      // sys.stdin.readline() (spec 5.3): waits for a line, running no callbacks.
      py.setStdin({
        stdin: () => {
          Atomics.store(mem.i32, H.inputState, INPUT.waiting)
          post({ type: 'prompt', text: '' })
          while (Atomics.load(mem.i32, H.inputState) !== INPUT.ready) clock.block(Infinity)
          return `${takeLine(mem)}\n`
        },
      })
      py.setInterruptBuffer(new Int32Array(m.sab, H.interrupt * 4, 1))
      installFiles(py, m.files)
      py.registerJsModule('circuitoon_hw', hw)
      // No host access for user code (spec 2.6): Pyodide registers its own API as pyodide_js whatever
      // jsglobals says, and in Node that API mounts host directories and opens sockets.
      py.unregisterJsModule('pyodide_js')
      py.runPython("import sys\nsys.modules.pop('pyodide_js', None)")
      for (const name of ['mountNodeFS', 'useNodeSockFS', 'mountNativeFS']) Reflect.deleteProperty(py, name)
      delete py.FS.filesystems.NODEFS
      noCodeGeneration()
      // The never-pauses check counts from here, not from the spawn (loading is not the code's fault).
      mem.f64[F.lastYieldMs] = performance.timeOrigin + performance.now()
      post({ type: 'ready', sandboxed })
      let status: 'done' | 'stopped' | 'error'
      try {
        status = runMain(py, m.source, m.file)
      } catch (e) {
        out.push('err', why(e))
        status = 'error'
      }
      out.flush()
      post({ type: 'exit', status })
    })()
  })
}
