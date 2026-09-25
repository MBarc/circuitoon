import { describe, expect, it } from 'vitest'
import { countLabel, sourceLinks } from './Landing.tsx'

describe('sourceLinks', () => {
  it('is empty when there is no source', () => {
    expect(sourceLinks(undefined)).toEqual([])
  })
  it('splits multiple space-joined URLs', () => {
    expect(sourceLinks('https://a.example/x https://b.example/y')).toEqual(['https://a.example/x', 'https://b.example/y'])
  })
  it('keeps only http: and https: URLs, dropping anything else including non-URLs', () => {
    expect(
      sourceLinks('https://ok.example javascript:alert(1) ftp://nope.example not a url http://also-ok.example'),
    ).toEqual(['https://ok.example', 'http://also-ok.example'])
  })
})

describe('countLabel', () => {
  const base = { format: 'circuitoon-module/1' as const, id: 'x', name: 'X' }
  it('counts pins, skipping spacers', () => {
    expect(countLabel({ ...base, pins: [{ name: 'A', side: 'left' }, { spacer: true, side: 'left' }] })).toBe('1 pin')
    expect(countLabel({ ...base, pins: [{ name: 'A', side: 'left' }, { name: 'B', side: 'left' }] })).toBe('2 pins')
  })
  it('counts holes for a board', () => {
    expect(countLabel({ ...base, pins: [], holes: [{ name: 's', at: [[10, 10], [10, 20]] }] })).toBe('2 holes')
  })
  it('lists both when a module has pins and holes', () => {
    expect(countLabel({ ...base, pins: [{ name: 'A', side: 'left' }], holes: [{ name: 'p', at: [[10, 10]], holeStyle: 'pad' }] })).toBe('1 pin, 1 hole')
  })
})
