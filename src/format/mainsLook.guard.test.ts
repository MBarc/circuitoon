// Final review (3): the canvas reads the mains analysis on every edit, so a bug in the checker must
// never take the editor down with it. The looks fall back to none and the error is logged.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { identityColor, newWireColor, wireLooks } from './mainsLook.ts'
import type { Diagram } from './diagram.ts'
import { MAINS_MODULES, at, w } from './mains.testing.ts'

vi.mock('./mains.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mains.ts')>()),
  analyseMainsCached: () => {
    throw new Error('checker bug')
  },
}))

describe('the mains look survives a failing analysis', () => {
  afterEach(() => vi.restoreAllMocks())
  // Not built through mains.testing's sheet(): its differential check would run the mocked analysis.
  const d: Diagram = { format: 'circuitoon-diagram/1', title: 't', modules: MAINS_MODULES, parts: [at('xs1', 'XS1', 't-outlet'), at('e1', 'E1', 't-lamp', 200)], connections: [w('xs1|L', 'e1|L')] }
  it('wireLooks gives no looks and logs the error', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(wireLooks(d)).toEqual(new Map())
    expect(log).toHaveBeenCalledOnce()
  })
  it('identityColor gives no colour, so a new wire takes the fallback, and logs the error', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(identityColor(d, { part: 'xs1', pin: 'L' })).toBeNull()
    expect(newWireColor(d, { part: 'xs1', pin: 'L' }, { part: 'e1', pin: 'L' }, 'red')).toBe('red')
    expect(log).toHaveBeenCalled()
  })
})
