import { describe, expect, it } from 'vitest'
import { sourceLinks } from './Landing.tsx'

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
