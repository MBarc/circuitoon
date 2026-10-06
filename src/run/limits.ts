// The Pyodide checkpoint's results (firmware spec 2.1, 2.6, 9; plan Task 11), measured on
// 2026-10-06 with Pyodide 314.0.7 (Python 3.14.2): cold load 2229 ms, wasm heap 30.0 MB per board
// after the standard imports and a 100,000-step loop, first-Run transfer 6.14 MB as Pages serves it.
// Loaded under the code worker CSP without 'unsafe-eval'.
/** At most this many boards run at once (spec 2.1): 4 when a board's heap is at most 120 MB, else 2. */
export const MAX_RUNNING: 2 | 4 = 4
/** The measured wasm heap per running board, in MB. */
export const BOARD_HEAP_MB = 30
/** The globals Pyodide itself needs in `jsglobals` (spec 2.6: nothing else); found at the checkpoint. */
export const PY_JSGLOBALS: readonly string[] = []
