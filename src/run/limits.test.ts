// The checkpoint's results agree with the spec's rule and with the pinned manifest.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import PY from './pyManifest.json' with { type: 'json' }
import { BOARD_HEAP_MB, MAX_RUNNING, PY_JSGLOBALS } from './limits.ts'

describe('Pyodide checkpoint results (spec 2.1, 2.6)', () => {
  it('caps running boards by the measured heap', () => {
    expect(BOARD_HEAP_MB).toBeGreaterThan(0)
    expect(MAX_RUNNING).toBe(BOARD_HEAP_MB <= 120 ? 4 : 2)
  })
  it('passes only named globals and records the measured version', () => {
    for (const n of PY_JSGLOBALS) expect(n).toMatch(/^[A-Za-z]+$/)
    expect(readFileSync('src/run/limits.ts', 'utf8')).toContain(`Pyodide ${PY.version} (Python ${PY.python})`)
  })
})
