// The mains analysis as the wiring checker sees it: converter availability (spec 1.3, rule 11)
// gating which outputs are DC sources and what the passive-feed allowance counts, loads behind an
// unknown converter reported as not checked, hazardous nets and source edges kept out of the DC rules,
// honest results when enumeration did not finish, and nothing built for a sheet without mains data.
import { describe, expect, it } from 'vitest'
import { checkDiagram, type Finding } from './checks.ts'
import type { Connection, Diagram } from './diagram.ts'
import { analyseMains, analyseMainsCached } from './mains.ts'
import { at, sheet, w } from './mains.testing.ts'
import { plugsOf } from './breadboard.ts'
import { netlist as netlistOf, nodeKey } from './netlist.ts'
import { analyseState, buildMainsGraph, candidateGroups, masksByPopcount, prepare, setState } from './mainsGraph.ts'
import { type MainsDraft, finishStates, newAcc, report } from './mainsRules.ts'

const only = (d: Diagram, rule: string): Finding[] => checkDiagram(d).filter((f) => f.rule === rule)
const msgs = (d: Diagram, rule: string) => only(d, rule).map((f) => f.message)
/** An outlet pair, a 5 V converter on its AC1/AC2 and a board on its output. */
const psuOn = (a: string, b: string, extra: Connection[] = []) => sheet(
  [at('xs1', 'XS1', 't-outlet'), at('xs2', 'XS2', 't-outlet-2', 0, 200), at('ps1', 'PS1', 't-psu', 200), at('u1', 'U1', 't-mcu', 400)],
  [...(a ? [w(a, 'ps1|AC1')] : []), ...(b ? [w(b, 'ps1|AC2')] : []), w('ps1|+V', 'u1|VCC'), w('ps1|-V', 'u1|GND'), ...extra],
)

describe('analyseMains', () => {
  it('returns null for a sheet without mains data, and the cache hands the same result to every reader', () => {
    expect(analyseMains(sheet([at('u1', 'U1', 't-mcu')], []))).toBeNull()
    const d = psuOn('xs1|L', 'xs1|N')
    expect(analyseMainsCached(d)).toBe(analyseMainsCached(d))
  })
})

describe('converter availability gates the DC checker', () => {
  it('a converter fed L and N of one outlet is powered and supplies its load', () => {
    const d = psuOn('xs1|L', 'xs1|N')
    expect(analyseMains(d)!.converters.get('ps1')).toEqual({ state: 'powered', why: null, kind: null, fix: null })
    expect(only(d, 'no-power')).toEqual([])
  })
  it('converter with inputs L and L (unknown availability, no DC conclusions)', () => {
    const d = psuOn('xs1|L', 'xs1|L')
    expect(analyseMains(d)!.converters.get('ps1')).toEqual({ state: 'unknown', why: 'its two inputs are joined to each other', kind: 'wiring', fix: 'Wire AC1 and AC2 to L and N of one outlet.' })
    expect(msgs(d, 'no-power')).toEqual([
      "PS1's mains input is not a complete connection (its two inputs are joined to each other), so its outputs are not counted as a supply. Wire AC1 and AC2 to L and N of one outlet.",
    ])
    // The board behind it is neither fed nor unfed: its power is reported as not checked, and nothing else is claimed.
    expect(checkDiagram(d).filter((f) => f.parts.includes('u1')).map((f) => `${f.rule}: ${f.message}`)).toEqual([
      "supply-unknown: U1's power is not checked: it comes only from PS1 +V, and PS1's mains input is not a complete connection. Complete PS1's mains input first.",
    ])
  })
  it('converter inputs shorted together or fed from two outlets (unknown, outputs dead)', () => {
    const shorted = analyseMains(psuOn('xs1|L', '', [w('ps1|AC1', 'ps1|AC2')]))!
    expect(shorted.converters.get('ps1')?.state).toBe('unknown')
    expect(shorted.deadOutputs.get(nodeKey('ps1', '+V'))).toBe('unknown')
    const two = analyseMains(psuOn('xs1|L', 'xs2|N'))!
    expect(two.converters.get('ps1')).toMatchObject({ state: 'unknown', why: 'its inputs come from two different outlets' })
    expect(two.deadOutputs.get(nodeKey('ps1', '+V'))).toBe('unknown')
  })
  it('names the one input that is connected', () => {
    expect(analyseMains(psuOn('xs1|L', ''))!.converters.get('ps1')).toMatchObject({ state: 'unknown', why: 'only AC1 is connected to an outlet' })
  })
  it('says when the other input reaches the outlet only through a load or an empty fuse holder', () => {
    const lamp = sheet([at('xs1', 'XS1', 't-outlet'), at('e1', 'E1', 't-lamp', 600), at('ps1', 'PS1', 't-psu', 200)], [w('xs1|L', 'e1|L'), w('e1|N', 'ps1|AC1'), w('xs1|N', 'ps1|AC2')])
    expect(analyseMains(lamp)!.converters.get('ps1')).toMatchObject({ state: 'unknown', why: 'AC1 reaches the outlet only through a load or a leakage path', kind: 'wiring' })
    const fuse = sheet([at('xs1', 'XS1', 't-outlet'), at('f1', 'F1', 't-fuse', 600, 0, { settings: { fuse: 'absent' } }), at('ps1', 'PS1', 't-psu', 200)],
      [w('xs1|L', 'f1|1'), w('f1|2', 'ps1|AC1'), w('xs1|N', 'ps1|AC2')])
    expect(analyseMains(fuse)!.converters.get('ps1')).toEqual({ state: 'unknown', why: 'AC1 reaches the outlet only through an empty fuse holder', kind: 'fuse', fix: 'Fit a fuse in the empty holder.' })
    expect(msgs(fuse, 'no-power')).toEqual([
      "PS1's mains input is not a complete connection (AC1 reaches the outlet only through an empty fuse holder), so its outputs are not counted as a supply. Fit a fuse in the empty holder.",
    ])
  })
  it('a converter on a voltage outside its input range is told to be replaced, not rewired', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet-eu', 0, 0, { values: { acVoltage: { value: 260, unit: 'VAC' } } }), at('ps1', 'PS1', 't-psu', 200), at('u1', 'U1', 't-mcu', 400)],
      [w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2'), w('ps1|+V', 'u1|VCC'), w('ps1|-V', 'u1|GND')])
    // Ruling 34: one finding for the converter (rule 4's), and the load behind it points to it.
    expect(analyseMains(d)!.converters.get('ps1')).toMatchObject({ state: 'unknown', kind: 'voltage' })
    expect(checkDiagram(d).filter((f) => f.subject === 'PS1').map((f) => `${f.rule}: ${f.message}`)).toEqual([
      'mains-voltage: PS1 takes 100 V to 240 V AC, but XS1 gives 260 V. Use a converter made for 260 V.',
    ])
    expect(checkDiagram(d).filter((f) => ['no-power', 'supply-unknown'].includes(f.rule)).map((f) => f.message)).toEqual([
      "U1's power is not checked: it comes only from PS1 +V, and PS1's mains voltage is outside its input range (see the wrong mains voltage finding for PS1). Use a converter rated for 260 V in place of PS1.",
    ])
  })
  it('names every unknown converter feeding a load', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('ps1', 'PS1', 't-psu', 200), at('ps2', 'PS2', 't-psu', 200, 300), at('u1', 'U1', 't-mcu', 400)],
      [w('xs1|L', 'ps1|AC1'), w('xs1|L', 'ps1|AC2'), w('xs1|N', 'ps2|AC1'), w('xs1|N', 'ps2|AC2'), w('ps1|+V', 'u1|VCC'), w('ps2|+V', 'u1|VCC'), w('ps1|-V', 'u1|GND'), w('ps2|-V', 'u1|GND')])
    expect(msgs(d, 'supply-unknown')).toEqual([
      "U1's power is not checked: it comes only from PS1 +V and PS2 +V, and PS1's and PS2's mains inputs are not complete connections. Complete PS1's and PS2's mains inputs first.",
    ])
  })
  it("keeps the short of an unknown converter's own output to its ground", () => {
    const d = psuOn('xs1|L', 'xs1|L', [w('ps1|+V', 'ps1|-V')])
    expect(checkDiagram(d).filter((f) => f.subject === 'PS1').map((f) => f.rule)).toEqual(['short', 'no-power'])
  })
  it('a converter with no mains input is unpowered, and its load has no power', () => {
    const d = psuOn('', '')
    expect(analyseMains(d)!.converters.get('ps1')).toEqual({ state: 'unpowered', why: null, kind: null, fix: null })
    expect(msgs(d, 'no-power')).toEqual([
      'PS1 has no mains input, so its outputs supply nothing. Wire AC1 and AC2 to L and N of one outlet.',
      "U1 has no power: VCC is connected but nothing supplies it. Connect it to a 5 V supply, such as a board's 5V pin.",
    ])
  })
})

describe('when the enumeration did not finish, nothing is claimed unpowered without proof', () => {
  const ks = Array.from({ length: 17 }, (_, i) => i + 1)
  const d = sheet([
    at('xs1', 'XS1', 't-outlet'), ...ks.map((k) => at(`s${k}`, `S${k}`, 't-switch', k * 100, 300)),
    at('ps1', 'PS1', 't-psu', 200, 600), at('ps2', 'PS2', 't-psu', 600, 600), at('u1', 'U1', 't-mcu', 900, 600),
  ], [...ks.map((k) => w('xs1|L', `s${k}|1`)), w('s1|2', 'ps1|AC1'), w('xs1|N', 'ps1|AC2'), w('ps2|+V', 'u1|VCC'), w('ps2|-V', 'u1|GND')])
  it('a converter a source could reach is unknown; one no source can reach is unpowered (a proof)', () => {
    const a = analyseMains(d)!
    expect(a.complete).toBe(false)
    expect(a.converters.get('ps1')).toEqual({ state: 'unknown', why: 'the mains checks did not finish', kind: 'incomplete', fix: "Check PS1's input by hand." })
    expect(a.converters.get('ps2')).toMatchObject({ state: 'unpowered', why: null })
  })
  it('never asks to rewire an input it did not check, and says so for the load behind it', () => {
    const e = sheet([...d.parts, at('u2', 'U2', 't-mcu', 900, 900)], [...d.connections, w('ps1|+V', 'u2|VCC'), w('ps1|-V', 'u2|GND')])
    expect(checkDiagram(e).filter((f) => f.parts.includes('ps1')).map((f) => `${f.rule}: ${f.message}`)).toEqual([
      "supply-unknown: The mains checks did not finish, so PS1's mains input was not checked and its outputs are not counted as a supply. Check PS1's input by hand.",
      "supply-unknown: U2's power is not checked: it comes only from PS1 +V, and the mains checks did not finish for PS1. Check PS1's input by hand.",
    ])
  })
})

describe('hazardous nets and source edges stay out of the DC rules', () => {
  it('a relay contact that never meets mains keeps its DC role (it may feed a load)', () => {
    const d = sheet([at('k1', 'K1', 't-relay'), at('u1', 'U1', 't-mcu', 200)], [w('k1|NO', 'u1|VCC')])
    // K1's own coil is not wired, which the DC checker reports as before; U1 is fed through the contact.
    expect(msgs(d, 'no-power')).toEqual(['K1 has no power: connect +.'])
  })
  it('an I/O pin wired to mains gets no DC finding about that net', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('u1', 'U1', 't-mcu', 200), at('u2', 'U2', 't-mcu', 400)],
      [w('xs1|L', 'u1|IO'), w('u1|IO', 'u2|IO')])
    expect(checkDiagram(d).filter((f) => ['outputs-fight', 'no-common-ground'].includes(f.rule))).toEqual([])
  })
  it('a battery whose return is on mains adds nothing to the potential solver', () => {
    // Without the gate this would be "U1 VCC accepts up to 5 V but gets 9 V from BT1 +".
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('bt1', 'BT1', 't-bat9', 200), at('u1', 'U1', 't-mcu', 400)],
      [w('bt1|+', 'u1|VCC'), w('bt1|-', 'xs1|N'), w('u1|GND', 'xs1|N')])
    expect(checkDiagram(d).filter((f) => ['supply-too-high', 'supply-unknown', 'reversed', 'supplies-fight'].includes(f.rule))).toEqual([])
  })
})

describe('findings are worded with every minimal witness (Resolution 24, Ruling 31)', () => {
  it('a finding that holds when S1 is on or when S2 is on names both', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('s1', 'S1', 't-switch', 200), at('s2', 'S2', 't-switch', 200, 200)],
      [w('xs1|L', 's1|1'), w('xs1|L', 's2|1')])
    const plugs = plugsOf(d)
    const p = prepare(buildMainsGraph(d, plugs, netlistOf(d, plugs))!)
    const cands = candidateGroups(p.g, p.possible)
    const acc = newAcc(p, cands, null)
    const draft = (when: string): MainsDraft => ({ rule: 'polarity', subject: 'S1', target: 'S1', message: `Test${when}.`, parts: [], pins: [], wires: [], causes: [] })
    for (const mask of masksByPopcount(cands.length)) {
      setState(p, cands, mask)
      analyseState(p)
      if (mask) report(acc, 'test', mask, () => draft)
      report(acc, 'always', mask, () => draft)
    }
    expect(finishStates(acc).map((f) => f.message)).toEqual(['Test.', 'Test when S1 is on, or when S2 is on.'])
  })
})
