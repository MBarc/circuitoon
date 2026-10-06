// One running board (firmware spec 2.1, 5.4): its shared memory, its worker, Stop and Reset. Stop
// writes the interrupt buffer and wakes the code (KeyboardInterrupt: except and finally blocks run);
// the worker is terminated if it has not finished after 1 s. Reset is a new BoardRun (a fresh worker,
// the already-fetched files). Host side, shared by the editor and the CLI.
import type { BoardKind } from './boards.ts'
import { type BoardMemory, F, boardMemory, interrupt } from './memory.ts'
import type { FromCode, RunStatus, ToCode } from './protocol.ts'

/** time.time() at run time 0 under the virtual clock: fixed, so runs repeat exactly. */
export const VIRTUAL_EPOCH_MS = Date.UTC(2026, 0, 1)

export interface CodeWorkerLike {
  post(m: ToCode): void
  onMessage(cb: (m: FromCode) => void): void
  onError(cb: (why: string) => void): void
  terminate(): void
}
export interface BoardRunOptions {
  board: BoardKind
  source: string
  file: string
  mode: 'real' | 'virtual'
  py: { indexURL: string; lock: string }
  files: Record<string, string>
  spawn: () => CodeWorkerLike
  on: (m: FromCode) => void
  /** How long Stop waits before terminating the worker (spec 5.4: 1 s). */
  stopGraceMs?: number
}

export class BoardRun {
  readonly memory: BoardMemory
  status: RunStatus = 'starting'
  readonly done: Promise<void>
  private o: BoardRunOptions
  private worker: CodeWorkerLike | null = null
  private ended!: () => void

  constructor(o: BoardRunOptions) {
    this.o = o
    this.memory = boardMemory()
    this.done = new Promise((r) => (this.ended = r))
  }

  start(): void {
    this.memory.f64[F.startMs] = this.o.mode === 'virtual' ? VIRTUAL_EPOCH_MS : performance.timeOrigin + performance.now()
    const w = (this.worker = this.o.spawn())
    w.onMessage((m) => {
      if (m.type === 'ready') this.status = 'running'
      if (m.type === 'exit') this.finish(m.status)
      if (m.type === 'fatal') this.finish('error')
      this.o.on(m)
    })
    w.onError((why) => {
      if (this.status !== 'starting' && this.status !== 'running') return
      this.o.on({ type: 'fatal', error: why })
      this.finish('error')
    })
    w.post({ type: 'start', sab: this.memory.sab, files: this.o.files, source: this.o.source, file: this.o.file, board: this.o.board, mode: this.o.mode, py: this.o.py })
  }

  private finish(status: RunStatus): void {
    if (this.status === 'starting' || this.status === 'running') this.status = status
    // A finished run keeps no Pyodide heap or thread.
    this.worker?.terminate()
    this.ended()
  }

  /** Stop (spec 5.4): KeyboardInterrupt now; terminated if not finished after 1 s. */
  async stop(): Promise<'stopped' | 'terminated' | 'ended'> {
    const w = this.worker
    if (!w) return 'ended'
    if (this.status !== 'starting' && this.status !== 'running') {
      w.terminate()
      return 'ended'
    }
    interrupt(this.memory)
    const how = await Promise.race([this.done.then(() => 'stopped' as const), new Promise<'terminated'>((r) => setTimeout(() => r('terminated'), this.o.stopGraceMs ?? 1000))])
    w.terminate()
    if (how === 'terminated') this.finish('stopped')
    return how
  }
}
