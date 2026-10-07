// Describe a part in words and get the closest match: the ranking shared by the Parts panel and
// `circuitoon parts --search`, and the library's part text (partText.json). The text checks run
// over whatever entries are present, so they hold while the text for every part is still landing.
import { describe, expect, it } from 'vitest'
import { load, moduleFiles } from './builtinModules.testing.ts'
import { type PartText, partTextOf, rankParts } from './partSearch.ts'
import PART_TEXT from './partText.json' with { type: 'json' }
import type { ModuleDef } from './module.ts'

const modules = moduleFiles().map(load)
const text = PART_TEXT as Record<string, PartText>
const ids = (query: string, limit = 10) => rankParts(modules, query, text, limit).map((r) => r.module.id)

describe('partText.json', () => {
  const builtin = new Set(modules.map((m) => m.id))
  const entries = Object.entries(text)

  it('names only built-in parts', () => {
    expect(entries.map(([id]) => id).filter((id) => !builtin.has(id))).toEqual([])
  })

  it('has an entry for every built-in part', () => {
    expect(modules.map((m) => m.id).filter((id) => !Object.hasOwn(text, id))).toEqual([])
  })

  it('gives each part one plain sentence and one to eight short uses', () => {
    const bad: string[] = []
    for (const [id, t] of entries) {
      const d = t.description
      // One sentence: ends with a full stop and has no sentence break (". The") inside.
      if (typeof d !== 'string' || !d.trim().endsWith('.') || /[.!?]\s+[A-Z]/.test(d)) bad.push(`${id}: description must be one sentence`)
      else if (/[–—]/.test(d)) bad.push(`${id}: description has an em or en dash`)
      if (!Array.isArray(t.uses) || t.uses.length < 1 || t.uses.length > 8) bad.push(`${id}: uses must list 1 to 8 entries`)
      else for (const u of t.uses) if (typeof u !== 'string' || !u.trim() || u.length > 60 || /[–—]/.test(u)) bad.push(`${id}: use "${u}" must be a short string (60 characters at most, no em or en dashes)`)
      if (Object.keys(t).some((k) => k !== 'description' && k !== 'uses')) bad.push(`${id}: only description and uses`)
    }
    expect(bad).toEqual([])
  })

  it('is the only home of a built-in part\'s text: no module file carries its own', () => {
    expect(modules.filter((m) => m.description !== undefined || m.uses !== undefined).map((m) => m.id)).toEqual([])
  })
})

describe('partTextOf', () => {
  it('reads a built-in part from the table, and a custom part\'s own fields win', () => {
    const sg90 = modules.find((m) => m.id === 'servo-sg90')!
    expect(partTextOf(sg90, text)?.description).toBe(text['servo-sg90'].description)
    const mine: ModuleDef = { ...sg90, id: 'custom-servo-sg90', custom: true, description: 'My servo.', uses: ['a door'] }
    expect(partTextOf(mine, { 'custom-servo-sg90': { description: 'Other.', uses: ['x'] } })).toEqual({ description: 'My servo.', uses: ['a door'] })
    expect(partTextOf({ ...sg90, id: 'nothing-known' }, text)).toBeUndefined()
  })
})

describe('rankParts', () => {
  it('ranks the three Raspberry Pi touch displays first for "a touch display for the rpi"', () => {
    expect(ids('a touch display for the rpi').slice(0, 3).sort()).toEqual(['lcd-rpi-touch-display-2-5', 'lcd-rpi-touch-display-2-7', 'lcd-rpi-touch-display-7'])
  })

  it('ranks the IP5306 module first for "usb-c charger for an 18650"', () => {
    expect(ids('usb-c charger for an 18650')[0]).toBe('ip5306-usbc-module')
  })

  it('still finds the SG90 for "servo"', () => {
    expect(ids('servo')[0]).toBe('servo-sg90')
  })

  it('tolerates a typo', () => {
    const found = ids('dispaly')
    expect(found).toContain('lcd-rpi-touch-display-7')
    expect(found.every((id) => modules.find((m) => m.id === id)!.category === 'Displays')).toBe(true)
  })

  it('returns nothing for a query of only stop words, or no words', () => {
    expect(ids('a the for my')).toEqual([])
    expect(ids('  -- ')).toEqual([])
  })

  it('lists only parts that hit at least half the words, best first, at most `limit`', () => {
    const r = rankParts(modules, 'oled display', text, 5)
    expect(r.length).toBeLessThanOrEqual(5)
    for (let i = 1; i < r.length; i++) expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score)
    expect(ids('zebra quantum')).toEqual([])
  })

  it('puts the servo before the motor driver for "servo motor" (a tie goes to the part hit more often)', () => {
    expect(ids('servo motor')[0]).toBe('servo-sg90')
  })

  it('reads "-es" plurals: "switches" lists switches first', () => {
    expect(modules.find((m) => m.id === ids('switches')[0])!.category).toBe('Switches')
  })

  it('finds microSD modules for "sd card reader", and reads common shorthand', () => {
    expect(ids('sd card reader')[0]).toMatch(/^microsd-/)
    expect(ids('pot')[0]).toMatch(/^potentiometer/)
    expect(ids('cap')[0]).toMatch(/^capacitor-/)
    expect(ids('neopixel')[0]).toMatch(/^ws2812/)
  })

  it('reads "3.3v" as the 3V3 the library writes, and drops stop words before stemming', () => {
    expect(ids('3.3v regulator')).toEqual(ids('3v3 regulator'))
    expect(ids('an oled like this')).toEqual(ids('oled'))
  })

  it('ranks only the first 20 words of a pasted wall of text', () => {
    const t0 = performance.now()
    rankParts(modules, Array.from({ length: 2000 }, (_, i) => `word${i}`).join(' '), text)
    expect(performance.now() - t0).toBeLessThan(200)
  })

  it('expands synonyms: a mic is a microphone, temp is temperature', () => {
    expect(ids('mic')[0]).toMatch(/^mic-/)
    expect(ids('temp humidity sensor')[0]).toMatch(/^dht22-/)
  })

  it('searches a custom part\'s own description and uses', () => {
    const base = modules.find((m) => m.id === 'servo-sg90')!
    const mine: ModuleDef = { ...base, id: 'custom-gizmo', name: 'Gizmo', category: 'Custom', custom: true, pins: [], description: 'A flux capacitor board.', uses: ['time travel'] }
    expect(rankParts([...modules, mine], 'time travel', text, 3)[0].module.id).toBe('custom-gizmo')
  })
})
