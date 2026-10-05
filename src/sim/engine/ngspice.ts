// The ngspice core (spec 2.2, 2.3): one ngspice instance driven through its exported C API, always
// inside a terminable worker (host.ts). A run writes the circuit to the in-memory file system,
// `source`s it, runs `op`, reads every vector of the op plot through ngGet_Vec_Info (never
// stdout), then `remcirc` and `destroy all`, so the heap does not grow per run (spike risk 2). An
// op that leaves no data vector is a failure, with the engine's stderr lines kept. Erasable TS:
// the Node worker runs this file directly.

export interface NgModule {
  _ngSpice_Init(printfcn: number, statfcn: number, ngexit: number, sdata: number, sinitdata: number, bgtrun: number, user: number): number
  _ngSpice_Command(cmd: number): number
  _ngGet_Vec_Info(name: number): number
  _ngSpice_CurPlot(): number
  _ngSpice_AllVecs(plot: number): number
  _ngSpice_SetBkpt(t: number): number
  _ngSpice_nospinit(): number
  _malloc(n: number): number
  _free(p: number): void
  addFunction(f: (...args: number[]) => number, sig: string): number
  UTF8ToString(p: number): string
  stringToUTF8(s: string, p: number, max: number): void
  lengthBytesUTF8(s: string): number
  getValue(p: number, type: 'i32' | 'double' | '*'): number
  HEAPU8: Uint8Array
  FS: { writeFile(path: string, data: string): void }
}
export type NgFactory = (opts: { wasmBinary: Uint8Array; print?: (s: string) => void; printErr?: (s: string) => void }) => Promise<NgModule>
export type OpResult = { ok: true; vectors: Record<string, number> } | { ok: false; error: string }
export interface EngineManifest { ngspice: string; build: string; mode: 'shared' | 'shared-noxspice' | 'exe'; emsdk: string; wasmBytes: number; wasmSha256: string; release: string }

/** vector_info on wasm32 (sharedspice.h): v_name 0, v_type 4, v_flags 8, v_realdata 12, v_compdata 16, v_length 20. */
const V_REALDATA = 12
const V_LENGTH = 20
const CIRCUIT = '/circuit.cir'

export class NgspiceCore {
  private m: NgModule
  private errors: string[] = []
  /** Set when ngspice called its exit callback: the instance is not used again (host.ts recycles it). */
  dead = false
  runs = 0

  constructor(m: NgModule) {
    this.m = m
    // SendChar(char*, int, void*): every printed line, prefixed "stdout " or "stderr ".
    const sendChar = m.addFunction((p: number) => {
      const line = m.UTF8ToString(p)
      if (line.startsWith('stderr ')) this.errors.push(line.slice(7))
      return 0
    }, 'iiii')
    // ControlledExit(int, bool, bool, int, void*).
    const exit = m.addFunction(() => {
      this.dead = true
      return 0
    }, 'iiiiii')
    // Ruling R11: no spinit (it would try to dlopen XSPICE code models).
    m._ngSpice_nospinit()
    if (m._ngSpice_Init(sendChar, 0, exit, 0, 0, 0, 0) !== 0) throw new Error('ngSpice_Init failed')
  }

  private withString<T>(s: string, f: (p: number) => T): T {
    const n = this.m.lengthBytesUTF8(s) + 1
    const p = this.m._malloc(n)
    this.m.stringToUTF8(s, p, n)
    try {
      return f(p)
    } finally {
      this.m._free(p)
    }
  }

  private command(c: string): void {
    this.withString(c, (p) => this.m._ngSpice_Command(p))
  }

  private vectorNames(plot: string): string[] {
    return this.withString(plot, (p) => {
      const list = this.m._ngSpice_AllVecs(p)
      const out: string[] = []
      for (let i = 0; list; i++) {
        const s = this.m.getValue(list + 4 * i, '*')
        if (!s) break
        out.push(this.m.UTF8ToString(s))
      }
      return out
    })
  }

  private vector(name: string): number | null {
    return this.withString(name, (p) => {
      const info = this.m._ngGet_Vec_Info(p)
      if (!info) return null
      const data = this.m.getValue(info + V_REALDATA, '*')
      const length = this.m.getValue(info + V_LENGTH, 'i32')
      return data && length > 0 ? this.m.getValue(data, 'double') : null
    })
  }

  /** One DC operating point: source + op + read + remcirc (spec 2.3). */
  op(text: string): OpResult {
    this.runs++
    this.errors = []
    this.m.FS.writeFile(CIRCUIT, text)
    this.command('destroy all')
    this.command(`source ${CIRCUIT}`)
    this.command('op')
    const plot = this.m.UTF8ToString(this.m._ngSpice_CurPlot())
    const vectors: Record<string, number> = {}
    if (!this.dead && plot && plot !== 'const')
      for (const name of this.vectorNames(plot)) {
        const v = this.vector(name)
        if (v !== null) vectors[name] = v
      }
    this.command('remcirc')
    this.command('destroy all')
    if (this.dead || Object.keys(vectors).length === 0) return { ok: false, error: this.errors.join('\n') || 'the operating point produced no data' }
    return { ok: true, vectors }
  }

  setBreakpoint(t: number): boolean {
    return this.m._ngSpice_SetBkpt(t) !== 0
  }

  heapBytes(): number {
    return this.m.HEAPU8.length
  }
}

export async function createCore(factory: NgFactory, wasmBinary: Uint8Array): Promise<NgspiceCore> {
  const m = await factory({ wasmBinary, print: () => {}, printErr: () => {} })
  return new NgspiceCore(m)
}

/** Node only: the factory, wasm bytes and manifest from an engine directory (public/sim or plugin/dist-cli). */
export async function loadEngineFiles(dir: string): Promise<{ factory: NgFactory; wasm: Uint8Array; manifest: EngineManifest }> {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { pathToFileURL } = await import('node:url')
  const manifest = JSON.parse(readFileSync(join(dir, 'engine.json'), 'utf8')) as EngineManifest
  // A variable specifier: bundlers leave it alone, so the glue is loaded from disk at run time.
  const glue = pathToFileURL(join(dir, 'ngspice.mjs')).href
  const mod = (await import(/* @vite-ignore */ glue)) as { default: NgFactory }
  return { factory: mod.default, wasm: new Uint8Array(readFileSync(join(dir, 'ngspice.wasm'))), manifest }
}
