// The evidence table is complete and honest: every mains part the spec lists has an entry, every
// entry cites sources, and every value carries the line it was read from.
import { describe, expect, it } from 'vitest'
import { EVIDENCE } from './mainsEvidence.ts'

const IDS = [
  'outlet-us-5-15r-duplex', 'outlet-us-5-20r-duplex', 'outlet-uk-bs1363', 'outlet-schuko-cee7-3', 'outlet-fr-cee7-5', 'outlet-au-as3112', 'outlet-jp-1-15r-duplex', 'outlet-jp-1-15r-duplex-polarized',
  'charger-usb-5v-us', 'charger-usb-5v-eu', 'charger-usb-5v-uk', 'charger-usb-5v-au', 'adapter-barrel-us', 'adapter-barrel-eu', 'adapter-barrel-uk', 'adapter-barrel-au',
  'plug-us-5-15p', 'plug-us-1-15p', 'plug-jp-1-15p', 'plug-eu-cee7-7', 'plug-eu-cee7-16', 'plug-uk-bs1363-3lead', 'plug-uk-bs1363-2lead', 'plug-au-as3112-3lead', 'plug-au-as3112-2lead',
  'hlk-pm01', 'hlk-pm03', 'irm-03-5', 'irm-03-3v3', 'irm-05-5', 'lamp-holder-e26', 'lamp-holder-e27', 'fuse-holder-5x20-inline', 'rocker-switch-kcd1', 'wago-221-412', 'wago-221-413', 'wago-221-415',
  ...[2, 3, 4, 5, 6].flatMap((n) => [`terminal-block-mstb-508-${n}`, `terminal-block-mc-381-${n}`]),
  'terminal-block-kf2edg-508-2', 'terminal-block-kf2edg-508-3', 'terminal-block-kf301-500-2', 'terminal-block-kf301-500-3',
  'relay-module-1ch-5v', 'ssr-fotek-25da',
]

describe('mains evidence', () => {
  it('has an entry for every mains part in the spec', () => {
    expect(Object.keys(EVIDENCE).sort()).toEqual([...IDS].sort())
  })
  for (const id of IDS)
    it(`${id}: sources cited, every value quoted, a verdict with a disposition when not verified`, () => {
      const e = EVIDENCE[id]
      expect(e.sources.length).toBeGreaterThan(0)
      for (const u of e.sources) expect(u).toMatch(/^https?:\/\//)
      const facts = [e.pins, e.lSide, e.isolation, e.acInput, e.output, e.protection, e.loadRange, ...(e.ratings ?? []), ...Object.values(e.extra ?? {})].filter(Boolean)
      for (const f of facts) expect([f!.quote.length > 0, /^https?:\/\//.test(f!.url)]).toEqual([true, true])
      if (e.verdict === 'NOT VERIFIED') expect(e.blocking).toBeTruthy()
      // An isolation class is recorded only with a quote that names the class or a written Class II (ruling B3).
      if (e.isolation) expect(e.isolation.quote).toMatch(/Class II|reinforced|double insulation|basic insulation/)
    })
  it('keeps isolation unknown where no class is stated (ruling B2)', () => {
    for (const id of ['hlk-pm01', 'hlk-pm03', 'relay-module-1ch-5v', 'ssr-fotek-25da']) expect([id, EVIDENCE[id].isolation]).toEqual([id, undefined])
  })
})
