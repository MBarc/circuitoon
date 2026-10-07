// Test helpers for code runs in a real Node worker on node_modules/pyodide.
import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { BoardKind } from './boards.ts'
import { BoardRun } from './host.ts'
import { spawnNodeCodeWorker } from './node/codeWorker.ts'
import type { FromCode } from './protocol.ts'
import { PY_FILES } from './pyFiles.ts'

export function nodePy(): { indexURL: string; lock: string } {
  const dir = resolve('node_modules/pyodide') + sep
  return { indexURL: dir, lock: readFileSync(`${dir}pyodide-lock.json`, 'utf8') }
}

/** Starts `source` on a fresh board; `exited` resolves to how it ended. */
export function runNode(source: string, o: { file?: string; board?: BoardKind; mode?: 'real' | 'virtual'; on?: (m: FromCode, run: BoardRun) => void } = {}) {
  const messages: FromCode[] = []
  let ended!: (s: string) => void
  const exited = new Promise<string>((r) => (ended = r))
  const run: BoardRun = new BoardRun({
    board: o.board ?? 'pi4', source, file: o.file ?? 'main.py', mode: o.mode ?? 'real', py: nodePy(), files: PY_FILES, spawn: spawnNodeCodeWorker,
    on: (m) => {
      messages.push(m)
      o.on?.(m, run)
      if (m.type === 'exit') ended(m.status)
      if (m.type === 'fatal') ended(`fatal: ${m.error}`)
    },
  })
  run.start()
  void run.done.then(() => ended(run.status))
  return { run, messages, exited }
}
