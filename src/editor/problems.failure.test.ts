// A checker bug must never break the editor: when checkDiagram throws, the Problems list shows one
// row saying so (and the error goes to the console) instead of taking the panel down.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../format/checks.ts', async (original) => ({
  ...(await original<typeof import('../format/checks.ts')>()),
  checkDiagram: () => {
    throw new TypeError('boom')
  },
}))

const { checkFailed, problemsOf } = await import('./problems.ts')
const { EditorStore } = await import('./store.ts')
const { ProblemList } = await import('./Inspector.tsx')

const sheet = () => ({ format: 'circuitoon-diagram/1' as const, title: 't', modules: {}, parts: [], connections: [] })

describe('when the wiring checker throws', () => {
  afterEach(() => vi.restoreAllMocks())
  it('problemsOf gives an empty list, flags the failure and logs the error', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const s = new EditorStore(sheet())
    expect(problemsOf(s)).toEqual([])
    expect(checkFailed(s)).toBe(true)
    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0][1])).toMatch(/boom/)
  })
  it('the Problems list shows one row saying the checker hit an error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const s = new EditorStore(sheet())
    const html = renderToStaticMarkup(createElement(ProblemList, { store: s, findings: problemsOf(s) }))
    expect(html).toContain('The wiring checker hit an error on this sheet')
    expect(html).not.toContain('No problems found in the drawn connections.')
    expect(html.match(/data-checker-failed/g)).toHaveLength(1)
  })
})
