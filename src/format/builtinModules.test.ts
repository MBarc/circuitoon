// Checks that hold for every built-in part in modules/, whatever generator or hand made it.
import { describe, expect, it } from 'vitest'
import { layoutModule } from './module.ts'
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

    // The renderer centers the art in the laid-out body, so art smaller than the body shifts by
    // half the difference and every drawn pad or lead lands off its pin (the level shifter once
    // drew its pads 5 px left of the pins). Art drawn at the laid-out size is never re-centered.
    it(`${file}: art is drawn at the laid-out body size`, () => {
      const m = load(file)
      const lay = layoutModule(m)
      expect(m.art, 'built-in parts carry art').toBeDefined()
      expect({ w: m.art?.w, h: m.art?.h }).toEqual({ w: lay.w, h: lay.h })
    })
  }
})
