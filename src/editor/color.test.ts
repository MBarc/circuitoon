import { describe, expect, it } from 'vitest'
import { hexEditChanged, shownHex } from './color.ts'

describe('hexEditChanged', () => {
  it('treats the hex shown for a named color as unchanged', () => {
    expect(shownHex('red')).toBe('#E0483E')
    expect(hexEditChanged('red', '#e0483e')).toBe(false)
    expect(hexEditChanged('red', ' #E0483E ')).toBe(false)
    expect(hexEditChanged('red', 'RED')).toBe(false)
  })
  it('sees a different color as a change', () => {
    expect(hexEditChanged('red', '#123456')).toBe(true)
    expect(hexEditChanged('red', 'blue')).toBe(true)
    expect(hexEditChanged('#12AB9F', '#12ab9f')).toBe(false)
  })
})
