// The spec's circuits (section 7) on the built-in parts: what a correct mains hookup must not be
// nagged about beyond what Circuitoon cannot know, and the plug that does not fit.
import { describe, expect, it } from 'vitest'
import { checkDiagram } from './checks.ts'
import type { Connection, Diagram, PartInstance } from './diagram.ts'
import type { ModuleDef } from './module.ts'
import { layoutModule } from './module.ts'
import { pivot } from './geometry.ts'
import { mainsOf } from './mainsModel.ts'
import { SOCKET_PATTERNS } from './plugging.ts'
import { load } from './builtinModules.testing.ts'

let n = 0
const stripped = (a: string, b: string): Connection => {
  const end = (s: string) => { const [part, pin] = s.split('|'); return { part, pin } }
  return { uid: `w${++n}`, from: end(a), to: end(b), gauge: 18, ends: { from: 'stripped', to: 'stripped' } }
}
const dc = (a: string, b: string): Connection => ({ ...stripped(a, b), gauge: 22, ends: undefined })
function sheet(parts: PartInstance[], connections: Connection[]): Diagram {
  const modules: Record<string, ModuleDef> = {}
  for (const p of parts) modules[p.module] = load(p.module)
  return { format: 'circuitoon-diagram/1', title: 't', modules, parts, connections }
}
const at = (uid: string, designator: string, module: string, x = 0, y = 0, extra: Partial<PartInstance> = {}): PartInstance =>
  ({ uid, designator, module, x, y, rotation: 0, ...extra })
/** A plug-in device placed so its pivot sits on the centre of the outlet's first socket. */
function onOutlet(uid: string, designator: string, module: string, outlet: PartInstance, mount = true): PartInstance {
  const om = load(outlet.module)
  const s = mainsOf(om).sockets[0]
  const holes = new Map((om.holes ?? []).map((h) => [h.name, h.at]))
  const [[lx, ly]] = holes.get(s.contacts.find((c) => c.role === 'L')!.group)!
  const [[px, py]] = SOCKET_PATTERNS[s.family].L
  const c = pivot(layoutModule(load(module)).w, layoutModule(load(module)).h)
  return at(uid, designator, module, outlet.x + lx - px - c.x, outlet.y + ly - py - c.y, mount ? { mount: { board: outlet.uid } } : {})
}
const rules = (d: Diagram) => [...new Set(checkDiagram(d).map((f) => f.rule))].sort()

describe('the spec circuits on built-in parts', () => {
  // Ruling B2 (Michael, 2026-09-27): the Songle relay and the Hi-Link modules state no insulation class, so their
  // low-voltage sides count as live when mains is present: these circuits report rule-1 errors with the
  // unknown-isolation wording. The clean AC-DC circuit uses a Mean Well IRM module (Class II stated).
  it('relay switching a fused lamp from a US outlet with stripped 18 AWG wires: rule-1 errors because the relay module\'s isolation is unknown', () => {
    const xs = at('xs1', 'XS1', 'outlet-us-5-15r-duplex')
    const e26 = load('lamp-holder-e26')
    const earthed = mainsOf(e26).requirement.get('PE') === 'PE'
    const d = sheet([
      xs, onOutlet('xp1', 'XP1', 'plug-us-5-15p', xs),
      at('f1', 'F1', 'fuse-holder-5x20-inline', 300, 0, { values: { fuseRating: { value: 2, unit: 'A' } } }),
      at('k1', 'K1', 'relay-module-1ch-5v', 500), at('e1', 'E1', 'lamp-holder-e26', 800), at('u1', 'U1', 'esp32-devkit-v1-30', 500, 300),
    ], [
      stripped('xp1|L', 'f1|1'), stripped('f1|2', 'k1|COM'), stripped('k1|NO', 'e1|L'), stripped('e1|N', 'xp1|N'),
      ...(earthed ? [stripped('xp1|PE', 'e1|PE')] : []),
      dc('k1|DC+', 'u1|VIN'), dc('k1|DC-', 'u1|GND'), dc('k1|IN', 'u1|D23'),
    ])
    expect(rules(d)).toEqual(['cable-unverified', 'mains-to-low-voltage', 'rating-unverified'])
    const lv = checkDiagram(d).filter((f) => f.rule === 'mains-to-low-voltage')
    expect(lv.length).toBeGreaterThan(0)
    // Task 6 words a relay's barrier by its sides (mainsRules.test.ts pins it); the plan's converter wording predates that.
    for (const f of lv) expect([f.severity, f.message]).toEqual(['error', expect.stringContaining("K1's insulation between its coil and its contacts is unknown")])
    expect(checkDiagram(d).filter((f) => f.rule === 'rating-unverified').every((f) => f.subject === 'K1')).toBe(true)
  })
  it('Fotek SSR-25DA switching a fused lamp from a US outlet, driven by an ESP32: rule-1 errors because the SSR\'s isolation is unknown', () => {
    const xs = at('xs1', 'XS1', 'outlet-us-5-15r-duplex')
    const d = sheet([
      xs, onOutlet('xp1', 'XP1', 'plug-us-5-15p', xs),
      at('f1', 'F1', 'fuse-holder-5x20-inline', 300, 0, { values: { fuseRating: { value: 2, unit: 'A' } } }),
      at('k1', 'K1', 'ssr-fotek-25da', 500), at('e1', 'E1', 'lamp-holder-e26', 800), at('u1', 'U1', 'esp32-devkit-v1-30', 500, 300),
    ], [
      stripped('xp1|L', 'f1|1'), stripped('f1|2', 'k1|1'), stripped('k1|2', 'e1|L'), stripped('e1|N', 'xp1|N'),
      dc('k1|3', 'u1|D23'), dc('k1|4', 'u1|GND'),
    ])
    const found = checkDiagram(d)
    expect(rules(d)).toContain('mains-to-low-voltage')
    const lv = found.filter((f) => f.rule === 'mains-to-low-voltage')
    expect(lv.length).toBeGreaterThan(0)
    for (const f of lv) expect([f.severity, f.message]).toEqual(['error', expect.stringContaining("K1's insulation between its control side and its load side is unknown")])
    // The ESP32's GPIO and ground are named, each once, even though the board has two pins labelled GND.
    for (const f of lv) expect(f.message).not.toMatch(/U1 GND and U1 GND/)
    expect(lv.some((f) => f.message.includes('K1 4 and U1 GND may be live'))).toBe(true)
  })
  it('HLK-PM01 feeding an ESP32: rule-1 errors because the HLK-PM01\'s isolation is unknown', () => {
    const xs = at('xs1', 'XS1', 'outlet-us-5-15r-duplex')
    const d = sheet([xs, onOutlet('xp1', 'XP1', 'plug-us-5-15p', xs), at('ps1', 'PS1', 'hlk-pm01', 300), at('u1', 'U1', 'esp32-cam', 600)], [
      stripped('xp1|L', 'ps1|AC 1'), stripped('xp1|N', 'ps1|AC 2'), dc('ps1|+Vo', 'u1|5V'), dc('ps1|-Vo', 'u1|GND'),
    ])
    expect(rules(d)).toEqual(['cable-unverified', 'mains-to-low-voltage'])
    const lv = checkDiagram(d).filter((f) => f.rule === 'mains-to-low-voltage')
    expect(lv.length).toBeGreaterThan(0)
    for (const f of lv) expect([f.severity, f.message]).toEqual(['error', expect.stringContaining("PS1's low-voltage side is separated from mains only by insulation of unknown quality")])
  })
  it('Mean Well IRM-03-5 feeding an ESP32 (clean apart from cable-unverified)', () => {
    const xs = at('xs1', 'XS1', 'outlet-us-5-15r-duplex')
    const d = sheet([xs, onOutlet('xp1', 'XP1', 'plug-us-5-15p', xs), at('ps1', 'PS1', 'irm-03-5', 300), at('u1', 'U1', 'esp32-cam', 600)], [
      stripped('xp1|L', 'ps1|AC/L'), stripped('xp1|N', 'ps1|AC/N'), dc('ps1|+V', 'u1|5V'), dc('ps1|-V', 'u1|GND'),
    ])
    expect(rules(d)).toEqual(['cable-unverified'])
  })
  it('HLK-PM01 unpowered', () => {
    const d = sheet([at('ps1', 'PS1', 'hlk-pm01'), at('u1', 'U1', 'esp32-cam', 300)], [dc('ps1|+Vo', 'u1|5V'), dc('ps1|-Vo', 'u1|GND')])
    const found = checkDiagram(d).filter((f) => f.rule === 'no-power').map((f) => f.message)
    expect(found[0]).toBe('PS1 has no mains input, so its outputs supply nothing. Wire AC 1 and AC 2 to L and N of one outlet.')
    expect(found.some((m) => m.startsWith('U1 has no power'))).toBe(true)
  })
  it('US charger over a UK outlet (does not seat; plug-mismatch)', () => {
    const xs = at('xs1', 'XS1', 'outlet-uk-bs1363')
    const d = sheet([xs, at('ps1', 'PS1', 'charger-usb-5v-us', 10, 10)], [])
    expect(checkDiagram(d).filter((f) => f.rule === 'plug-mismatch').map((f) => f.message)).toEqual([
      "PS1's US/Japanese plug does not fit XS1's UK socket. Use a device with a UK plug.",
    ])
  })
})

describe('the Fotek SSR control input (4-32 VDC)', () => {
  // Ruling 48: the checker must never flag a working circuit, so input 3 is a plain signal input. No
  // module states its GPIO voltage, so the 4-32 VDC range (in the part's name) is not checked yet:
  // neither a 5 V Nano GPIO (works) nor a 3.3 V ESP32 GPIO (below the 3.5 VDC turn-off) gets a finding.
  const ssrFrom = (board: string, gpio: string) =>
    sheet([at('k1', 'K1', 'ssr-fotek-25da'), at('u1', 'U1', board, 300)], [dc('k1|3', `u1|${gpio}`), dc('k1|4', 'u1|GND')])
  it('driven from a 5 V Nano GPIO: no finding on K1', () => {
    expect(checkDiagram(ssrFrom('arduino-nano', 'D2')).filter((f) => f.subject === 'K1')).toEqual([])
  })
  it('driven from a 3.3 V ESP32 GPIO: no finding on K1 (not checked yet)', () => {
    expect(checkDiagram(ssrFrom('esp32-devkit-v1-30', 'D23')).filter((f) => f.subject === 'K1')).toEqual([])
  })
})
