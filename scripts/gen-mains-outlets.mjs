// Generates the built-in wall outlets (category Mains): US NEMA 5-15R and 5-20R duplex receptacles,
// a UK BS 1363 socket, a Schuko (CEE 7/3) and a French (CEE 7/5) socket, an AU/NZ AS/NZS 3112
// socket and Japanese 1-15R duplex receptacles (unpolarized, and polarized with the longer neutral
// slot). Each is a board whose hole groups are its socket contacts, placed on the stylized family
// pattern of src/format/plugging.ts through lib/mains.mjs; the real layout, L side and rating come
// from the standards and reference products cited per part in src/format/mainsEvidence.ts (SRC,
// and `rated` reads each rating from there). Intact-link duplexes only: both faces share L, N and
// PE (spec 4).
//
// Run from the repo root: `node scripts/gen-mains-outlets.mjs` (add `--check` to compare with modules/
// without writing). src/format/mainsParts.test.ts pins the contacts and ratings.
import { finish } from './lib/gen-output.mjs'
import { moduleJson, r, write } from './lib/parts.mjs'
import { rated, rating, socket } from './lib/mains.mjs'

import { EVIDENCE } from '../src/format/mainsEvidence.ts'
/** Each module's `source`: every URL Task 0 used, standard first. */
const SRC = Object.fromEntries(Object.entries(EVIDENCE).map(([id, e]) => [id, e.sources.join(' ')]))

/**
 * The region's nominal supply: the `acVoltage` default (editable on the sheet) and `ac.hz`. Japan is
 * 100 V at 50 Hz (east) or 60 Hz (west); 50 Hz is the default here (plan Task 16).
 */
const NOMINAL = { us: { volts: 120, hz: 60 }, jp: { volts: 100, hz: 50 }, eu: { volts: 230, hz: 50 }, uk: { volts: 230, hz: 50 }, au: { volts: 230, hz: 50 } }

// Sticker palette: an ivory wall plate, a lighter face, dark slots, metal earth parts.
const PLATE = '#F2EEE3', FACE = '#FBF9F3', SLOT = '#2B2F36', METAL = '#C9CED6', SCREW = '#B8BEC7'
const WHITE = '#F5F5F2', RECESS = '#E6E2DA'

/** A slot or hole: fine detail, so no ink outline (the renderer draws the contact's hole on top). */
const slot = (x, y, w, h, radius = 1) => r(x, y, w, h, SLOT, { radius, outline: false })

/** A screw head with its slot, centred at (cx, cy). */
const screw = (cx, cy) => [r(cx - 4, cy - 4, 8, 8, SCREW, { radius: 4 }), r(cx - 3, cy - 0.5, 6, 1, SLOT, { outline: false })]

/** Everything an outlet declares; `holes` and `sockets` come from lib/mains.mjs `socket`. */
function outlet({ id, name, region, holes, sockets, internal, source, wu, hu, shapes }) {
  const { volts, amps, service } = rated(id)
  const { volts: nominal, hz } = NOMINAL[region]
  const has = (g) => holes.some((h) => h.name === g)
  const [l, n, pe] = sockets[0].contacts.reduce((a, c) => ((a[['L', 'N', 'PE'].indexOf(c.role)] = c.group), a), [])
  write(`${id}.json`, moduleJson({
    id, name, category: 'Mains', source, pins: [], internal, wu, hu, holes, obstacle: false, shapes,
    electrical: {
      model: 'outlet', params: { acVoltage: { unit: 'VAC', default: nominal } }, ac: { hz, region },
      acSources: [{ id: 'supply', live: [l], neutral: [n], ...(pe && has(pe) ? { earth: [pe] } : {}) }],
      sockets,
      ratings: [rating(holes.map((h) => h.name), 'terminal', service, volts, { amps, provenance: 'datasheet' })],
    },
  }))
}

/**
 * A NEMA face centred at (cx, cy) on the NEMA pattern (N at -10, L at +10, earth 20 below): neutral
 * slot on the left (taller when polarized), line slot on the right, the round earth hole below.
 */
function nemaFace(cx, cy, { earth, polarized, tee = false }) {
  const n = polarized ? 18 : 14
  return [
    r(cx - 22, cy - 16, 44, earth ? 44 : 32, FACE, { radius: 14 }),
    slot(cx - 12, cy - n / 2, 4, n),
    ...(tee ? [slot(cx - 17, cy - 2, 7, 4)] : []),
    slot(cx + 8, cy - 7, 4, 14),
    ...(earth ? [slot(cx - 4, cy + 16, 8, 8, 4)] : []),
  ]
}

/** A duplex receptacle on an 80 x 140 plate: two faces at (40, 40) and (40, 100) on one supply (intact link). */
function duplex({ id, name, family, region, polarized, tee = false }) {
  const a = socket(family, 'upper', 40, 40, '1')
  const b = socket(family, 'lower', 40, 100, '2')
  const holes = [...a.holes, ...b.holes]
  const earth = holes.some((h) => h.name === 'PE1')
  const internal = [['L1', 'L2'], ['N1', 'N2'], ...(earth ? [['PE1', 'PE2']] : [])]
  outlet({
    id, name, region, holes, sockets: [a.socket, b.socket], internal, source: SRC[id], wu: 8, hu: 14,
    shapes: [
      r(0, 0, 80, 140, PLATE, { radius: 8 }),
      r(14, 10, 52, 120, FACE, { radius: 6 }),
      ...nemaFace(40, 40, { earth, polarized, tee }),
      ...nemaFace(40, 100, { earth, polarized, tee }),
      ...screw(40, earth ? 76 : 70),
    ],
  })
}

/** A single socket on an 80 x 80 plate, centred at (40, 40). */
function single({ id, name, family, region, face }) {
  const s = socket(family, 'main', 40, 40)
  outlet({ id, name, region, holes: s.holes, sockets: [s.socket], source: SRC[id], wu: 8, hu: 8, shapes: face })
}

// ---------------------------------------------------------------------------------------------
// US: NEMA 5-15R and 5-20R (ANSI/NEMA WD 6-2016 Figures 5-15 and 5-20), 125 V 15 A and 20 A. Real
// spacing: blade slots 0.500 in (12.7 mm) apart, earth hole centre 0.468 in (11.9 mm) from the slot
// line. Seen from the front with the earth hole down: neutral (the longer slot, W) left, line right.
// The 5-20R neutral is T-shaped. Faces: Leviton T5320-W and 5352.
duplex({ id: 'outlet-us-5-15r-duplex', name: 'US outlet NEMA 5-15R duplex (15 A, 120 V)', family: 'nema-5-15r', region: 'us', polarized: true })
duplex({ id: 'outlet-us-5-20r-duplex', name: 'US outlet NEMA 5-20R duplex (20 A, 120 V)', family: 'nema-5-20r', region: 'us', polarized: true, tee: true })

// Japan: JIS C 8303:2007 Figure A.1, 2-pole 15 A 125 V, on a 100 V supply. Real spacing: slots
// 12.7 mm apart. Unpolarized (note a): both holes 7 mm, neither marked. Polarized: the grounded-side
// (N) hole is the longer one (8.7 mm against 7 mm), on the left seen from the front.
duplex({ id: 'outlet-jp-1-15r-duplex', name: 'Japan outlet 1-15R duplex (15 A, 100 V, 50 Hz)', family: 'nema-1-15r', region: 'jp', polarized: false })
duplex({ id: 'outlet-jp-1-15r-duplex-polarized', name: 'Japan outlet 1-15R duplex, polarized (15 A, 100 V, 50 Hz)', family: 'nema-1-15r-polarized', region: 'jp', polarized: true })

// UK: BS 1363 (secondary sources, ruling B1), 13 A 250 V. Real spacing: line and neutral centres
// 22.2 mm apart, earth centre line 22.2 mm from the line/neutral centre line. Seen from the front
// with the earth aperture up: N bottom left, L bottom right. Contacts: L (70, 50), N (10, 50), PE (40, 20).
single({ id: 'outlet-uk-bs1363', name: 'UK outlet BS 1363 single (13 A, 230 V)', family: 'bs1363', region: 'uk', face: [
  r(0, 0, 80, 80, WHITE, { radius: 6 }),
  r(3, 3, 74, 74, FACE, { radius: 4, outline: false }),
  slot(37, 12, 6, 16),
  slot(5, 47, 11, 6), slot(64, 47, 11, 6),
  ...screw(40, 68),
] })

// Schuko: CEE 7/3, DIN 49440 (secondary sources, ruling B1), 16 A 250 V. Real spacing: 4.8 mm pins,
// centres 19 mm apart. Unpolarized (L side not fixed). A round recess with two pin holes and the
// earth clips at its top and bottom. Contacts: L (20, 40), N (60, 40), PE (40, 10) and (40, 70).
single({ id: 'outlet-schuko-cee7-3', name: 'Schuko outlet CEE 7/3 (16 A, 230 V)', family: 'cee7-3', region: 'eu', face: [
  r(0, 0, 80, 80, WHITE, { radius: 8 }),
  r(4, 4, 72, 72, RECESS, { radius: 36 }),
  slot(15, 35, 10, 10, 5), slot(55, 35, 10, 10, 5),
  r(32, 7, 16, 6, METAL, { radius: 2 }), r(32, 67, 16, 6, METAL, { radius: 2 }),
] })

// French: CEE 7/5, NF C 61-314 (secondary sources, ruling B1), 16 A 250 V. Real spacing: holes 19 mm
// apart, the earth pin centred between them and offset 10 mm. L side not fixed (ruling B5). A round
// recess with two pin holes and the protruding earth pin. Contacts: L (20, 40), N (60, 40), PE (40, 10).
single({ id: 'outlet-fr-cee7-5', name: 'French outlet CEE 7/5 (16 A, 230 V)', family: 'cee7-5', region: 'eu', face: [
  r(0, 0, 80, 80, WHITE, { radius: 8 }),
  r(4, 4, 72, 72, RECESS, { radius: 36 }),
  slot(15, 35, 10, 10, 5), slot(55, 35, 10, 10, 5),
  r(35, 5, 10, 10, METAL, { radius: 5 }),
] })

// AU/NZ: AS/NZS 3112 (secondary sources, ruling B1), 10 A 250 V. Real spacing: active and neutral
// centred 7.92 mm from the midpoint at 30 degrees to the vertical, earth centred 10.31 mm away. Seen
// from the front with the earth down: active (L) top left, neutral top right (ruling B4). The two
// flat slots form an inverted V, each drawn as a row of overlapping rounded rects. Contacts: L (30, 30), N (60, 30), PE (40, 60).
const tilted = (cx, cy, dir) => [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((k) => slot(cx - 2 - k * dir * 0.7, cy - 2 + k * 1.3, 4, 4, 2))
single({ id: 'outlet-au-as3112', name: 'AU/NZ outlet AS/NZS 3112 single (10 A, 230 V)', family: 'as3112', region: 'au', face: [
  r(0, 0, 80, 80, WHITE, { radius: 6 }),
  r(6, 6, 68, 68, FACE, { radius: 6 }),
  ...tilted(30, 30, 1), ...tilted(60, 30, -1),
  slot(37, 52, 6, 16),
] })

finish('gen-mains-outlets.mjs')
