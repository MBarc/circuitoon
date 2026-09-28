// Generates the built-in mains loads and wiring parts (category Mains): the Hi-Link HLK-PM01 (5 V)
// and HLK-PM03 (3.3 V) AC-DC modules (isolation unknown: Hi-Link states no class, ruling B2), the
// Mean Well IRM-03-5, IRM-03-3.3 and IRM-05-5 modules (Class II stated, recorded as double, ruling
// B3), E26 (120 V) and E27 (230 V) lamp holders, an in-line 5 x 20 mm fuse holder (Littelfuse
// 150274) and the Wago 221-412, 221-413 and 221-415 lever connectors. Every pin order, range, rating
// and isolation class comes from src/format/mainsEvidence.ts (Task 0), where each value carries the
// datasheet line it comes from; isolation not stated there is "unknown". The KCD1 rocker's contacts
// and ratings are hand-written in modules/rocker-switch-kcd1.json from the same evidence.
//
// Run from the repo root: `node scripts/gen-mains-loads.mjs` (add `--check` to compare with modules/
// without writing). src/format/mainsParts.test.ts pins the pins, ranges, ratings and isolation.
import { finish } from './lib/gen-output.mjs'
import { moduleJson, r, side, write } from './lib/parts.mjs'
import { cleared, rated, rating, verified } from './lib/mains.mjs'

import { EVIDENCE } from '../src/format/mainsEvidence.ts'
/** Each module's `source`: every URL Task 0 used, datasheet or standard first. */
const SRC = Object.fromEntries(Object.entries(EVIDENCE).map(([id, e]) => [id, e.sources.join(' ')]))

/** Hi-Link: NOT VERIFIED only for the isolation class; Michael's ruling B2 clears them with isolation "unknown". */
const hlk = (id) => {
  const e = cleared(id, 'B2')
  return { left: e.pins.value.left, right: e.pins.value.right, range: e.acInput.value, isolation: e.isolation?.value ?? 'unknown' }
}
/** Mean Well IRM: the datasheet's bottom-view pin rows, input range, output volts and the Class II isolation. */
const irm = (id) => {
  const e = verified(id)
  return { pins: e.pins.value, range: e.acInput.value, volts: e.output.value.volts, isolation: e.isolation?.value ?? 'unknown', protection: e.protection?.value }
}
/** Lamp holders: the holder's rating, its earth terminal, the reference lamp's rated voltage. */
const lamp = (id) => {
  const e = verified(id)
  return { earth: !!e.extra?.earth?.value, protection: e.protection?.value, range: e.loadRange.value, lampVolts: e.extra.lampVolts.value, volts: e.ratings[0].volts, amps: e.ratings[0].amps, service: e.ratings[0].service }
}
const DATA = {
  'hlk-pm01': hlk('hlk-pm01'), 'hlk-pm03': hlk('hlk-pm03'),
  'irm-03-5': irm('irm-03-5'), 'irm-03-3v3': irm('irm-03-3v3'), 'irm-05-5': irm('irm-05-5'),
  'lamp-holder-e26': lamp('lamp-holder-e26'), 'lamp-holder-e27': lamp('lamp-holder-e27'),
  'fuse-holder-5x20-inline': rated('fuse-holder-5x20-inline'),
  'wago-221-412': rated('wago-221-412'), 'wago-221-413': rated('wago-221-413'), 'wago-221-415': rated('wago-221-415'),
}

// Sticker palette: black potted modules with white print, Mean Well red, ivory porcelain with a
// brass screw shell, a black in-line holder on red leads, a clear Wago housing with orange levers.
const POTTED = '#1B1F24', PLATE = '#2B2F36', LABEL = '#F5F5F2', MW_RED = '#D2232A', METAL = '#C9CED6', LEAD = '#B8BEC7'
const PORCELAIN = '#F1ECE2', PORCELAIN_RIM = '#E2DACB', BRASS = '#D9A93B', BRASS_DARK = '#A87E22', SCREW = '#B8BEC7', EARTH = '#3FA34D'
const HOLDER = '#2B2F36', CAP = '#3A3F48', WIRE_RED = '#D9443A', CLEAR = '#DDE7EE', ORANGE = '#F48C06', OPENING = '#5B616B'

/** A small metal pin seen from above, centred at (cx, cy): the IRM-03's NC pin is drawn but is not a module pin. */
const pinDot = (cx, cy) => r(cx - 3, cy - 3, 6, 6, METAL, { radius: 3, outline: false })

// ---------------------------------------------------------------------------------------------
// Hi-Link HLK-PM01 and HLK-PM03 (datasheet "3W Ultra small series power module" V2.6, 11. Dimensions
// and weight, top side view): 34 x 20 mm; pins 1 AC and 2 AC on the left end (1 above, 7.5 and 12.5 mm
// from the bottom edge), pin 3 -Vo top right and pin 4 +Vo bottom right (2.3 mm from the top and
// bottom edges). Input 85-264 VAC (product page). No isolation class is stated (test voltages only):
// isolation "unknown" under ruling B2, so the checker treats the output as live.
for (const [id, volts, supply] of [['hlk-pm01', '5 V', '5V'], ['hlk-pm03', '3.3 V', '3V3']]) {
  const d = DATA[id]
  const types = { 'AC 1': {}, 'AC 2': {}, '+Vo': { type: 'power_out', supply }, '-Vo': { type: 'ground' } }
  // 13 x 8 grid units (33 x 20 mm at 0.1 in): AC 1 and AC 2 at units 3 and 5 (true to the drawing);
  // -Vo and +Vo at 2 and 6, the outermost slots the layout allows (1 unit in from each corner).
  const [ac1, ac2] = d.left
  const [top, bottom] = d.right
  const left = side('left', [ac1, null, ac2], types, 8)
  const right = side('right', [top, null, null, null, bottom], types, 8)
  const pins = [...left.pins, ...right.pins].map((p) => (p.name?.startsWith('AC') ? { ...p, label: 'AC', mains: 'line' } : p))
  write(`${id}.json`, moduleJson({
    id, name: `Hi-Link ${id.toUpperCase()} AC-DC module (${volts}, 3 W)`, category: 'Mains', source: SRC[id], pins, wu: 13, hu: 8, inside: true,
    electrical: {
      model: 'converter', acInput: { a: ac1, b: ac2, range: d.range },
      domains: [{ name: 'mains', pins: [ac1, ac2], kind: 'mains' }, { name: 'output', pins: ['+Vo', '-Vo'], kind: 'selv' }],
      isolation: d.isolation,
    },
    shapes: [
      r(0, 0, 130, 80, POTTED, { radius: 3 }),
      r(34, 18, 62, 44, PLATE, { radius: 2, outline: false }),
      r(34, 20, 62, 20, PLATE, { outline: false, label: id.toUpperCase(), labelColor: LABEL, labelSize: 9 }),
      r(34, 40, 62, 16, PLATE, { outline: false, label: `${volts} 3 W`, labelColor: LABEL, labelSize: 6 }),
    ],
  }))
}

// ---------------------------------------------------------------------------------------------
// Mean Well IRM (IRM-03-SPEC and IRM-05-SPEC, 2025-08-08, Mechanical Specification). The datasheet
// draws a BOTTOM view; these parts are seen from the top, so left and right swap (rows keep their
// place). Input 85-305 VAC. "Isolation Class II" and "Class II design (no FG pin)": isolation
// "double" (ruling B3) and protection class 2.
const irmElectrical = (d, ac, dc) => ({
  model: 'converter', acInput: { a: 'AC/L', b: 'AC/N', range: d.range },
  domains: [{ name: 'mains', pins: ac, kind: 'mains' }, { name: 'output', pins: dc, kind: 'selv' }],
  isolation: d.isolation, ...(d.isolation !== 'unknown' ? { isolationProvenance: 'datasheet' } : {}),
  ...(d.protection ? { protection: d.protection } : {}),
})
/** The AC input pins take either conductor: a converter input has no polarity. */
const acLine = (p) => (p.name?.startsWith('AC') ? { ...p, mains: 'line' } : p)
const irmName = (id, d) => `Mean Well ${id.toUpperCase().replace('3V3', '3.3')} AC-DC module (${d.volts} V, Class II)`
const irmShapes = (id, w, h) => [
  r(0, 0, w, h, POTTED, { radius: 3 }),
  r(w / 2 - 40, h / 2 - 18, 18, 14, MW_RED, { radius: 2, label: 'MW', labelColor: LABEL, labelSize: 7 }),
  r(w / 2 - 20, h / 2 - 18, 60, 14, POTTED, { outline: false, label: 'MEAN WELL', labelColor: LABEL, labelSize: 6 }),
  r(w / 2 - 40, h / 2, 80, 16, PLATE, { radius: 2, label: id.toUpperCase().replace('3V3', '3.3'), labelColor: LABEL, labelSize: 8 }),
]

// IRM-03 (37 x 24 mm): from below, AC/L and AC/N 5.08 mm apart at the top left and NC at the top
// right, +V and -V 5.08 mm apart at the bottom right. From above: NC top left, AC/N then AC/L at the
// top right; -V then +V at the bottom left. On a 16 x 10 unit body (37 mm is 14.6 units; the layout
// keeps a pin 2 units from each corner) the pins fall on units 12 and 14 (top) and 2 and 4 (bottom),
// NC on 2 (drawn, not a pin).
for (const [id, supply] of [['irm-03-5', '5V'], ['irm-03-3v3', '3V3']]) {
  const d = DATA[id]
  const types = { '+V': { type: 'power_out', supply }, '-V': { type: 'ground' } }
  const topRow = [...d.pins.bottomViewTopRow].reverse() // NC, AC/N, AC/L
  const bottomRow = [...d.pins.bottomViewBottomRow].reverse() // -V, +V
  if (topRow.join() !== 'NC,AC/N,AC/L' || bottomRow.join() !== '-V,+V') throw new Error(`${id}: the evidence pin rows changed; re-read the drawing`)
  const top = side('top', [null, null, null, null, null, null, null, null, null, null, 'AC/N', null, 'AC/L'], types, 16)
  const bottom = side('bottom', ['-V', null, '+V', null, null, null, null, null, null, null, null, null, null], types, 16)
  write(`${id}.json`, moduleJson({
    id, name: irmName(id, d), category: 'Mains', source: SRC[id], pins: [...top.pins, ...bottom.pins].map(acLine), wu: 16, hu: 10, inside: true,
    electrical: irmElectrical(d, ['AC/L', 'AC/N'], ['+V', '-V']),
    shapes: [...irmShapes(id, 160, 100), pinDot(20, 5)],
  }))
}

// IRM-05 (45.7 x 25.4 mm): from below, AC/L above AC/N (10.75 mm apart) at the left end and -V above
// +V (8 mm apart) at the right end, both 3.45 mm below the top edge. From above: -V over +V on the
// left, AC/L over AC/N on the right. On an 18 x 10 unit body: -V and +V on units 2 and 5 (8 mm is
// 3.1 units), AC/L and AC/N on 2 and 6 (10.75 mm is 4.2 units).
{
  const id = 'irm-05-5'
  const d = DATA[id]
  const types = { '+V': { type: 'power_out', supply: '5V' }, '-V': { type: 'ground' } }
  const [dcTop, dcBottom] = d.pins.bottomViewRight
  const [acTop, acBottom] = d.pins.bottomViewLeft
  const left = side('left', [dcTop, null, null, dcBottom, null, null, null, null], types, 10)
  const right = side('right', [acTop, null, null, null, acBottom, null, null, null], types, 10)
  write(`${id}.json`, moduleJson({
    id, name: irmName(id, d), category: 'Mains', source: SRC[id], pins: [...left.pins, ...right.pins].map(acLine), wu: 18, hu: 10, inside: true,
    electrical: irmElectrical(d, [acTop, acBottom], [dcTop, dcBottom]),
    shapes: irmShapes(id, 180, 100),
  }))
}

// ---------------------------------------------------------------------------------------------
// Lamp holders, seen from the lamp side: a round porcelain base, the brass screw shell and the centre
// contact; L is the centre contact and N the screw shell, each brought out to a terminal screw.
// E26: Leviton 9880 keyless porcelain, 250 V 660 W (no current rating given), 2 terminal screws and
// no earth; lamp Philips A19 E26 120 V. The grounded conductor goes on the screw shell (29 CFR
// 1910.305(j)(1)), so L and N are required and wiring it reversed carries the shell hazard (Ruling
// 38). E27: Vossloh-Schwabe 62061 (Ref. No. 535685), 4 A 250 V, with an earth screw; lamp Philips
// A60 E27 220-240 V. No N requirement on the E27 shell (ruling B7): both leads take either conductor.
const SHELL_HAZARD = 'Its screw shell is then live, so touching it while changing the bulb may shock.'
for (const [id, base] of [['lamp-holder-e26', 'E26'], ['lamp-holder-e27', 'E27']]) {
  const d = DATA[id]
  const polarized = base === 'E26'
  const leads = ['L', 'N', ...(d.earth ? ['PE'] : [])]
  const req = (n) => (n === 'PE' ? 'PE' : polarized ? n : 'line')
  const pins = [
    ...side('left', ['L'], {}, 6).pins, ...side('right', ['N'], {}, 6).pins, ...(d.earth ? side('bottom', ['PE'], {}, 6).pins : []),
  ].map((p) => ({ ...p, label: p.name, type: 'passive', mains: req(p.name) })) // labelled: a two-lead part shows only explicit labels, and here L and N matter
  write(`${id}.json`, moduleJson({
    id, name: `Lamp holder ${base} (${d.lampVolts} V lamp)`, category: 'Mains', source: SRC[id], pins, wu: 6, hu: 6,
    electrical: {
      model: 'lamp', conducts: [{ pins: ['L', 'N'], kind: 'load', range: d.range }],
      ...(d.protection ? { protection: d.protection } : {}),
      ratings: [rating(leads, 'terminal', d.service, d.volts, { ...(d.amps ? { amps: d.amps } : {}), provenance: 'datasheet' })],
      ...(polarized ? { polarityHazard: SHELL_HAZARD } : {}),
    },
    shapes: [
      r(0, 28, 12, 4, LEAD, { radius: 1 }), r(48, 28, 12, 4, LEAD, { radius: 1 }),
      ...(d.earth ? [r(28, 48, 4, 12, LEAD, { radius: 1 })] : []),
      r(4, 4, 52, 52, PORCELAIN, { radius: 26 }),
      r(12, 12, 36, 36, PORCELAIN_RIM, { radius: 18, outline: false }),
      r(16, 16, 28, 28, BRASS, { radius: 14 }),
      r(21, 21, 18, 18, BRASS_DARK, { radius: 9, outline: false }),
      r(26, 26, 8, 8, BRASS, { radius: 4 }),
      r(6, 26, 8, 8, SCREW, { radius: 4 }), r(46, 26, 8, 8, SCREW, { radius: 4 }),
      ...(d.earth ? [r(26, 46, 8, 8, EARTH, { radius: 4 })] : []),
    ],
  }))
}

// ---------------------------------------------------------------------------------------------
// In-line 5 x 20 mm fuse holder: Littelfuse 150274 (01500274Z), 10 A at 350 V for 5 x 20 mm fuses,
// AC and DC (product page), 16 AWG red leads. The fuse is a protective edge between the two leads;
// its rating is set on the sheet (fuseRating, no default: unknown until set) and the holder may be empty.
{
  const id = 'fuse-holder-5x20-inline'
  const d = DATA[id]
  write(`${id}.json`, moduleJson({
    id, name: 'Fuse holder, in-line, 5 x 20 mm (Littelfuse 150274)', category: 'Mains', source: SRC[id],
    pins: [{ name: '1', side: 'left', type: 'passive' }, { name: '2', side: 'right', type: 'passive' }], wu: 8, hu: 4,
    electrical: {
      model: 'fuse', protective: [{ from: '1', to: '2', kind: 'fuse' }], params: { fuseRating: { unit: 'A' } }, settings: { fuse: ['fitted', 'absent'] },
      ratings: [rating(['1', '2'], 'terminal', d.service, d.volts, { amps: d.amps, provenance: 'datasheet' })],
    },
    shapes: [
      r(0, 18, 16, 4, WIRE_RED, { radius: 2 }), r(64, 18, 16, 4, WIRE_RED, { radius: 2 }),
      r(12, 11, 30, 18, HOLDER, { radius: 6 }),
      r(38, 9, 30, 22, CAP, { radius: 7 }),
      r(46, 9, 2, 22, HOLDER, { outline: false }), r(52, 9, 2, 22, HOLDER, { outline: false }), r(58, 9, 2, 22, HOLDER, { outline: false }),
    ],
  }))
}

// ---------------------------------------------------------------------------------------------
// Wago 221 lever connectors (221-412, 221-413, 221-415 datasheets): every opening is one node.
// Ratings per EN 60664, overvoltage category II and pollution degree 2: 450 V 32 A, recorded ac/dc
// (the rating says neither) with those conditions. UL 486C use group C: 600 V 20 A (not modelled).
// Seen from above: the openings along the left edge 2 units apart, an orange lever for each; the
// 221-415 comes out 12 x 7 units, close to its real 30 x 18.5 mm.
for (const [id, n] of [['wago-221-412', 2], ['wago-221-413', 3], ['wago-221-415', 5]]) {
  const d = DATA[id]
  const names = Array.from({ length: n }, (_, i) => String(i + 1))
  const hu = 2 * n + 2
  const left = side('left', names.flatMap((x, i) => (i ? [null, x] : [x])), {}, hu)
  write(`${id}.json`, moduleJson({
    id, name: `Wago ${id.slice(5)} lever connector (${n} conductors)`, category: 'Mains', source: SRC[id], pins: left.pins, internal: [names], wu: 7, hu,
    electrical: { model: 'connector', ratings: [rating(names, 'terminal', d.service, d.volts, { amps: d.amps, provenance: 'datasheet', conditions: d.conditions })] },
    shapes: [
      r(0, 0, 70, hu * 10, CLEAR, { radius: 4 }),
      ...left.at.flatMap((y) => [r(3, y - 5, 10, 10, OPENING, { radius: 2, outline: false }), r(18, y - 7, 46, 14, ORANGE, { radius: 3 })]),
    ],
  }))
}

finish('gen-mains-loads.mjs')
