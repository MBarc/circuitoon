// The mains rules (spec section 3), each both ways, and the counterexamples of Astra's reviews.
import { describe, expect, it } from 'vitest'
import { checkDiagram, type Finding } from './checks.ts'
import type { Diagram } from './diagram.ts'
import { MAINS_MODULES, at, dupont, sheet, w } from './mains.testing.ts'
import { plugsOf } from './breadboard.ts'
import { netlist, nodeKey } from './netlist.ts'
import { type Prepared, analyseState, buildMainsGraph, candidateGroups, masksByPopcount, prepare, setState } from './mainsGraph.ts'
import { across, acrossFit, acrossWith, newAcc, visitState } from './mainsRules.ts'

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
