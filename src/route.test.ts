// The App's route key: a link payload in the hash is the same route as the plain editor.
import { describe, expect, it } from 'vitest'
import { routeOf } from './route.ts'

describe('routeOf', () => {
  it('drops the query, so #/editor?d=... and #/editor are one route', () => {
    expect(routeOf('#/editor?d=v1.abc')).toBe('#/editor')
    expect(routeOf('#/editor')).toBe('#/editor')
    expect(routeOf('#/')).toBe('#/')
    expect(routeOf('')).toBe('')
  })
})
