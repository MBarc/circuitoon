// Messages between a code worker and its host (firmware spec 2.1, 5.3, 5.4, 7). The pin and input
// tables travel in shared memory, never in messages.
import type { BoardKind } from './boards.ts'

export type RunStatus = 'starting' | 'running' | 'done' | 'stopped' | 'error'
export interface StartMessage {
  type: 'start'
  sab: SharedArrayBuffer
  /** Our Python modules by path under the runtime root (ruling R22). */
  files: Record<string, string>
  source: string
  /** The script's file name in tracebacks (`blink.py`, or `main.py`). */
  file: string
  board: BoardKind
  /** Real time in the editor; virtual time under `circuitoon run` (spec 7). */
  mode: 'real' | 'virtual'
  py: { indexURL: string; lock: string }
}
export type ToCode = StartMessage
/**
 * What a confined process could do, seen from inside it (runProcess.ts): the Node code worker sends
 * one after Pyodide loads, before user code runs. `read` is whether each probed path could be read.
 */
export interface SandboxProbe { permission: boolean; codeFromStrings: boolean; read: boolean[]; write: boolean; childProcess: boolean; addons: boolean; wasi: boolean }
export type FromCode =
  /** The Node code worker's own sandbox probe (after Pyodide loads, before the script). */
  | { type: 'probe'; probe: SandboxProbe }
  /** Pyodide is loaded and the script starts now; `sandboxed` names what left the worker's scope (spec 2.6). */
  | { type: 'ready'; sandboxed: string[] }
  /** Serial output, batched (spec 5.3); `text` may hold several lines. */
  | { type: 'out'; stream: 'out' | 'err'; text: string }
  /** input() is waiting; the prompt labels the input box (ruling R12). */
  | { type: 'prompt'; text: string }
  /** Virtual time only (ruling R16): the board is at `nowMs` and waits until `untilMs` (Infinity: until woken). */
  | { type: 'block'; nowMs: number; untilMs: number }
  | { type: 'exit'; status: 'done' | 'stopped' | 'error' }
  /** Pyodide could not load. */
  | { type: 'fatal'; error: string }
