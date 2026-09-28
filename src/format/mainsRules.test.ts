// The mains rules (spec section 3), each both ways, and the counterexamples of Astra's reviews.
import { describe, expect, it } from 'vitest'
import { checkDiagram, type Finding } from './checks.ts'
import type { Diagram, PartInstance } from './diagram.ts'
import { load } from './builtinModules.testing.ts'
import { MAINS_MODULES, at, dupont, sheet, w } from './mains.testing.ts'
import { plugsOf } from './breadboard.ts'
import { netlist, nodeKey } from './netlist.ts'
import { type Prepared, analyseState, buildMainsGraph, candidateGroups, masksByPopcount, prepare, setState } from './mainsGraph.ts'
import { across, acrossFit, acrossWith, newAcc, visitState } from './mainsRules.ts'
import { analyseMains } from './mains.ts'

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

describe('rule 1: energy from N, the highlighted path, and wording by part (Ruling 33)', () => {
  const lvTail = 'U1 is a low-voltage part: it may be destroyed, and anything touching it may become live. Remove the wire that brings mains there, and switch mains only through a relay or SSR rated for it.'
  it('a GPIO through a lamp to N is live, on a Schuko and on a US outlet (N is a live conductor)', () => {
    for (const [outlet, lampId, v] of [['t-outlet-eu', 't-lamp-230', '230 V'], ['t-outlet', 't-lamp', '120 V']]) {
      const d = on([['e1', 'E1', lampId], ['u1', 'U1', 't-mcu']], [w('xs1|N', 'e1|L'), w('e1|N', 'u1|IO')], [['xs1', 'XS1', outlet]])
      expect(msgs(d, 'mains-to-low-voltage')).toEqual([`U1 IO gets mains from XS1 (${v}). ${lvTail}`])
    }
  })
  it('highlights every energizing path: the OFF SSR leakage from L as well as the lamp from N', () => {
    const wires = [w('xs1|L', 'k1|1'), w('k1|2', 'e1|L'), w('e1|N', 'u1|IO'), w('u1|IO', 'e2|L'), w('e2|N', 'xs1|N')]
    const d = on([['k1', 'K1', 't-ssr'], ['e1', 'E1', 't-lamp'], ['e2', 'E2', 't-lamp'], ['u1', 'U1', 't-mcu']], wires)
    const found = only(d, 'mains-to-low-voltage')
    expect(found.map((f) => f.message)).toEqual([`U1 IO gets mains from XS1 (120 V). ${lvTail}`])
    expect([...found[0].wires].sort()).toEqual(wires.map((c) => c.uid).sort())
  })
  it('highlights the ON path of a switched lamp whose L a GPIO sits on, across the states it holds in', () => {
    const toS1 = w('xs1|L', 's1|1')
    const wires = [toS1, w('s1|2', 'e1|L'), w('e1|N', 'xs1|N'), w('xs1|L', 'e2|L'), w('e2|N', 'xs1|N'), w('e1|L', 'u1|IO')]
    const d = on([['s1', 'S1', 't-switch'], ['e1', 'E1', 't-lamp'], ['e2', 'E2', 't-lamp'], ['u1', 'U1', 't-mcu']], wires)
    const found = only(d, 'mains-to-low-voltage')
    expect(found.map((f) => f.message)).toEqual([`U1 IO gets mains from XS1 (120 V). ${lvTail}`])
    expect(found[0].wires).toContain(toS1.uid)
    expect([...found[0].wires].sort()).toEqual(wires.map((c) => c.uid).sort())
  })
  it('highlights the switch that feeds the cause, never the branches of unrelated switched lamps', () => {
    const toS9 = w('xs1|L', 's9|1')
    const s9e1 = w('s9|2', 'e1|L')
    const others = [1, 2, 3].map((n) => [w('xs1|L', `s${n}|1`), w(`s${n}|2`, `f${n}|L`), w(`f${n}|N`, 'xs1|N')])
    const d = on([['e1', 'E1', 't-lamp'], ['e2', 'E2', 't-lamp'], ['u1', 'U1', 't-mcu'], ['s9', 'S9', 't-switch'],
      ...[1, 2, 3].flatMap((n): [string, string, string][] => [[`s${n}`, `S${n}`, 't-switch'], [`f${n}`, `E${n + 4}`, 't-lamp']])],
    [...others.flat(), toS9, s9e1, w('e1|N', 'u1|IO'), w('u1|IO', 'e2|L'), w('e2|N', 'xs1|N')].reverse())
    const found = only(d, 'mains-to-low-voltage')
    expect(found).toHaveLength(1)
    expect(found[0].wires).toEqual(expect.arrayContaining([toS9.uid, s9e1.uid]))
    for (const [, sf] of others) expect(found[0].wires).not.toContain(sf.uid)
  })
  it('says mains is wired onto a secondary directly when its own input carries none (through a lamp, input unwired)', () => {
    const d = on([['e1', 'E1', 't-lamp'], ['ps1', 'PS1', 't-psu-basic']], [w('xs1|L', 'e1|L'), w('e1|N', 'ps1|+V')])
    expect(msgs(d, 'mains-to-low-voltage')).toEqual([
      "PS1 +V gets mains from XS1 (120 V). Remove the wire that brings mains there. PS1's low-voltage side is also separated from mains only by basic insulation, so it counts as mains even without that wire: do not wire it to anything a person can touch; use a converter with reinforced or double isolation.",
    ])
  })
  it('says a wire brings mains onto a secondary directly, not only its insulation', () => {
    const d = on([['ps1', 'PS1', 't-psu-basic'], ['u1', 'U1', 't-mcu']], [w('xs1|L', 'ps1|+V'), w('ps1|+V', 'u1|IO')])
    expect(msgs(d, 'mains-to-low-voltage')).toEqual([
      "PS1 +V and U1 IO get mains from XS1 (120 V). U1 is a low-voltage part: it may be destroyed, and anything touching it may become live. Remove the wire that brings mains there. PS1's low-voltage side is also separated from mains only by basic insulation, so it counts as mains even without that wire: do not wire it to anything a person can touch; use a converter with reinforced or double isolation.",
    ])
  })
  it('words a relay coil or SSR control side by the module, never as a converter', () => {
    const relayD = on([['k1', 'K1', 't-relay-unknown'], ['u1', 'U1', 't-mcu']], [w('xs1|L', 'k1|COM'), w('k1|+', 'u1|VCC')])
    expect(msgs(relayD, 'mains-to-low-voltage')).toContain(
      "K1's insulation between its coil and its contacts is unknown, so K1 + and U1 VCC may be live: that side counts as mains. Do not wire it to anything a person can touch; use a relay or SSR whose datasheet states reinforced or double insulation.",
    )
    const ssrD = on([['k1', 'K1', 't-ssr-basic'], ['u1', 'U1', 't-mcu']], [w('xs1|L', 'k1|1'), w('k1|3', 'u1|IO')])
    expect(msgs(ssrD, 'mains-to-low-voltage')).toContain(
      "K1's insulation between its control side and its load side is only basic, so K1 3 and U1 IO may be live: that side counts as mains. Do not wire it to anything a person can touch; use a relay or SSR whose datasheet states reinforced or double insulation.",
    )
  })
  it("words a converter pin outside every domain by the missing data (Resolution 27)", () => {
    const d = on([['ps1', 'PS1', 't-psu-mainsonly'], ['u1', 'U1', 't-mcu']], [w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2'), w('ps1|+V', 'u1|VCC')])
    expect(msgs(d, 'mains-to-low-voltage')).toContain(
      "PS1's data does not state how PS1 +V is separated from mains, so PS1 +V and U1 VCC may be live: that pin counts as mains. Do not wire it to anything a person can touch; use a part whose datasheet states how every pin is separated from mains.",
    )
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
      'XS1 L is joined to earth: a short circuit to earth, which may put mains on everything earthed until the breaker trips. Remove the wire that joins them.',
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
      "XS1 N is joined to XS2's earth: neutral current may flow on the earth wire. Keep each outlet's neutral apart from earth.",
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

describe('rule 4: wrong mains voltage', () => {
  it('a 120 V lamp on a 230 V outlet', () => {
    const d = on([['e1', 'E1', 't-lamp']], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N')], [['xs1', 'XS1', 't-outlet-eu']])
    expect(msgs(d, 'mains-voltage')).toEqual(['E1 is made for 110 V to 130 V AC, but XS1 gives 230 V. Use one made for 230 V, or power it from an outlet it is made for.'])
  })
  it('names the condition when a switch decides it', () => {
    const d = on([['s1', 'S1', 't-switch'], ['e1', 'E1', 't-lamp']], [w('xs1|L', 's1|1'), w('s1|2', 'e1|L'), w('xs1|N', 'e1|N')], [['xs1', 'XS1', 't-outlet-eu']])
    expect(msgs(d, 'mains-voltage')).toEqual(['E1 is made for 110 V to 130 V AC, but XS1 gives 230 V when S1 is on. Use one made for 230 V, or power it from an outlet it is made for.'])
  })
  it('a converter whose range excludes the outlet voltage (set on the outlet)', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet', 0, 0, { values: { acVoltage: { value: 277, unit: 'VAC' } } }), at('ps1', 'PS1', 't-psu', 200)],
      [w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2')])
    expect(msgs(d, 'mains-voltage')).toEqual(['PS1 takes 100 V to 240 V AC, but XS1 gives 277 V. Use a converter made for 277 V.'])
  })
  it('a load without a voltage range says its voltage compatibility was not checked', () => {
    const noRange = { ...MAINS_MODULES['t-lamp'], id: 't-lamp-norange', electrical: { conducts: [{ pins: ['L', 'N'], kind: 'load' }], protection: 'class-2', ratings: [{ pins: ['L', 'N'], kind: 'terminal', service: 'ac', volts: 250, provenance: 'datasheet' }] } }
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('e1', 'E1', 't-lamp-norange', 200)], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N')], { 't-lamp-norange': noRange })
    expect(msgs(d, 'data-missing')).toEqual([
      "E1's module gives no voltage range, so whether XS1's 120 V suits it is not checked. Add its rated voltage (electrical.conducts range) from the datasheet.",
    ])
  })
  it('stays quiet inside the range', () => {
    expect(rules(on([['e1', 'E1', 't-lamp']], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N')])).has('mains-voltage')).toBe(false)
  })
  it('a shorted load (L and N joined across it) is not supplied: the short is the one finding', () => {
    const d = on([['e1', 'E1', 't-lamp']], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N'), w('e1|L', 'e1|N')], [['xs1', 'XS1', 't-outlet-eu']])
    expect(rules(d).has('mains-voltage')).toBe(false)
    expect(rules(d).has('mains-short')).toBe(true)
  })
})

describe('rule 4 helpers: L and N across a load, as drawn, with every holder fitted, and with one holder fitted (Resolution 28)', () => {
  const prepared = (d: Diagram): Prepared => {
    const plugs = plugsOf(d)
    return prepare(buildMainsGraph(d, plugs, netlist(d, plugs))!)
  }
  const at2 = (p: Prepared, part: string) => [p.g.nodeOf.get(nodeKey(part, 'L'))!, p.g.nodeOf.get(nodeKey(part, 'N'))!] as const
  it('an empty holder in series with a switch restores the lamp only when the switch is on', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('f1', 'F1', 't-fuse', 200, 0, { settings: { fuse: 'absent' } }), at('s1', 'S1', 't-switch', 400), at('e1', 'E1', 't-lamp', 600)],
      [w('xs1|L', 'f1|1'), w('f1|2', 's1|1'), w('s1|2', 'e1|L'), w('e1|N', 'xs1|N')])
    const p = prepared(d)
    const [a, b] = at2(p, 'e1')
    const holder = p.protective[0]
    for (const on of [0, 1]) {
      p.groupState.fill(on)
      analyseState(p)
      expect(across(p, a, b)).toBe(null)
      expect(acrossFit(p, a, b)).toBe(on === 1)
      expect(acrossWith(p, holder, a, b)).toBe(on === 1)
    }
  })
  it('records per load: supplied as drawn, with every holder fitted, and the one holder that alone restores it', () => {
    const run = (holders: string[]) => {
      const parts = [at('xs1', 'XS1', 't-outlet'), ...holders.map((h, i) => at(h, h.toUpperCase(), 't-fuse', 200 + i * 100, 0, { settings: { fuse: 'absent' } })), at('s1', 'S1', 't-switch', 600), at('e1', 'E1', 't-lamp', 800)]
      const chain = ['xs1|L', ...holders.flatMap((h) => [`${h}|1`, `${h}|2`]), 's1|1']
      const wires = [...chain.flatMap((x, i) => (i % 2 === 0 ? [w(x, chain[i + 1])] : [])), w('s1|2', 'e1|L'), w('e1|N', 'xs1|N')]
      const p = prepared(sheet(parts, wires))
      const cands = candidateGroups(p.g, p.possible)
      const acc = newAcc(p, cands, null)
      for (const mask of masksByPopcount(cands.length)) {
        setState(p, cands, mask)
        analyseState(p)
        visitState(acc, mask)
      }
      return { complete: acc.loadComplete[0], fit: acc.loadFit[0], fixers: [...(acc.loadFixers.get(0) ?? [])].map((x) => x.designator) }
    }
    expect(run(['f1'])).toEqual({ complete: 0, fit: 1, fixers: ['F1'] })
    // Two empty holders in series: neither alone restores it, so none is named.
    expect(run(['f1', 'f2'])).toEqual({ complete: 0, fit: 1, fixers: [] })
  })
  it('a load whose L and N sit on one net is not across a source', () => {
    const p = prepared(sheet([at('xs1', 'XS1', 't-outlet'), at('e1', 'E1', 't-lamp', 200)], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N'), w('e1|L', 'e1|N')]))
    analyseState(p)
    const [a, b] = at2(p, 'e1')
    expect(across(p, a, b)).toBe(null)
    const cands = candidateGroups(p.g, p.possible)
    const acc = newAcc(p, cands, null)
    visitState(acc, 0)
    expect(acc.loadComplete[0]).toBe(0)
  })
  it('across names the source either way round', () => {
    const p = prepared(sheet([at('xs1', 'XS1', 't-outlet'), at('e1', 'E1', 't-lamp', 200)], [w('xs1|N', 'e1|L'), w('xs1|L', 'e1|N')]))
    analyseState(p)
    const [a, b] = at2(p, 'e1')
    expect(across(p, a, b)).toBe(0)
    expect(across(p, b, a)).toBe(0)
    // No holder is empty, so nothing is claimed about fitting one.
    expect(acrossFit(p, a, b)).toBe(false)
  })
})

describe('rule 5: ratings, relevance before adequacy', () => {
  const eu = [['xs1', 'XS1', 't-outlet-eu']]
  it('125 VAC terminal on 230 VAC (mains-rating, not rule 1)', () => {
    const d = on([['x1', 'X1', 't-term-125']], [w('xs1|L', 'x1|1')], eu)
    expect(msgs(d, 'mains-rating')).toEqual(['X1 1 and X1 1b are rated 125 V AC, but get 230 V. Use a part rated for at least 230 V AC.'])
    expect(rules(d).has('mains-to-low-voltage')).toBe(false)
  })
  it('mains-domain terminal with no rating (rating-unknown, not rule 1)', () => {
    const d = on([['x1', 'X1', 't-term-bare']], [w('xs1|L', 'x1|1')], eu)
    expect(msgs(d, 'rating-unknown')).toEqual([
      "X1 1 and X1 1b are on mains (230 V), but X1's module gives no AC rating for them, so Circuitoon cannot tell whether they are safe there. Check the datasheet for an AC rating of at least 230 V.",
    ])
    expect(rules(d).has('mains-to-low-voltage')).toBe(false)
  })
  it('300 VDC-only terminal on 230 VAC (rating)', () => {
    const d = on([['x1', 'X1', 't-term-dc']], [w('xs1|L', 'x1|1')], eu)
    expect(msgs(d, 'rating-unknown')).toEqual([
      "X1 1 and X1 1b are on mains (230 V), but X1's module gives only a DC rating for them, so Circuitoon cannot tell whether they are safe there. Check the datasheet for an AC rating of at least 230 V.",
    ])
    expect(rules(d).has('mains-rating')).toBe(false)
    expect(rules(d).has('mains-to-low-voltage')).toBe(false)
  })
  it('an AC/DC rating (as IEC 60664 ratings are recorded) counts for AC', () => {
    const acdc = { ...MAINS_MODULES['t-term'], id: 't-term-acdc', electrical: { ratings: [{ pins: ['1', '2', '1b', '2b'], kind: 'terminal', service: 'ac/dc', volts: 300, provenance: 'datasheet' }] } }
    const d = sheet([at('xs1', 'XS1', 't-outlet-eu'), at('x1', 'X1', 't-term-acdc', 200)], [w('xs1|L', 'x1|1')], { 't-term-acdc': acdc })
    for (const r of ['mains-rating', 'rating-unknown', 'rating-conditional', 'rating-unverified'] as const) expect(rules(d).has(r)).toBe(false)
  })
  it('a contact that switches mains needs a switching rating, not a terminal one', () => {
    const swTerm = { ...MAINS_MODULES['t-switch'], id: 't-switch-term', electrical: { contacts: [{ id: 's', kind: 'switch', poles: [{ com: '1', no: '2' }] }], ratings: [{ pins: ['1', '2'], kind: 'terminal', service: 'ac', volts: 250, provenance: 'datasheet' }] } }
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('s1', 'S1', 't-switch-term', 200)], [w('xs1|L', 's1|1')], { 't-switch-term': swTerm })
    expect(msgs(d, 'rating-unknown')).toEqual([
      "S1 1 and S1 2 switch mains (120 V), but S1's module gives no AC switching rating for them, so Circuitoon cannot tell whether they are safe there. Check the datasheet for an AC switching rating of at least 120 V.",
    ])
  })
  it('a passive terminal with only an AC switching rating has no AC terminal or insulation rating', () => {
    const m = { ...MAINS_MODULES['t-term'], id: 't-term-sw', electrical: { ratings: [{ pins: ['1', '2', '1b', '2b'], kind: 'switching', service: 'ac', volts: 250, provenance: 'datasheet' }] } }
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('x1', 'X1', 't-term-sw', 200)], [w('xs1|L', 'x1|1')], { 't-term-sw': m })
    expect(msgs(d, 'rating-unknown')).toEqual([
      "X1 1 and X1 1b are on mains (120 V), but X1's module gives no AC terminal or insulation rating for them, so Circuitoon cannot tell whether they are safe there. Check the datasheet for an AC terminal or insulation rating of at least 120 V.",
    ])
  })
  it('a contact with only DC ratings switches mains with no AC switching rating', () => {
    const m = { ...MAINS_MODULES['t-switch'], id: 't-switch-dc', electrical: { contacts: [{ id: 's', kind: 'switch', poles: [{ com: '1', no: '2' }] }], ratings: [{ pins: ['1', '2'], kind: 'switching', service: 'dc', volts: 30, provenance: 'datasheet' }] } }
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('s1', 'S1', 't-switch-dc', 200)], [w('xs1|L', 's1|1')], { 't-switch-dc': m })
    expect(msgs(d, 'rating-unknown')).toEqual([
      "S1 1 and S1 2 switch mains (120 V), but S1's module gives no AC switching rating for them, so Circuitoon cannot tell whether they are safe there. Check the datasheet for an AC switching rating of at least 120 V.",
    ])
  })
  it('names both routes when a conditional datasheet rating and an unverified plain one would each do', () => {
    const all = ['1', '2', '1b', '2b']
    const m = { ...MAINS_MODULES['t-term'], id: 't-term-two', name: 'Test terminal block, two ratings', electrical: { ratings: [
      { pins: all, kind: 'terminal', service: 'ac', volts: 300, provenance: 'datasheet', conditions: 'for overvoltage category III and pollution degree 2' },
      { pins: all, kind: 'terminal', service: 'ac', volts: 250, provenance: 'unverified' },
    ] } }
    const d = sheet([at('xs1', 'XS1', 't-outlet-eu'), at('x1', 'X1', 't-term-two', 200)], [w('xs1|L', 'x1|1')], { 't-term-two': m })
    expect(checkDiagram(d).filter((f) => f.subject === 'X1').map((f) => `${f.rule}: ${f.message}`)).toEqual([
      "rating-conditional: X1's 300 V AC rating holds only for overvoltage category III and pollution degree 2, and its 250 V AC rating, which has no conditions, is not verified for this exact part (Test terminal block, two ratings). Circuitoon cannot confirm either from the drawing: check the conditions on the real build, or check the maker's data for the part you use.",
    ])
  })
  it('conditional Phoenix rating (rating-conditional)', () => {
    const d = on([['x1', 'X1', 't-term-cond']], [w('xs1|L', 'x1|1')], eu)
    expect(msgs(d, 'rating-conditional')).toEqual([
      "X1's 300 V AC rating holds only for overvoltage category III and pollution degree 2. Circuitoon cannot see that on the drawing: check it on the real build.",
    ])
  })
  it('an unverified rating warns, an adequate datasheet rating is silent', () => {
    expect(msgs(on([['x1', 'X1', 't-term-unverified']], [w('xs1|L', 'x1|1')], eu), 'rating-unverified')).toEqual([
      "X1's 300 V AC rating is not verified for this exact part (Test terminal block clone). Check the maker's data for the part you use.",
    ])
    const ok = on([['x1', 'X1', 't-term']], [w('xs1|L', 'x1|1')], eu)
    for (const r of ['mains-rating', 'rating-unknown', 'rating-conditional', 'rating-unverified'] as const) expect(rules(ok).has(r)).toBe(false)
  })
  it("an outlet's own terminals are checked against the voltage set on it", () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet', 0, 0, { values: { acVoltage: { value: 230, unit: 'VAC' } } })], [])
    // PE is not hazardous (spec 1.2), so only L and N are judged.
    expect(msgs(d, 'mains-rating')).toEqual(['XS1 L and XS1 N are rated 125 V AC, but get 230 V. Use a part rated for at least 230 V AC.'])
  })
  it('an unverified isolation class warns while the part is on mains (Resolution 26)', () => {
    const clone = { ...MAINS_MODULES['t-relay'], id: 't-relay-clone', name: 'Test relay clone', electrical: { ...(MAINS_MODULES['t-relay'].electrical as Record<string, unknown>), isolationProvenance: 'unverified' } }
    const parts = [at('xs1', 'XS1', 't-outlet'), at('k1', 'K1', 't-relay-clone', 200)]
    expect(rules(sheet(parts, [], { 't-relay-clone': clone })).has('rating-unverified')).toBe(false)
    expect(msgs(sheet(parts, [w('xs1|L', 'k1|COM')], { 't-relay-clone': clone }), 'rating-unverified')).toEqual([
      "K1's insulation between its coil and its contacts is not verified for this exact part (Test relay clone). Check the maker's data for the part you use.",
    ])
  })
})

describe('rule 12: missing mains data', () => {
  it("a converter's outputs outside every domain are taken as live, and named", () => {
    const d = on([['ps1', 'PS1', 't-psu-mainsonly'], ['u1', 'U1', 't-mcu']], [w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2'), w('ps1|+V', 'u1|IO')])
    expect(msgs(d, 'data-missing')).toEqual([
      "PS1's module leaves +V and -V outside every domain (electrical.domains), so the checks treat them as live. Add its domains and isolation from the datasheet.",
    ])
    expect(rules(d).has('mains-to-low-voltage')).toBe(true)
  })
  it('a mains terminal with no conduction data is checked conservatively and says so', () => {
    const d = on([['u1', 'U1', 't-undeclared']], [w('xs1|L', 'u1|A')])
    expect(msgs(d, 'data-missing')).toEqual([
      "U1's module does not say how A and B conduct, so the mains checks assume the worst for them: mains on any of them reaches the others. Add conduction data to its module (electrical.internal, conducts, contacts or protective).",
    ])
  })
  it('says nothing while the part is off mains', () => {
    expect(rules(on([['ps1', 'PS1', 't-psu-mainsonly'], ['u1', 'U1', 't-undeclared']], [])).has('data-missing')).toBe(false)
  })
})

describe('rule 6: polarity', () => {
  const shell = 'Its screw shell is then live, so touching it while changing the bulb may shock.'
  it('polarized lamp reversed (polarity, not short), with its declared hazard, highlighting the wires that reverse it', () => {
    const wires = [w('xs1|N', 'e1|L'), w('xs1|L', 'e1|N')]
    const d = on([['e1', 'E1', 't-lamp']], wires)
    const found = only(d, 'polarity')
    expect(found.map((f) => f.message)).toEqual([`E1 is wired the wrong way round: E1 L is on N and E1 N is on L. ${shell} Swap the L and N wires to E1.`])
    expect([...found[0].wires].sort()).toEqual(wires.map((c) => c.uid).sort())
    expect(rules(d).has('mains-short')).toBe(false)
  })
  it('a part that declares no polarity hazard is only told to swap', () => {
    const d = on([['e1', 'E1', 't-lamp-c1']], [w('xs1|N', 'e1|L'), w('xs1|L', 'e1|N'), w('xs1|PE', 'e1|PE')])
    expect(msgs(d, 'polarity')).toEqual(['E1 is wired the wrong way round: E1 L is on N and E1 N is on L. Swap the L and N wires to E1.'])
  })
  it('only one terminal on the wrong conductor', () => {
    expect(msgs(on([['e1', 'E1', 't-lamp']], [w('xs1|L', 'e1|L'), w('xs1|L', 'e1|N')]), 'polarity')).toEqual([`E1 N should be on N but is on L. ${shell} Swap the L and N wires to E1.`])
    expect(msgs(on([['e1', 'E1', 't-lamp']], [w('xs1|N', 'e1|L'), w('xs1|N', 'e1|N')]), 'polarity')).toEqual(['E1 L should be on L but is on N. Swap the L and N wires to E1.'])
  })
  it('a switched lamp wired the wrong way round: each claim keeps its own condition', () => {
    const d = on([['s1', 'S1', 't-switch'], ['e1', 'E1', 't-lamp']], [w('xs1|L', 's1|1'), w('s1|2', 'e1|N'), w('e1|L', 'xs1|N')])
    expect(msgs(d, 'polarity')).toEqual([
      'E1 L should be on L but is on N when S1 is off. Swap the L and N wires to E1.',
      `E1 is wired the wrong way round when S1 is on: E1 L is on N and E1 N is on L. ${shell} Swap the L and N wires to E1.`,
    ])
  })
  it('a correctly wired lamp on a polarized outlet says nothing', () => {
    expect(rules(on([['e1', 'E1', 't-lamp']], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N')])).has('polarity')).toBe(false)
  })
  it('a single-pole switch in the neutral (its own state is not a condition), highlighting the loop it sits in', () => {
    const wires = [w('xs1|L', 'e1|L'), w('e1|N', 's1|1'), w('s1|2', 'xs1|N')]
    const d = on([['s1', 'S1', 't-switch'], ['e1', 'E1', 't-lamp']], wires)
    const found = only(d, 'polarity')
    expect(found.map((f) => f.message)).toEqual(['S1 switches the neutral: with S1 off, what it feeds stays live. Move S1 into the L wire.'])
    expect([...found[0].wires].sort()).toEqual(wires.map((c) => c.uid).sort())
  })
  it('a switch that is in the neutral only when a relay selects it names that condition', () => {
    const d = on([['k1', 'K1', 't-relay'], ['s1', 'S1', 't-switch'], ['e1', 'E1', 't-lamp']],
      [w('xs1|L', 'e1|L'), w('e1|N', 's1|1'), w('s1|2', 'k1|NC'), w('k1|COM', 'xs1|N')])
    expect(msgs(d, 'polarity').sort()).toEqual([
      'K1 switches the neutral: with K1 energized, what it feeds stays live. Move K1 into the L wire.',
      'S1 switches the neutral when K1 is released: with S1 off, what it feeds stays live. Move S1 into the L wire.',
    ])
  })
  it('a changeover whose two throws are both wired keeps its position as a condition', () => {
    const d = on([['k1', 'K1', 't-relay'], ['e1', 'E1', 't-lamp'], ['e2', 'E2', 't-lamp']],
      [w('xs1|L', 'e1|L'), w('xs1|L', 'e2|L'), w('e1|N', 'k1|NC'), w('e2|N', 'k1|NO'), w('k1|COM', 'xs1|N')])
    expect(msgs(d, 'polarity')).toEqual(['K1 switches the neutral: whatever it disconnects stays live. Move K1 into the L wire.'])
    const one = on([['k1', 'K1', 't-relay'], ['e1', 'E1', 't-lamp'], ['u1', 'U1', 't-mcu']],
      [w('xs1|L', 'e1|L'), w('e1|N', 'k1|NC'), w('k1|NO', 'u1|GND'), w('k1|COM', 'xs1|N')])
    expect(msgs(one, 'polarity')).toEqual(['K1 switches the neutral when K1 is released: whatever it disconnects stays live. Move K1 into the L wire.'])
  })
  it('a changeover relay whose NC is unwired counts as single-pole', () => {
    const d = on([['k1', 'K1', 't-relay'], ['e1', 'E1', 't-lamp']], [w('xs1|L', 'e1|L'), w('e1|N', 'k1|NO'), w('k1|COM', 'xs1|N')])
    expect(msgs(d, 'polarity')).toEqual(['K1 switches the neutral: with K1 released, what it feeds stays live. Move K1 into the L wire.'])
  })
  it('a switch in the L wire says nothing', () => {
    const d = on([['s1', 'S1', 't-switch'], ['e1', 'E1', 't-lamp']], [w('xs1|L', 's1|1'), w('s1|2', 'e1|L'), w('e1|N', 'xs1|N')])
    expect(rules(d).has('polarity')).toBe(false)
  })
  it('a switch or fuse that feeds nothing, or joins N to earth, is not in a neutral path', () => {
    for (const part of ['t-switch', 't-fuse']) {
      expect(rules(on([['s1', 'S1', part]], [w('xs1|N', 's1|1')])).has('polarity')).toBe(false)
      expect(rules(on([['s1', 'S1', part]], [w('xs1|N', 's1|1'), w('s1|2', 'xs1|PE')])).has('polarity')).toBe(false)
      expect(rules(on([['s1', 'S1', part], ['e1', 'E1', 't-lamp-c1']], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N'), w('xs1|N', 's1|1'), w('s1|2', 'e1|PE')])).has('polarity')).toBe(false)
    }
  })
  it('a fuse in the neutral', () => {
    const d = on([['f1', 'F1', 't-fuse'], ['e1', 'E1', 't-lamp']], [w('xs1|L', 'e1|L'), w('e1|N', 'f1|1'), w('f1|2', 'xs1|N')])
    expect(msgs(d, 'polarity')).toEqual(['F1 is in the neutral: when it blows, what it feeds stays live. Move F1 into the L wire.'])
  })
  it('an empty fuse holder in the neutral is still in the neutral', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('f1', 'F1', 't-fuse', 200, 0, { settings: { fuse: 'absent' } }), at('e1', 'E1', 't-lamp', 400)],
      [w('xs1|L', 'e1|L'), w('e1|N', 'f1|1'), w('f1|2', 'xs1|N')])
    expect(msgs(d, 'polarity')).toEqual(["F1's holder is in the neutral: a fuse there would not disconnect L from what it feeds. Move F1 into the L wire."])
  })
  const eu = [['xs1', 'XS1', 't-outlet-eu']]
  const unknown = 'XS1 is an unpolarized outlet, so which of its slots is L is not known'
  it('on an unpolarized outlet the uncertainty is reported, never skipped (Resolution 22)', () => {
    const d = on([['e1', 'E1', 't-lamp-230']], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N')], eu)
    expect(msgs(d, 'polarity')).toEqual([`${unknown}: E1 L and E1 N may be on the wrong conductor. Use a polarized plug and outlet for E1.`])
  })
  it('one warning per unpolarized outlet, listing every part it affects with its own conditions (Ruling 37)', () => {
    const d = on([['k1', 'K1', 't-relay'], ['f1', 'F1', 't-fuse'], ['s1', 'S1', 't-switch'], ['e1', 'E1', 't-lamp-230'], ['e2', 'E2', 't-lamp-230']], [
      w('xs1|L', 'f1|1'), w('f1|2', 's1|1'), w('s1|2', 'e1|L'), w('e1|N', 'xs1|N'),
      w('xs1|L', 'k1|COM'), w('k1|NO', 'e2|L'), w('e2|N', 'xs1|N'),
    ], eu)
    const found = only(d, 'polarity')
    expect(found.map((f) => f.message)).toEqual([
      `${unknown}: E1 L and E1 N may be on the wrong conductor; E2 L and E2 N may be on the wrong conductor; F1 may be in the neutral; K1 may switch the neutral; S1 may switch the neutral. Use a polarized plug and outlet for E1, E2, F1, K1 and S1, or a double-pole switch or relay in place of K1 and S1.`,
    ])
    expect(found[0].subject).toBe('XS1')
    expect(new Set(found[0].parts)).toEqual(new Set(['xs1', 'e1', 'e2', 'f1', 'k1', 's1']))
  })
  it('a part that is on the unpolarized outlet only in some states keeps its condition in the list', () => {
    const d = on([['s1', 'S1', 't-switch'], ['s2', 'S2', 't-switch'], ['e1', 'E1', 't-lamp-230']], [w('xs1|L', 's1|1'), w('s1|2', 'e1|L'), w('xs1|N', 's2|1'), w('s2|2', 'e1|N')], eu)
    expect(msgs(d, 'polarity')).toEqual([
      `${unknown}: E1 L and E1 N may be on the wrong conductor when S1 is on, or when S2 is on; S1 may switch the neutral; S2 may switch the neutral. Use a polarized plug and outlet for E1, S1 and S2, or a double-pole switch or relay in place of S1 and S2.`,
    ])
  })
  it('an empty holder on an unpolarized outlet', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet-eu'), at('f1', 'F1', 't-fuse', 200, 0, { settings: { fuse: 'absent' } }), at('e1', 'E1', 't-lamp-230', 400)],
      [w('xs1|L', 'f1|1'), w('f1|2', 'e1|L'), w('e1|N', 'xs1|N')])
    expect(msgs(d, 'polarity')).toEqual([`${unknown}: E1 L and E1 N may be on the wrong conductor; F1's holder may be in the neutral. Use a polarized plug and outlet for E1 and F1.`])
  })
})

describe('rule 7: earth', () => {
  const through = (part: string, kinds: string) =>
    `The earth path runs through ${part} (${kinds}). Earth must never pass through a switch, relay or fuse, because opening it may leave a part unearthed. Wire earth straight.`
  it("a class 1 lamp's PE terminal without earth (its PE node is connected to nothing)", () => {
    const d = on([['e1', 'E1', 't-lamp-c1']], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N')])
    expect(msgs(d, 'earth')).toEqual(["E1 PE is not connected to earth: a fault inside E1 may leave its metal live. Wire E1 PE to the outlet's earth."])
    expect(rules(on([['e1', 'E1', 't-lamp-c1']], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N'), w('xs1|PE', 'e1|PE')])).has('earth')).toBe(false)
  })
  it('says nothing about an unearthed class 1 part that is off mains', () => {
    expect(rules(on([['e1', 'E1', 't-lamp-c1']], [])).has('earth')).toBe(false)
  })
  it('a class 1 PE terminal wired to a live conductor', () => {
    const d = on([['e1', 'E1', 't-lamp-c1']], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N'), w('e1|N', 'e1|PE')])
    expect(msgs(d, 'earth')).toEqual(["E1 PE is on N instead of earth: E1's metal may be live. Wire E1 PE to the outlet's earth, and nothing else to it."])
  })
  it('earthed only through a switch: no earth while it is off, and earth through a switch', () => {
    const d = on([['s1', 'S1', 't-switch'], ['e1', 'E1', 't-lamp-c1']],
      [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N'), w('xs1|PE', 's1|1'), w('s1|2', 'e1|PE')])
    expect(msgs(d, 'earth').sort()).toEqual([
      "E1 PE is not connected to earth when S1 is off: a fault inside E1 may leave its metal live. Wire E1 PE to the outlet's earth.",
      through('S1', 'a switch'),
    ])
  })
  it('a switched PE branch parallel to a permanent PE wire (earth: protective conductor through a switch), highlighting its loop', () => {
    const loop = [w('xs1|PE', 'e1|PE'), w('xs1|PE', 's1|1'), w('s1|2', 'e1|PE')]
    const d = on([['s1', 'S1', 't-switch'], ['e1', 'E1', 't-lamp-c1']], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N'), ...loop])
    const found = only(d, 'earth')
    expect(found.map((f) => f.message)).toEqual([through('S1', 'a switch')])
    expect([...found[0].wires].sort()).toEqual(loop.map((c) => c.uid).sort())
  })
  it('a part on the earth path with two kinds of edge names both', () => {
    const both = { ...MAINS_MODULES['t-relay'], id: 't-relay-fused', electrical: { ...(MAINS_MODULES['t-relay'].electrical as Record<string, unknown>), protective: [{ from: 'NO', to: 'NC', kind: 'fuse' }] } }
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('k1', 'K1', 't-relay-fused', 200), at('e1', 'E1', 't-lamp-c1', 400)],
      [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N'), w('xs1|PE', 'k1|NO'), w('k1|NC', 'e1|PE')], { 't-relay-fused': both })
    expect(msgs(d, 'earth')).toContain(through('K1', 'a fuse and a relay'))
  })
  it('N joined to PE beyond the outlet', () => {
    expect(msgs(on([], [w('xs1|N', 'xs1|PE')]), 'earth')).toEqual([
      'XS1 N is joined to earth: neutral and earth are joined only at the main panel, and a join here puts current on the earth wire. Remove the wire that joins them.',
    ])
  })
  it('N and PE joined inside the outlet itself are not a join beyond it', () => {
    const joined = { ...MAINS_MODULES['t-outlet'], id: 't-outlet-tn', internal: [['N', 'PE']] }
    const d = sheet([at('xs1', 'XS1', 't-outlet-tn')], [], { 't-outlet-tn': joined })
    expect(rules(d).has('earth')).toBe(false)
  })
  it('a lamp terminal on earth only', () => {
    const d = on([['e1', 'E1', 't-lamp']], [w('xs1|L', 'e1|L'), w('xs1|PE', 'e1|N')])
    expect(msgs(d, 'earth')).toEqual(['E1 N is joined to earth, but it is a mains terminal of E1 and must never be on earth. Wire it to N.'])
  })
  it('a DC ground joined to earth without a declared bond warns; through a declared bond it does not', () => {
    expect(msgs(on([['u1', 'U1', 't-mcu']], [w('xs1|PE', 'u1|GND')]), 'earth-bond')).toEqual([
      'U1 GND is joined to earth, but nothing on this net declares a bond to earth. Remove the join unless the supply is meant to be earthed (a class 1 supply with an earthed output).',
    ])
    const bonded = on([['ps1', 'PS1', 't-psu-pelv'], ['u1', 'U1', 't-mcu']],
      [w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2'), w('xs1|PE', 'ps1|PE'), w('ps1|-V', 'u1|GND'), w('ps1|+V', 'u1|VCC')])
    expect(rules(bonded).has('earth-bond')).toBe(false)
    expect(rules(bonded).has('earth')).toBe(false)
  })
  // Astra A1: every PE terminal is judged for what it carries; only the missing-earth check is for class 1 parts.
  it("L through a fuse and one lamp's filament into a second lamp's PE, that lamp's L and N unwired", () => {
    const d = on([['f1', 'F1', 't-fuse'], ['e1', 'E1', 't-lamp'], ['e2', 'E2', 't-lamp-c1']],
      [w('xs1|L', 'f1|1'), w('f1|2', 'e1|L'), w('e1|N', 'e2|PE')])
    expect(msgs(d, 'earth')).toEqual([
      "E2 PE gets mains from XS1 (120 V) through another part instead of being on earth: E2's metal may be live. Wire E2 PE to the outlet's earth, and nothing else to it.",
    ])
  })
  it("a loose cord plug's PE lead fed from L", () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('xp2', 'XP2', 't-plug-us', 600, 600)], [w('xs1|L', 'xp2|PE')])
    expect(msgs(d, 'earth')).toEqual([
      'XP2 PE is on L instead of earth: anything earthed through XP2 may be live. Connect XP2 PE to earth only.',
    ])
  })
  it("a cord plug's PE lead left unwired is not a missing earth (only a class 1 part must be earthed)", () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('xp2', 'XP2', 't-plug-us', 600, 600), at('e1', 'E1', 't-lamp', 900)],
      [w('xs1|L', 'xp2|L'), w('xs1|N', 'xp2|N')])
    expect(msgs(d, 'earth')).toEqual([])
  })
  it('a class 1 supply with its earth unwired while its input is on mains', () => {
    const d = on([['ps1', 'PS1', 't-psu-pelv']], [w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2')])
    expect(msgs(d, 'earth')).toEqual(["PS1 PE is not connected to earth: a fault inside PS1 may leave its metal live. Wire PS1 PE to the outlet's earth."])
  })
})

describe('rule 8: protection', () => {
  const fused = (settings: Record<string, string>, values?: PartInstance['values']) =>
    sheet([at('xs1', 'XS1', 't-outlet'), at('f1', 'F1', 't-fuse', 200, 0, { settings, ...(values ? { values } : {}) }), at('e1', 'E1', 't-lamp', 400)],
      [w('xs1|L', 'f1|1'), w('f1|2', 'e1|L'), w('e1|N', 'xs1|N')])
  it('an unfused lamp warns, highlighting the unfused L wiring; a fused one with a rating does not', () => {
    const lWire = w('xs1|L', 'e1|L')
    const found = only(on([['e1', 'E1', 't-lamp']], [lWire, w('xs1|N', 'e1|N')]), 'unprotected')
    expect(found.map((f) => f.message)).toEqual([
      "Nothing fuses the L wire from XS1 to E1: a fault in the wiring beyond the plug has only the building's breaker to stop it. Add a fuse (a fuse holder) in the L wire.",
    ])
    expect(found[0].wires).toEqual([lWire.uid])
    const ok = fused({ fuse: 'fitted' }, { fuseRating: { value: 2, unit: 'A' } })
    expect(rules(ok).has('unprotected')).toBe(false)
    expect(rules(ok).has('fuse-rating-unknown')).toBe(false)
  })
  it('names the state when only a switch puts L on the lamp (Ruling 31)', () => {
    const d = on([['s1', 'S1', 't-switch'], ['e1', 'E1', 't-lamp']], [w('xs1|L', 's1|1'), w('s1|2', 'e1|L'), w('e1|N', 'xs1|N')])
    expect(msgs(d, 'unprotected')).toEqual([
      "Nothing fuses the L wire from XS1 to E1 when S1 is on: a fault in the wiring beyond the plug has only the building's breaker to stop it. Add a fuse (a fuse holder) in the L wire.",
    ])
  })
  it('highlights the unfused wiring of every state it holds in, not only the first (the union, as Ruling 33)', () => {
    // Two switched routes to E1: S1 then S3, or S2 then S4. Each state that fuses nothing uses one route.
    const viaA = [w('s1|2', 's3|1')]
    const viaB = [w('s2|2', 's4|1')]
    const d = on([['s1', 'S1', 't-switch'], ['s2', 'S2', 't-switch'], ['s3', 'S3', 't-switch'], ['s4', 'S4', 't-switch'], ['e1', 'E1', 't-lamp']],
      [w('xs1|L', 's1|1'), w('xs1|L', 's2|1'), ...viaA, ...viaB, w('s3|2', 'e1|L'), w('s4|2', 'e1|L'), w('e1|N', 'xs1|N')])
    const found = only(d, 'unprotected')
    expect(found).toHaveLength(1)
    expect(found[0].wires).toEqual(expect.arrayContaining([...viaA, ...viaB].map((c) => c.uid)))
  })
  it('a fuse in the N wire does not protect the L wiring', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('f1', 'F1', 't-fuse', 200, 0, { values: { fuseRating: { value: 2, unit: 'A' } } }), at('e1', 'E1', 't-lamp', 400)],
      [w('xs1|L', 'e1|L'), w('e1|N', 'f1|1'), w('f1|2', 'xs1|N')])
    expect(rules(d).has('unprotected')).toBe(true)
  })
  // Astra A3: a converter's input is protected like a load's L side.
  describe("a converter's mains input", () => {
    const f1 = () => at('f1', 'F1', 't-fuse', 200, 0, { values: { fuseRating: { value: 1, unit: 'A' } } })
    const psu = () => at('ps1', 'PS1', 't-psu', 400)
    it('unfused', () => {
      const d = sheet([at('xs1', 'XS1', 't-outlet'), psu()], [w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2')])
      expect(msgs(d, 'unprotected')).toEqual([
        "Nothing fuses the L wire from XS1 to PS1: a fault in the wiring beyond the plug has only the building's breaker to stop it. Add a fuse (a fuse holder) in the L wire.",
      ])
    })
    it('fused', () => {
      const d = sheet([at('xs1', 'XS1', 't-outlet'), f1(), psu()], [w('xs1|L', 'f1|1'), w('f1|2', 'ps1|AC1'), w('xs1|N', 'ps1|AC2')])
      expect(rules(d).has('unprotected')).toBe(false)
    })
    it('fused, with a wire bypassing the fuse', () => {
      const d = sheet([at('xs1', 'XS1', 't-outlet'), f1(), psu()], [w('xs1|L', 'f1|1'), w('f1|2', 'ps1|AC1'), w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2')])
      expect(msgs(d, 'unprotected')).toHaveLength(1)
    })
    it("behind a UK cord plug's integral fuse", () => {
      const d = sheet([at('xs1', 'XS1', 't-outlet-uk'), at('xp1', 'XP1', 't-plug-uk', 0, 0, { mount: { board: 'xs1' } }), psu()],
        [w('xp1|L', 'ps1|AC1'), w('xp1|N', 'ps1|AC2')])
      expect(rules(d).has('unprotected')).toBe(false)
    })
    it('a plug-in converter seated in its outlet: no wiring of the project lies before its input', () => {
      const d = sheet([at('xs1', 'XS1', 't-outlet-uk'), at('ps1', 'PS1', 't-charger-uk', 0, 0, { mount: { board: 'xs1' } })], [])
      expect(analyseMains(d)!.converters.get('ps1')!.state).toBe('powered')
      expect(rules(d).has('unprotected')).toBe(false)
    })
  })
  it('fuse on one branch with a bypass (unprotected)', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('f1', 'F1', 't-fuse', 200, 0, { values: { fuseRating: { value: 2, unit: 'A' } } }), at('e1', 'E1', 't-lamp', 400)],
      [w('xs1|L', 'f1|1'), w('f1|2', 'e1|L'), w('xs1|L', 'e1|L'), w('e1|N', 'xs1|N')])
    expect(rules(d).has('unprotected')).toBe(true)
  })
  it('empty fuse holder vs fitted with unknown rating', () => {
    const empty = fused({ fuse: 'absent' })
    expect(msgs(empty, 'no-power')).toEqual(['E1 has no mains power: F1 has no fuse fitted. Fit a fuse in F1.'])
    expect(rules(empty).has('unprotected')).toBe(false)
    expect(msgs(fused({ fuse: 'fitted' }), 'fuse-rating-unknown')).toEqual([
      'F1 has a fuse fitted but no rating, so the drawing does not say which fuse to fit. Set its rating in amps.',
    ])
  })
  it('never blames an empty fuse holder that is not the cause (Resolution 28)', () => {
    // E1 is powered directly; F1 is empty but sits on another branch that shares E1's neutral.
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('e1', 'E1', 't-lamp', 200), at('f1', 'F1', 't-fuse', 400, 0, { settings: { fuse: 'absent' } }), at('e2', 'E2', 't-lamp', 600)],
      [w('xs1|L', 'e1|L'), w('e1|N', 'xs1|N'), w('xs1|L', 'f1|1'), w('f1|2', 'e2|L'), w('e2|N', 'xs1|N')])
    expect(msgs(d, 'no-power')).toEqual(['E2 has no mains power: F1 has no fuse fitted. Fit a fuse in F1.'])
  })
  it('names only the empty holder whose fitting restores the supply, not an unrelated empty one (Resolution 28)', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('f1', 'F1', 't-fuse', 200, 0, { settings: { fuse: 'absent' } }), at('f2', 'F2', 't-fuse', 200, 200, { settings: { fuse: 'absent' } }), at('e1', 'E1', 't-lamp', 400)],
      [w('xs1|L', 'f1|1'), w('f1|2', 'e1|L'), w('e1|N', 'xs1|N'), w('xs1|L', 'f2|1')])
    expect(msgs(d, 'no-power')).toEqual(['E1 has no mains power: F1 has no fuse fitted. Fit a fuse in F1.'])
  })
  it('names every holder that alone restores the supply, in designator order', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('f2', 'F2', 't-fuse', 200, 0, { settings: { fuse: 'absent' } }), at('f1', 'F1', 't-fuse', 200, 200, { settings: { fuse: 'absent' } }), at('e1', 'E1', 't-lamp', 400)],
      [w('xs1|L', 'f1|1'), w('f1|2', 'e1|L'), w('xs1|L', 'f2|1'), w('f2|2', 'e1|L'), w('e1|N', 'xs1|N')])
    expect(msgs(d, 'no-power')).toEqual(['E1 has no mains power: F1 and F2 have no fuse fitted. Fit a fuse in F1 or F2.'])
  })
  it('never names a holder through contact positions that cannot close together (Astra counterexample)', () => {
    // K1: NC to XS1 L, NO to E1 L, COM unwired. With every position closed at once, NC-COM-NO would join
    // XS1 L to E1 L and make the dangling F2 look like a fix; no real state of K1 does that.
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('f1', 'F1', 't-fuse', 200, 0, { settings: { fuse: 'absent' } }), at('f2', 'F2', 't-fuse', 200, 200, { settings: { fuse: 'absent' } }),
      at('k1', 'K1', 't-relay', 200, 400), at('e1', 'E1', 't-lamp', 400)],
    [w('xs1|L', 'f1|1'), w('f1|2', 'e1|L'), w('xs1|L', 'f2|1'), w('xs1|L', 'k1|NC'), w('k1|NO', 'e1|L'), w('e1|N', 'xs1|N')])
    // K1's coil is unwired, which the DC checker reports on its own.
    expect(only(d, 'no-power').filter((f) => f.subject === 'E1').map((f) => f.message)).toEqual(['E1 has no mains power: F1 has no fuse fitted. Fit a fuse in F1.'])
  })
  it('names no holder when no single one restores the supply (empty holders on L and on N)', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('f1', 'F1', 't-fuse', 200, 0, { settings: { fuse: 'absent' } }), at('f2', 'F2', 't-fuse', 200, 200, { settings: { fuse: 'absent' } }), at('e1', 'E1', 't-lamp', 400)],
      [w('xs1|L', 'f1|1'), w('f1|2', 'e1|L'), w('e1|N', 'f2|2'), w('f2|1', 'xs1|N')])
    expect(msgs(d, 'no-power')).toEqual([
      'E1 has no mains power: every supply path to it runs through more than one empty fuse holder. Fit a fuse in every empty holder on its supply path.',
    ])
  })
  it('claims nothing about empty fuse holders when the checks did not finish', () => {
    const ks = Array.from({ length: 17 }, (_, i) => i + 1)
    const d = sheet([at('xs1', 'XS1', 't-outlet'), ...ks.map((k) => at(`s${k}`, `S${k}`, 't-switch', k * 100, 300)),
      at('f1', 'F1', 't-fuse', 200, 600, { settings: { fuse: 'absent' } }), at('e1', 'E1', 't-lamp', 600, 600)],
    [...ks.map((k) => w('xs1|L', `s${k}|1`)), w('xs1|L', 'f1|1'), w('f1|2', 'e1|L'), w('e1|N', 'xs1|N')])
    expect(only(d, 'no-power')).toEqual([])
  })
})

describe('rule 9: cables', () => {
  const lamp = (extra: ReturnType<typeof w>[]) => on([['e1', 'E1', 't-lamp-c1']], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N'), ...extra])
  const advice = 'Use a cable rated for mains, such as an approved cord of 0.75 mm2 or 18 AWG or thicker, with stripped or ferrule ends.'
  it('a live Dupont jumper is unsuitable; a thin wire too; an 18 AWG ferrule wire is only unverified', () => {
    const d = on([['e1', 'E1', 't-lamp']], [dupont('xs1|L', 'e1|L'), w('xs1|N', 'e1|N', { gauge: 24, ends: { from: 'stripped', to: 'stripped' } })])
    expect(msgs(d, 'mains-cable').sort()).toEqual([
      `The wire XS1 L to E1 L carries mains, but it has Dupont female ends and is 26 AWG. ${advice}`,
      `The wire XS1 N to E1 N carries mains, but it is 24 AWG. ${advice}`,
    ])
    expect(msgs(on([['e1', 'E1', 't-lamp']], [w('xs1|L', 'e1|L')]), 'cable-unverified')).toEqual([
      'The wire XS1 L to E1 L carries mains. Circuitoon cannot check its insulation or rating: use a cable rated for mains, such as an approved cord of 0.75 mm2 or 18 AWG or thicker, with stripped or ferrule ends.',
    ])
  })
  it('names each unsuitable end kind once, in plain words, and uses the wire label when it has one', () => {
    const d = on([['e1', 'E1', 't-lamp']], [w('xs1|L', 'e1|L', { label: 'lamp feed', ends: { from: 'alligator', to: 'dupont-male' } }), w('xs1|N', 'e1|N')])
    expect(msgs(d, 'mains-cable')).toEqual([`The wire lamp feed carries mains, but it has alligator clip and Dupont male ends. ${advice}`])
  })
  it('Dupont PE lead on a class 1 lamp (mains-cable)', () => {
    expect(msgs(lamp([dupont('xs1|PE', 'e1|PE')]), 'mains-cable')).toEqual([
      `The wire XS1 PE to E1 PE is part of the earth path, but it has Dupont female ends and is 26 AWG. ${advice}`,
    ])
  })
  it('two parallel 26 AWG Dupont PE wires to a class 1 lamp (mains-cable on both)', () => {
    const d = lamp([dupont('xs1|PE', 'e1|PE'), dupont('e1|PE', 'xs1|PE')])
    expect(only(d, 'mains-cable').length).toBe(2)
  })
  it('an ESP32 26 AWG Dupont ground to a PE-bonded supply minus (no mains-cable finding)', () => {
    const d = on([['ps1', 'PS1', 't-psu-pelv'], ['u1', 'U1', 't-mcu']],
      [w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2'), w('xs1|PE', 'ps1|PE'), dupont('ps1|-V', 'u1|GND'), dupont('ps1|+V', 'u1|VCC')])
    expect(only(d, 'mains-cable')).toEqual([])
  })
  it('a breadboard strip on mains or on the earth path is unsuitable (Ruling 35)', () => {
    const bb = load('breadboard-half')
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('bb', 'BB1', bb.id, 0, 400), at('e1', 'E1', 't-lamp-c1', 400)],
      [w('xs1|L', 'bb|c3-top'), w('bb|c3-top', 'e1|L'), w('xs1|N', 'e1|N'), w('xs1|PE', 'bb|c5-top'), w('bb|c5-top', 'e1|PE')], { [bb.id]: bb })
    const found = only(d, 'mains-cable')
    expect(found.map((f) => f.message)).toEqual([
      'BB1 3 a-e carries mains and BB1 5 a-e is on the earth path, but a breadboard strip is not rated for mains or protective earth. Use rated terminals, such as a terminal block or a lever connector, in place of the breadboard.',
    ])
    expect(found[0].pins).toEqual([{ part: 'bb', pin: 'c3-top' }, { part: 'bb', pin: 'c5-top' }])
  })
})

describe('rule 13: checks that did not finish', () => {
  const notChecked = 'Not checked: mains on low-voltage wiring, shorts, outlets joined to each other, mains voltages, polarity, earthing, fuses in the L wire and which loads get power.'
  it('17 contact groups (mains-incomplete, no clean claim)', () => {
    const ks = Array.from({ length: 17 }, (_, i) => i + 1)
    const d = on(ks.map((k): [string, string, string] => [`s${k}`, `S${k}`, 't-switch']), ks.map((k) => w('xs1|L', `s${k}|1`)))
    const found = checkDiagram(d)
    expect(found.filter((f) => f.rule === 'mains-incomplete').map((f) => f.message)).toEqual([
      `Mains checks did not finish: 17 switches and relays. ${notChecked} Split the drawing or check the rest by hand.`,
    ])
    expect(found.find((f) => f.rule === 'mains-incomplete')!.subject).toBe('S1')
    expect(found.length).toBeGreaterThan(0)
  })
  it('more than 10 AC sources joined in one unit', () => {
    const outlets = Array.from({ length: 11 }, (_, i) => [`xs${i + 1}`, `XS${i + 1}`, 't-outlet'])
    const joined = outlets.slice(1).map(([uid]) => w('xs1|L', `${uid}|L`))
    expect(msgs(on([], joined, outlets), 'mains-incomplete')).toEqual([`Mains checks did not finish: 11 AC sources. ${notChecked} Split the drawing or check the rest by hand.`])
  })
  // Final review (2): the limits apply per enumeration unit, never to the sheet.
  it('a room of 11 outlets, all idle but one, is still checked', () => {
    const outlets = Array.from({ length: 11 }, (_, i) => [`xs${i + 1}`, `XS${i + 1}`, 't-outlet'])
    const d = on([['e1', 'E1', 't-lamp']], [w('xs1|L', 'e1|L'), w('xs1|L', 'xs1|N')], outlets)
    expect(analyseMains(d)!.complete).toBe(true)
    expect(rules(d).has('mains-incomplete')).toBe(false)
    expect(msgs(d, 'mains-short')).toEqual(['XS1 L and N are joined: a short circuit across the outlet. The breaker should trip; until it does, the wiring may overheat. Remove the wire that joins them.'])
  })
  it('an L-N short on one outlet is found beside 17 switches on another outlet, whose unit alone did not finish', () => {
    const ks = Array.from({ length: 17 }, (_, i) => i + 1)
    const d = on(ks.map((k): [string, string, string] => [`s${k}`, `S${k}`, 't-switch']), [w('xs1|L', 'xs1|N'), ...ks.map((k) => w('xs2|L', `s${k}|1`))],
      [['xs1', 'XS1', 't-outlet'], ['xs2', 'XS2', 't-outlet-2']])
    expect(analyseMains(d)!.complete).toBe(false)
    expect(msgs(d, 'mains-short')).toHaveLength(1)
    expect(msgs(d, 'mains-incomplete')).toEqual([`Mains checks did not finish: 17 switches and relays. ${notChecked} Split the drawing or check the rest by hand.`])
    // The oversized unit stays conservative: its wires are taken as on mains.
    expect(only(d, 'cable-unverified').some((f) => f.message.includes('S17'))).toBe(true)
  })
  it('says nothing when the checks finished', () => {
    expect(rules(on([['e1', 'E1', 't-lamp']], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N')])).has('mains-incomplete')).toBe(false)
  })
})
