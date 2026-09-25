// Checks that hold for every built-in part in modules/, whatever generator or hand made it.
import { describe, expect, it } from 'vitest'
import { load, moduleFiles, pinsOf } from './builtinModules.testing.ts'

describe('every built-in module', () => {
  const files = moduleFiles()

  it('finds the modules', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  for (const file of files) {
    it(`${file}: every electrical terminal names a real pin`, () => {
      const m = load(file)
      const names = new Set(pinsOf(m).map((p) => p.name))
      const terminals = ((m.electrical as { terminals?: Record<string, unknown> } | undefined)?.terminals ?? {})
      for (const [role, pinName] of Object.entries(terminals)) {
        expect(typeof pinName, `${role}`).toBe('string')
        expect(names.has(pinName as string), `terminal ${role} -> "${String(pinName)}"`).toBe(true)
      }
    })
  }
})
