// The mains rules (spec section 3), each both ways, and the counterexamples of Astra's reviews.
import { describe, expect, it } from 'vitest'
import { checkDiagram, type Finding } from './checks.ts'
import type { Diagram } from './diagram.ts'
import { MAINS_MODULES, at, dupont, sheet, w } from './mains.testing.ts'

const only = (d: Diagram, rule: string): Finding[] => checkDiagram(d).filter((f) => f.rule === rule)
const msgs = (d: Diagram, rule: string) => only(d, rule).map((f) => f.message)
const rules = (d: Diagram) => new Set(checkDiagram(d).map((f) => f.rule))
/** Outlet XS1 plus the given parts, placed apart. */
const on = (parts: [string, string, string][], wires: ReturnType<typeof w>[], outlets = [['xs1', 'XS1', 't-outlet']]) =>
  sheet([...outlets, ...parts].map(([uid, des, m], i) => at(uid, des, m, i * 200)), wires)

describe('rule 1: mains on low-voltage wiring', () => {
  it('OFF SSR into a lamp into a GPIO (hazard reaches the GPIO), highlighting the whole energizing path', () => {
    const path = [w('xs1|L', 'k1|1'), w('k1|2', 'e1|L'), w('e1|N', 'u1|IO')]
    const d = on([['k1', 'K1', 't-ssr'], ['e1', 'E1', 't-lamp'], ['u1', 'U1', 't-mcu']], path)
    const found = only(d, 'mains-to-low-voltage')
    expect(found.map((f) => f.message)).toEqual([
      'U1 IO gets mains from XS1 (120 V). U1 is a low-voltage part: it may be destroyed, and anything touching it may become live. Remove the wire that brings mains there, and switch mains only through a relay or SSR rated for it.',
    ])
    // Through the SSR's leakage and the lamp, back to the outlet's L: every wire on the way.
    expect([...found[0].wires].sort()).toEqual(path.map((c) => c.uid).sort())
  })
  it('basic-isolation secondary to a GPIO (error, bonded or not)', () => {
    for (const psu of ['t-psu-basic', 't-psu-basic-bonded']) {
      const d = on([['ps1', 'PS1', psu], ['u1', 'U1', 't-mcu']],
        [w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2'), w('ps1|+V', 'u1|IO'), ...(psu.endsWith('bonded') ? [w('xs1|PE', 'ps1|PE')] : [])])
      const found = only(d, 'mains-to-low-voltage')
      expect(found.map((f) => f.target)).toContain('PS1 +V')
      expect(found.find((f) => f.target === 'PS1 +V')!.message).toBe(
        "PS1's low-voltage side is separated from mains only by basic insulation, so PS1 +V and U1 IO may be live: that side counts as mains. Do not wire it to anything a person can touch; use a converter with reinforced or double isolation.",
      )
    }
  })
  it('basic plus a declared protective screen and PE bond (PELV, allowed, DC checks kept)', () => {
    const d = on([['ps1', 'PS1', 't-psu-screen'], ['u1', 'U1', 't-mcu33']],
      [w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2'), w('xs1|PE', 'ps1|PE'), w('ps1|+V', 'u1|VCC'), w('ps1|-V', 'u1|GND')])
    expect(rules(d).has('mains-to-low-voltage')).toBe(false)
    // A 5 V output into a 3.3 V input: the DC checker still says so on a PELV output.
    expect(msgs(d, 'supply-too-high')).toEqual(['U1 VCC accepts up to 3.3 V but gets 5 V from PS1 +V. Use a 3.3 V supply instead.'])
  })
  it('reinforced with a PE bond (PELV)', () => {
    const d = on([['ps1', 'PS1', 't-psu-pelv'], ['u1', 'U1', 't-mcu']],
      [w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2'), w('xs1|PE', 'ps1|PE'), w('ps1|+V', 'u1|VCC'), w('ps1|-V', 'u1|GND')])
    expect(rules(d).has('mains-to-low-voltage')).toBe(false)
    expect(rules(d).has('earth-bond')).toBe(false)
  })
})

describe('rule 1: each source keeps its own claim (Resolution 24)', () => {
  it('a GPIO on a relay between XS1 (120 V) and XS2 (230 V): two findings, each with its conditions and path', () => {
    const nc = w('xs1|L', 'k1|NC')
    const no = w('xs2|L', 'k1|NO')
    const gpio = w('k1|COM', 'u1|IO')
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('xs2', 'XS2', 't-outlet-2', 0, 200, { values: { acVoltage: { value: 230, unit: 'VAC' } } }), at('k1', 'K1', 't-relay', 200), at('u1', 'U1', 't-mcu', 400)], [nc, no, gpio])
    const found = only(d, 'mains-to-low-voltage')
    const tail = 'U1 is a low-voltage part: it may be destroyed, and anything touching it may become live. Remove the wire that brings mains there, and switch mains only through a relay or SSR rated for it.'
    expect(found.map((f) => f.message).sort()).toEqual([
      `U1 IO gets mains from XS1 (120 V) when K1 is released. ${tail}`,
      `U1 IO gets mains from XS2 (230 V) when K1 is energized. ${tail}`,
    ])
    const wiresOf = (src: string) => [...found.find((f) => f.message.includes(src))!.wires].sort()
    expect(wiresOf('XS1')).toEqual([nc.uid, gpio.uid].sort())
    expect(wiresOf('XS2')).toEqual([no.uid, gpio.uid].sort())
  })
  it('names the effective class, never the label (Resolution 9)', () => {
    const says = (d: Diagram, cls: string) => msgs(d, 'mains-to-low-voltage').some((m) => m.startsWith(`PS1 +V is on a ${cls} low-voltage side`))
    // A PELV label with no bond at all: SELV in effect.
    expect(says(on([['ps1', 'PS1', 't-psu-mislabeled']], [w('xs1|L', 'ps1|+V')]), 'SELV')).toBe(true)
    // A declared bond that is not connected to earth: SELV in effect.
    expect(says(on([['ps1', 'PS1', 't-psu-pelv']], [w('xs1|L', 'ps1|+V')]), 'SELV')).toBe(true)
    // The same part with its bond on earth: PELV.
    expect(says(on([['ps1', 'PS1', 't-psu-pelv']], [w('xs1|L', 'ps1|+V'), w('xs1|PE', 'ps1|PE')]), 'PELV')).toBe(true)
  })
  it('a bond earthed through a switch: PELV only when it is closed, each stated as a condition', () => {
    const d = on([['ps1', 'PS1', 't-psu-pelv'], ['s1', 'S1', 't-switch']], [w('xs1|L', 'ps1|+V'), w('xs1|PE', 's1|1'), w('s1|2', 'ps1|PE')])
    const tail = 'Remove the wire that joins it to mains.'
    expect(msgs(d, 'mains-to-low-voltage').sort()).toEqual([
      `PS1 +V is on a PELV low-voltage side that must never meet mains, but gets mains from XS1 (120 V) when S1 is on. ${tail}`,
      `PS1 +V is on a SELV low-voltage side that must never meet mains, but gets mains from XS1 (120 V) when S1 is off. ${tail}`,
    ])
  })
})

describe('rule 2: mains shorts', () => {
  it('L to N of one outlet', () => {
    expect(msgs(on([], [w('xs1|L', 'xs1|N')]), 'mains-short')).toEqual([
      'XS1 L and N are joined: a short circuit across the outlet. The breaker should trip; until it does, the wiring may overheat. Remove the wire that joins them.',
    ])
  })
  it('L to PE of one outlet', () => {
    expect(msgs(on([], [w('xs1|L', 'xs1|PE')]), 'mains-short')).toEqual([
      'XS1 L is joined to earth: a short circuit to earth, which puts mains on everything earthed until the breaker trips. Remove the wire that joins them.',
    ])
  })
  it('names an OFF condition the short needs: L-S1-K1.COM, K1.NC to N, when K1 is released and S1 is on', () => {
    const wires = [w('xs1|L', 's1|1'), w('s1|2', 'k1|COM'), w('k1|NC', 'xs1|N')]
    const d = on([['s1', 'S1', 't-switch'], ['k1', 'K1', 't-relay']], wires)
    const found = only(d, 'mains-short')
    expect(found.map((f) => f.message)).toEqual([
      'XS1 L and N are joined when K1 is released and S1 is on: a short circuit across the outlet. The breaker should trip; until it does, the wiring may overheat. Remove the wire that joins them.',
    ])
    expect([...found[0].wires].sort()).toEqual(wires.map((c) => c.uid).sort())
  })
  it('relay COM-NO and COM-NC both wired (each state, no impossible short)', () => {
    // L on NO, N on NC: a short would need COM on NO and NC at once, which a relay never does.
    const d = on([['k1', 'K1', 't-relay'], ['e1', 'E1', 't-lamp']],
      [w('xs1|L', 'k1|NO'), w('k1|NC', 'xs1|N'), w('k1|COM', 'e1|L'), w('e1|N', 'xs1|N')])
    expect(rules(d).has('mains-short')).toBe(false)
  })
  it('two switches in series closing a short with seven or more other groups present (found)', () => {
    const others = Array.from({ length: 7 }, (_, i) => i + 3)
    const d = on([
      ['s1', 'S1', 't-switch'], ['s2', 'S2', 't-switch'],
      ...others.flatMap((k): [string, string, string][] => [[`s${k}`, `S${k}`, 't-switch'], [`e${k}`, `E${k}`, 't-lamp']]),
    ], [
      w('xs1|L', 's1|1'), w('s1|2', 's2|1'), w('s2|2', 'xs1|N'),
      ...others.flatMap((k) => [w('xs1|L', `s${k}|1`), w(`s${k}|2`, `e${k}|L`), w(`e${k}|N`, 'xs1|N')]),
    ])
    expect(msgs(d, 'mains-short')).toEqual([
      'XS1 L and N are joined when S1 and S2 are both on: a short circuit across the outlet. The breaker should trip; until it does, the wiring may overheat. Remove the wire that joins them.',
    ])
  })
  it('three switches in series L-S1-S2-S3-N with S2 touching neither end (found via possible connectivity)', () => {
    const d = on([['s1', 'S1', 't-switch'], ['s2', 'S2', 't-switch'], ['s3', 'S3', 't-switch']],
      [w('xs1|L', 's1|1'), w('s1|2', 's2|1'), w('s2|2', 's3|1'), w('s3|2', 'xs1|N')])
    expect(msgs(d, 'mains-short')).toEqual([
      'XS1 L and N are joined when S1, S2 and S3 are on: a short circuit across the outlet. The breaker should trip; until it does, the wiring may overheat. Remove the wire that joins them.',
    ])
  })
})

describe('rule 3: two sources joined', () => {
  const two = [['xs1', 'XS1', 't-outlet'], ['xs2', 'XS2', 't-outlet-2']]
  it('L-L across outlets', () => {
    expect(msgs(on([], [w('xs1|L', 'xs2|L')], two), 'mains-cross-source')).toEqual([
      'XS1 L and XS2 L are joined. The two outlets may be on different phases, so up to twice the mains voltage can appear across the wiring, or one phase is shorted to the other. Power this part of the circuit from one outlet.',
    ])
  })
  it('L-N, L-PE and N-PE across outlets are errors', () => {
    expect(msgs(on([], [w('xs1|L', 'xs2|N')], two), 'mains-cross-source')).toEqual([
      'XS1 L is joined to XS2 N: current from one outlet returns through the other, which can overload a shared neutral or get past a breaker. Power this part of the circuit from one outlet.',
    ])
    expect(msgs(on([], [w('xs1|L', 'xs2|PE')], two), 'mains-cross-source')).toEqual([
      "XS1 L is joined to XS2's earth: a short circuit to earth from another outlet. Remove the wire that joins them.",
    ])
    expect(msgs(on([], [w('xs1|N', 'xs2|PE')], two), 'mains-cross-source')).toEqual([
      "XS1 N is joined to XS2's earth: neutral current flows on the earth wire. Keep each outlet's neutral apart from earth.",
    ])
  })
  it('N-N is a warning (shared neutral), PE-PE is allowed', () => {
    expect(msgs(on([], [w('xs1|N', 'xs2|N')], two), 'mains-shared-neutral')).toEqual([
      "XS1 N and XS2 N are joined: the two outlets share a neutral here. When a breaker switches one outlet off, its neutral can still carry current from the other. Keep each outlet's neutral separate.",
    ])
    const earth = on([], [w('xs1|PE', 'xs2|PE')], two)
    expect(rules(earth).has('mains-cross-source')).toBe(false)
    expect(rules(earth).has('mains-shared-neutral')).toBe(false)
  })
  it('two class 1 supplies with PE-bonded minus leads joined (no cross-source error)', () => {
    const d = on([['ps1', 'PS1', 't-psu-pelv'], ['ps2', 'PS2', 't-psu-pelv']], [
      w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2'), w('xs1|PE', 'ps1|PE'),
      w('xs2|L', 'ps2|AC1'), w('xs2|N', 'ps2|AC2'), w('xs2|PE', 'ps2|PE'),
      w('ps1|-V', 'ps2|-V'),
    ], two)
    expect(rules(d).has('mains-cross-source')).toBe(false)
    expect(rules(d).has('mains-shared-neutral')).toBe(false)
  })
})
