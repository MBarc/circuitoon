// Generates the built-in terminal blocks (category Mains): Phoenix Contact MSTB 2,5 (5.08 mm) and
// MC 1,5 (3.81 mm) pluggable blocks, 2 to 6 positions, each drawn as the plug with its header; and
// the common KF2EDG (5.08 mm) and KF301 (5.0 mm) clones, whose ratings are unverified. Every Phoenix
// item number and rating comes from src/format/mainsEvidence.ts (Task 0, and the ruling B8 retry of
// Task 19), each rating with the conditions Phoenix states for it; a part whose evidence is not
// VERIFIED is never generated (lib/mains.mjs `verified`).
//
// Each position n is a screw (wire) terminal `n` on the left and its PCB header pin `n pcb` (label n)
// on the right, joined by `internal` (the plug side to header side is a zero edge, spec 1.2). A KF301
// is a fixed PCB terminal, not pluggable; its `n pcb` pins are its PCB legs, the same zero join.
//
// Run from the repo root: `node scripts/gen-mains-terminals.mjs` (add `--check` to compare with
// modules/ without writing). src/format/mainsParts.test.ts pins the item numbers, joins and ratings.
import { finish } from './lib/gen-output.mjs'
import { moduleJson, r, side, write } from './lib/parts.mjs'
import { rating, verified } from './lib/mains.mjs'

/** The Phoenix parts, straight from the evidence: item numbers, sources and every rating with its conditions. */
const PHOENIX = { mstb: {}, mc: {} }
for (const [series, pitch] of [['mstb', '508'], ['mc', '381']])
  for (let n = 2; n <= 6; n++) {
    const e = verified(`terminal-block-${series}-${pitch}-${n}`)
    PHOENIX[series][n] = {
      plug: e.extra.plug.value, header: e.extra.header.value, url: e.sources.join(' '),
      ratings: e.ratings.map((x) => ({ volts: x.volts, amps: x.amps, conditions: x.conditions, service: x.service })),
    }
  }
/** The clones: a vendor listing's rating, recorded with provenance unverified. */
const CLONE = Object.fromEntries(['terminal-block-kf2edg-508-2', 'terminal-block-kf2edg-508-3', 'terminal-block-kf301-500-2', 'terminal-block-kf301-500-3'].map((id) => {
  const e = verified(id)
  return [id, { url: e.sources.join(' '), volts: e.ratings[0].volts, amps: e.ratings[0].amps, service: e.ratings[0].service }]
}))

// Sticker palette: Phoenix green plug and darker header, a blue clone body, steel screw heads with dark slots.
const GREEN = '#2F9E6E', GREEN_DARK = '#1F7A55', BLUE = '#2F7FD0', BLUE_DARK = '#23629F', METAL = '#C9CED6', SLOT = '#2B2F36'

function block({ id, name, source, n, ratings, color, header }) {
  const pos = Array.from({ length: n }, (_, i) => String(i + 1))
  const hu = n * 2 + 1
  const left = side('left', pos.flatMap((p, i) => (i ? [null, p] : [p])), {}, hu)
  const right = side('right', pos.flatMap((p, i) => (i ? [null, `${p} pcb|${p}`] : [`${p} pcb|${p}`])), {}, hu)
  const pins = [...pos, ...pos.map((p) => `${p} pcb`)]
  write(`${id}.json`, moduleJson({
    id, name, category: 'Mains', source, pins: [...left.pins, ...right.pins], internal: pos.map((p) => [p, `${p} pcb`]), wu: 7, hu, inside: true,
    electrical: {
      model: 'terminal-block',
      ratings: ratings.map((x) => rating(pins, 'terminal', x.service, x.volts, { ...(x.amps ? { amps: x.amps } : {}), provenance: x.provenance, ...(x.conditions ? { conditions: x.conditions } : {}) })),
    },
    shapes: [
      r(0, 0, 42, hu * 10, color, { radius: 3 }), r(42, 0, 28, hu * 10, header, { radius: 3 }),
      ...left.at.flatMap((y) => [r(23, y - 6, 12, 12, METAL, { radius: 6 }), r(28, y - 4, 2, 8, SLOT, { outline: false })]),
    ],
  }))
}

// Phoenix: MSTB 2,5/ n-ST-5,08 plug on MSTBA 2,5/ n-G-5,08 header, MC 1,5/ n-ST-3,81 plug on
// MC 1,5/ n-G-3,81 header (item numbers and ratings per mainsEvidence.ts `phoenixPart`).
for (const [series, pitch, label] of [['mstb', '508', 'MSTB 2,5 (5.08 mm)'], ['mc', '381', 'MC 1,5 (3.81 mm)']])
  for (let n = 2; n <= 6; n++) {
    const p = PHOENIX[series][n]
    block({
      id: `terminal-block-${series}-${pitch}-${n}`, name: `Terminal block Phoenix Contact ${label}, ${n} positions (plug ${p.plug}, header ${p.header})`,
      source: p.url, n, color: GREEN, header: GREEN_DARK, ratings: p.ratings.map((x) => ({ ...x, provenance: 'datasheet' })),
    })
  }

// Clones: Cixi Kefa KF2EDG-STD-5.08 (listing: 300 V 10 A) and KF301-5.0 (LCSC: 250 V 17 A).
for (const [id, name, n] of [
  ['terminal-block-kf2edg-508-2', 'Terminal block KF2EDG 5.08 mm clone, 2 positions', 2], ['terminal-block-kf2edg-508-3', 'Terminal block KF2EDG 5.08 mm clone, 3 positions', 3],
  ['terminal-block-kf301-500-2', 'Terminal block KF301 5.0 mm clone, 2 positions', 2], ['terminal-block-kf301-500-3', 'Terminal block KF301 5.0 mm clone, 3 positions', 3],
])
  block({ id, name, source: CLONE[id].url, n, color: BLUE, header: BLUE_DARK, ratings: [{ volts: CLONE[id].volts, amps: CLONE[id].amps, service: CLONE[id].service, provenance: 'unverified' }] })

finish('gen-mains-terminals.mjs')
