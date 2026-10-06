// The code worker's Python side, shared by both workers and the in-process test harness: our files
// into Pyodide's file system, a fresh interpreter state per run, and running the script through
// _circuitoon.main. Worker side: nothing Vite-specific.

/** What we use of Pyodide's API. */
export interface PyodideLike {
  FS: { mkdirTree(path: string): void; writeFile(path: string, data: string): void }
  runPython(code: string, o?: { globals?: unknown }): unknown
  registerJsModule(name: string, module: object): void
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
  return py.runPython('import _circuitoon\n_circuitoon.main(SRC, FILE)', { globals: g }) as 'done' | 'stopped' | 'error'
}
