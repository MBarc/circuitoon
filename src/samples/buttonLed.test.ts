import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buttonLed } from './buttonLed.ts'

describe('sample sheet', () => {
  it('matches the wire uids the live check expects to see drawn', () => {
    const script = readFileSync('.claude/skills/circuitoon-ship/scripts/verify-live.mjs', 'utf8')
    const listed = /const SAMPLE_WIRES = (\[[^\]]*\])/.exec(script)?.[1]
    expect(listed && JSON.parse(listed.replace(/'/g, '"'))).toEqual(buttonLed.connections.map((c) => c.uid))
  })
})
