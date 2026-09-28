// The toolkit's one tie-break order: natural, then code point so distinct strings never tie.
import { describe, expect, it } from 'vitest'
import { naturalCompare } from './order.ts'

describe('naturalCompare', () => {
  it('orders numbers inside names naturally and never ties distinct strings', () => {
    expect(['R10', 'R2', 'R1', 'r1'].sort(naturalCompare)).toEqual(['R1', 'r1', 'R2', 'R10'])
    expect(naturalCompare('a', 'A')).not.toBe(0)
    expect(naturalCompare('U1', 'U1')).toBe(0)
  })
})
