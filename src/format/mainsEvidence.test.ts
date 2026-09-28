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
      for (const f of facts) expect([f!.quote.length > 0, f!.urls.length > 0, f!.urls.every((u) => /^https?:\/\/\S+$/.test(u))]).toEqual([true, true, true])
      if (e.verdict === 'NOT VERIFIED') expect(e.blocking).toBeTruthy()
      // An isolation class is recorded only with a quote that names the class or a written Class II (ruling B3).
      if (e.isolation) expect(e.isolation.quote).toMatch(/Class II|reinforced|double insulation|basic insulation/)
    })
  it('keeps isolation unknown where no class is stated (ruling B2)', () => {
    for (const id of ['hlk-pm01', 'hlk-pm03', 'relay-module-1ch-5v', 'ssr-fotek-25da']) expect([id, EVIDENCE[id].isolation]).toEqual([id, undefined])
  })
  it('MSTB III/3 250 V: the quote says the 2016 header sheet gives 250 V too', () => {
    for (const n of [2, 3]) {
      const r = EVIDENCE[`terminal-block-mstb-508-${n}`].ratings!.find((x) => x.conditions?.startsWith('overvoltage category III, pollution degree 3'))!
      expect(r.volts).toBe(250)
      expect(r.quote).toMatch(/07\/07\/2016.*III\/3\) 250 V/)
      // The quote names the plug page, the current header page and the 2016 header PDF: all three are cited.
      expect(r.urls).toEqual([expect.stringContaining('pcb-plug-mstb'), expect.stringContaining('pcb-header-mstba'), expect.stringMatching(/media\.digikey\.com.*\.pdf$/)])
    }
  })
  it('every COMBICON part carries the no-hot-plug warning', () => {
    for (const n of [2, 3, 4, 5, 6])
      for (const id of [`terminal-block-mstb-508-${n}`, `terminal-block-mc-381-${n}`]) {
        const f = EVIDENCE[id].extra?.noHotPlug
        expect([id, f?.value]).toEqual([id, true])
        expect(f!.quote).toMatch(/must not be plugged in or disconnected when carrying voltage or under load/)
      }
  })
  it('a UL fact quoting both sides cites both the plug and the header source', () => {
    for (const id of ['terminal-block-mc-381-3', 'terminal-block-mstb-508-4', 'terminal-block-mc-381-6']) {
      const e = EVIDENCE[id]
      const [plug, header] = e.sources
      expect(e.extra!.ul.urls).toEqual([plug, header])
    }
  })
})
