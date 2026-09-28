// Generates the built-in plug-in devices (category Mains): USB wall chargers (5 V) and barrel-jack
// wall adapters for US/Japan, Europe, UK and AU/NZ, and cord plugs, 3-lead and 2-lead, per family.
// Prongs are internal nodes (spec 2) placed on the family pattern of src/format/plugging.ts around
// the body's pivot, so a device dropped on a matching outlet seats; leads are ordinary pins on the
// bottom edge. Ratings, input ranges, isolation and the UK fuse come from src/format/mainsEvidence.ts
// (Task 0), and a part whose evidence is not VERIFIED is never generated (lib/mains.mjs `verified`).
// A value a source does not state is left out, and isolation not stated is "unknown".
//
// Run from the repo root: `node scripts/gen-mains-plugs.mjs` (add `--check` to compare with modules/
// without writing). src/format/mainsParts.test.ts pins the prongs, leads, ratings and seating.
import { finish } from './lib/gen-output.mjs'
import { moduleJson, r, side, write } from './lib/parts.mjs'
import { plugProfiles, prongs, rated, rating, verified } from './lib/mains.mjs'

import { EVIDENCE } from '../src/format/mainsEvidence.ts'
/** Each module's `source`: every URL Task 0 used, standard first. */
const SRC = Object.fromEntries(Object.entries(EVIDENCE).map(([id, e]) => [id, e.sources.join(' ')]))
/** What the converters need, straight from the evidence. Isolation is "unknown" unless the source states the class (Global Constraints). */
const DATA = Object.fromEntries(Object.entries(EVIDENCE).map(([id, e]) => [id, {
  range: e.acInput?.value, isolation: e.isolation?.value ?? 'unknown', protection: e.protection?.value, fuse: e.extra?.fuse?.value, volts: e.output?.value.volts,
}]))

// Sticker palette: white and black plastic bodies, a steel USB-A shell with its blue tongue, a
// black barrel plug on a grey cable, brass-coloured lead ends, a red fuse carrier.
const WHITE = '#F5F5F2', SEAM = '#E3E0D8', DARK = '#2B2F36', DARK_FACE = '#3A3F48', USB = '#C9CED6', USB_TONGUE = '#1E4F8A'
const CABLE = '#5B616B', LEAD = '#B8BEC7', LED = '#7BD389', FUSE = '#D9534F', PRONG = '#AEB5BF', ISOD = '#D8D4CA'

/**
 * The four NGE12 AC plugs (Mean Well AC PLUG-US4, -EU4, -UK4, -AU4) and the pattern each is read as
 * (mainsEvidence.ts `charger`): US as the unpolarized nema-1-15p (the sheet does not say it has a wide
 * neutral blade), EU as the CEE 7/16 Europlug, UK as BS 1363, AU as AS/NZS 3112. The UK plug's earth
 * pin fills the BS 1363 earth position without carrying a conductor ("Class II power (no earth pin)",
 * Ruling 39), so it is a mechanical contact named "E pin".
 */
const FAMILY = {
  us: { family: 'nema-1-15p', wu: 6, hu: 6, region: 'US/Japan (NEMA 1-15P)' },
  eu: { family: 'cee7-16', wu: 8, hu: 8, region: 'Europe (Europlug)' },
  uk: { family: 'bs1363', wu: 8, hu: 8, region: 'UK (BS 1363)', mechanicalEarth: true },
  au: { family: 'as3112', wu: 6, hu: 6, region: 'AU/NZ (AS/NZS 3112)' },
}
/** The insulated earth pin of a class II BS 1363 plug (Ruling 39). */
const E_PIN = 'E pin'

/**
 * Electrical data shared by chargers and adapters: AC input on the L and N prongs; the mains and
 * output domains; isolation and protection from the evidence. No fuse edge on the UK devices: Mean
 * Well states no fuse in AC PLUG-UK4 (ruling B6). A device without an input range is not generated.
 */
function converter(id, region, outputs) {
  const f = FAMILY[region]
  const d = DATA[id]
  verified(id)
  if (!d.range) throw new Error(`${id}: the evidence records no AC input range, so the part is not generated`)
  const nodes = prongs(['L', 'N'])
  const stated = d.isolation !== 'unknown'
  return {
    model: 'converter', internalNodes: f.mechanicalEarth ? [...nodes, E_PIN] : nodes,
    acInput: { a: 'L prong', b: 'N prong', range: d.range },
    domains: [{ name: 'mains', pins: nodes, kind: 'mains' }, { name: 'output', pins: outputs, kind: 'selv' }],
    isolation: d.isolation, ...(stated ? { isolationProvenance: 'datasheet' } : {}),
    ...(d.protection ? { protection: d.protection } : {}),
    plug: { family: f.family, profiles: plugProfiles(f.family, f.wu * 5, f.hu * 5, ['L', 'N'], f.mechanicalEarth ? { PE: E_PIN } : {}) },
  }
}

/**
 * The prongs seen through the body, one shape per contact of the family's first profile (and the
 * CEE 7/7 earth clips), so the plug type reads at a glance and a seated device's leg dots sit on
 * them: flat NEMA blades (the polarized neutral wider) and a round earth, round CEE pins, BS 1363
 * flat pins with a vertical earth (an insulated one in plastic), AS/NZS 3112 blades in an inverted V.
 */
function prongArt(family, profiles) {
  const out = []
  const blade = (x, y, w, h, fill = PRONG, radius = 1) => out.push(r(x - w / 2, y - h / 2, w, h, fill, { radius, outline: false }))
  const tilted = (x, y, dir) => [-3, -2, -1, 0, 1, 2, 3].forEach((k) => blade(x - k * dir * 0.7, y + k * 1.3, 4, 4, PRONG, 2))
  for (const c of profiles[0].contacts) {
    const { x, y } = c.at
    if (c.mains === 'mechanical') blade(x, y, 5, 12, ISOD)
    else if (family.startsWith('nema')) {
      if (c.mains === 'PE') blade(x, y, 6, 7, PRONG, 3)
      else blade(x, y, c.mains === 'N' && family !== 'nema-1-15p' ? 5 : 3, 12)
    } else if (family.startsWith('cee')) {
      if (c.mains === 'PE') blade(x, y, 14, 4)
      else blade(x, y, 6, 6, PRONG, 3)
    } else if (family === 'bs1363') blade(x, y, c.mains === 'PE' ? 5 : 11, c.mains === 'PE' ? 12 : 5)
    else if (c.mains === 'PE') blade(x, y, 4, 12)
    else tilted(x, y, c.mains === 'L' ? 1 : -1)
  }
  // The CEE 7/7 earth hole sits between its earth clips (profile "earth-hole").
  if (family === 'cee7-7') for (const c of profiles[1].contacts.filter((q) => q.mains === 'PE')) blade(c.at.x, c.at.y, 5, 5, DARK, 2.5)
  return out
}

for (const region of ['us', 'eu', 'uk', 'au']) {
  const f = FAMILY[region]
  const W = f.wu * 10, H = f.hu * 10
  // USB wall charger: Mean Well NGE12I05-USB ("DC VOLTAGE 5V, RATED CURRENT 2.4A; USB-type A for 5V
  // model only"), a USB-A port on the front face; its VBUS and GND are the 5V and GND pins.
  {
    const id = `charger-usb-5v-${region}`
    if (DATA[id].volts !== 5) throw new Error(`${id}: the evidence does not give a 5 V output`)
    const bottom = side('bottom', ['5V', null, 'GND'], { '5V': { type: 'power_out', supply: '5V' }, GND: { type: 'ground' } }, f.wu)
    const el = converter(id, region, ['5V', 'GND'])
    write(`${id}.json`, moduleJson({
      id, name: `USB wall charger 5 V, ${f.region}`, category: 'Mains', source: SRC[id], pins: bottom.pins, wu: f.wu, hu: f.hu,
      electrical: el,
      shapes: [
        r(0, 0, W, H, WHITE, { radius: 10 }),
        r(4, H - 24, W - 8, 20, SEAM, { radius: 6, outline: false }),
        ...prongArt(f.family, el.plug.profiles),
        r(W - 12, 7, 5, 5, LED, { radius: 2.5, outline: false }),
        r(W / 2 - 13, H - 19, 26, 11, USB, { radius: 2 }),
        r(W / 2 - 9, H - 16, 18, 4, USB_TONGUE, { outline: false }),
      ],
    }))
  }
  // Barrel-jack wall adapter: Mean Well NGE12I12-P1J ("DC VOLTAGE 12V, RATED CURRENT 1.0A; P1J: 2.1
  // x 5.5 x 11 mm, C+"); its output voltage is the part's value, on the + output.
  {
    const id = `adapter-barrel-${region}`
    const bottom = side('bottom', ['+', null, '-'], { '+': { type: 'power_out' }, '-': { type: 'ground' } }, f.wu)
    const el = converter(id, region, ['+', '-'])
    if (DATA[id].volts === undefined) throw new Error(`${id}: the evidence records no output voltage`)
    write(`${id}.json`, moduleJson({
      id, name: `Wall adapter, barrel jack, ${f.region}`, category: 'Mains', source: SRC[id], pins: bottom.pins, wu: f.wu, hu: f.hu,
      electrical: { ...el, params: { voltage: { unit: 'V', default: DATA[id].volts } } },
      shapes: [
        r(0, 0, W, H, DARK, { radius: 10 }),
        r(5, 5, W - 10, H - 24, DARK_FACE, { radius: 7, outline: false }),
        ...prongArt(f.family, el.plug.profiles),
        r(W - 12, 7, 5, 5, LED, { radius: 2.5, outline: false }),
        r(W / 2 - 8, H - 18, 16, 8, DARK, { radius: 3 }),
        r(W / 2 - 3, H - 10, 6, 10, CABLE, { outline: false }),
      ],
    }))
  }
}

/**
 * A cord plug: prongs on the pattern, leads L, N (and PE) on the bottom edge, each joined to its
 * prong inside; a fused plug's L goes through its fuse instead (a protective edge, `fuseRating`
 * default from the evidence). `mechanicalEarth` is an insulated earth pin that joins nothing
 * (Ruling 39). Leads carry "L" and "N" on a polarized family and "line" on the others.
 */
function cordPlug({ id, name, family, roles, leads, wu, hu, polarized, fused = false, mechanicalEarth = false }) {
  const { volts, amps, service } = rated(id)
  const W = wu * 10, H = hu * 10
  const req = (c) => (c === 'PE' ? 'PE' : polarized ? c : 'line')
  // A free slot between leads keeps their labels apart, where the edge has room for it (a side keeps a corner slot free at each end).
  const spaced = 2 * leads.length - 1 <= wu - 2
  const bottom = side('bottom', spaced ? leads.flatMap((c, i) => (i ? [null, c] : [c])) : leads, {}, wu)
  const pins = bottom.pins.map((p) => ({ ...p, mains: req(p.name) }))
  const internal = leads.filter((c) => !(fused && c === 'L')).map((c) => [`${c} prong`, c])
  const fuse = DATA[id].fuse
  if (fused && typeof fuse !== 'number') throw new Error(`${id}: the evidence records no fuse rating`)
  const plug = { family, profiles: plugProfiles(family, wu * 5, hu * 5, roles, mechanicalEarth ? { PE: E_PIN } : {}) }
  write(`${id}.json`, moduleJson({
    id, name, category: 'Mains', source: SRC[id], pins, internal, wu, hu,
    electrical: {
      model: 'cord-plug', internalNodes: mechanicalEarth ? [...prongs(roles), E_PIN] : prongs(roles),
      ...(fused ? { protective: [{ from: 'L prong', to: 'L', kind: 'fuse' }], params: { fuseRating: { unit: 'A', default: fuse } } } : {}),
      plug,
      ratings: [rating([...leads, ...prongs(roles)], 'terminal', service, volts, { amps, provenance: 'datasheet' })],
    },
    shapes: [
      r(0, 0, W, H - 8, DARK, { radius: 8 }),
      r(4, 4, W - 8, H - 16, DARK_FACE, { radius: 5, outline: false }),
      // The cord leaves through a boot at the bottom; each lead end is a bare wire.
      r(bottom.at[0] - 6, H - 12, bottom.at[bottom.at.length - 1] - bottom.at[0] + 12, 12, DARK, { radius: 3 }),
      ...bottom.at.map((x) => r(x - 1.5, H - 4, 3, 4, LEAD, { outline: false })),
      ...(fused ? [r(W / 2 - 12, H / 2 - 4 + 10, 24, 8, FUSE, { radius: 2 })] : []),
      ...prongArt(family, plug.profiles),
    ],
  }))
}

// NEMA WD 6: 5-15P 15 A 125 V, reference Leviton 515PV ("15 Amp, 125 Volt, NEMA 5-15P"); in the
// socket frame with the earth down the wide (W, neutral) blade is left, L right.
cordPlug({ id: 'plug-us-5-15p', name: 'Cord plug US NEMA 5-15P, 3-lead', family: 'nema-5-15p', roles: ['L', 'N', 'PE'], leads: ['L', 'N', 'PE'], wu: 6, hu: 6, polarized: true })
// NEMA WD 6: 1-15P polarized 15 A 125 V, reference Leviton 101-P ("Polarized, Non-Grounding"): the wide neutral blade enters the W slot only.
cordPlug({ id: 'plug-us-1-15p', name: 'Cord plug US NEMA 1-15P polarized, 2-lead', family: 'nema-1-15p-polarized', roles: ['L', 'N'], leads: ['L', 'N'], wu: 6, hu: 6, polarized: true })
// JIS C 8303 Figure A.1: 2-pole 15 A 125 V, both blades 6.3 mm wide when not polarized (note a), 12.7 mm apart.
cordPlug({ id: 'plug-jp-1-15p', name: 'Cord plug Japan 1-15P, 2-lead', family: 'nema-1-15p', roles: ['L', 'N'], leads: ['L', 'N'], wu: 6, hu: 6, polarized: false })
// CEE 7/7 (secondary sources, ruling B1): 16 A 250 V, 4.8 mm pins; earth clips for CEE 7/3 and an earth hole for CEE 7/5; L side not fixed.
cordPlug({ id: 'plug-eu-cee7-7', name: 'Cord plug Schuko/French CEE 7/7, 3-lead', family: 'cee7-7', roles: ['L', 'N', 'PE'], leads: ['L', 'N', 'PE'], wu: 8, hu: 8, polarized: false })
// CEE 7/16 Europlug, EN 50075 (secondary sources, ruling B1): 2.5 A 250 V, enters either way round.
cordPlug({ id: 'plug-eu-cee7-16', name: 'Cord plug Europlug CEE 7/16, 2-lead', family: 'cee7-16', roles: ['L', 'N'], leads: ['L', 'N'], wu: 8, hu: 8, polarized: false })
// BS 1363-1 (secondary sources, ruling B1): 13 A 250 V, a BS 1362 cartridge fuse in L (13 A default,
// editable); in the socket frame with the earth up, N bottom left and L bottom right. The 2-lead plug
// keeps its earth pin, insulated (the ISOD, "necessary to open the safety shutters"), joined to nothing.
cordPlug({ id: 'plug-uk-bs1363-3lead', name: 'Cord plug UK BS 1363, fused, 3-lead', family: 'bs1363', roles: ['L', 'N', 'PE'], leads: ['L', 'N', 'PE'], wu: 8, hu: 8, polarized: true, fused: true })
cordPlug({ id: 'plug-uk-bs1363-2lead', name: 'Cord plug UK BS 1363, fused, 2-lead', family: 'bs1363', roles: ['L', 'N'], leads: ['L', 'N'], wu: 8, hu: 8, polarized: true, fused: true, mechanicalEarth: true })
// AS/NZS 3112 (secondary sources, ruling B1): 10 A 250 V; in the socket frame with the earth down the
// active (L) is top left (ruling B4). The 2-pin plug omits the earth pin and is still polarized.
cordPlug({ id: 'plug-au-as3112-3lead', name: 'Cord plug AU/NZ AS/NZS 3112, 3-lead', family: 'as3112', roles: ['L', 'N', 'PE'], leads: ['L', 'N', 'PE'], wu: 6, hu: 6, polarized: true })
cordPlug({ id: 'plug-au-as3112-2lead', name: 'Cord plug AU/NZ AS/NZS 3112, 2-lead', family: 'as3112', roles: ['L', 'N'], leads: ['L', 'N'], wu: 6, hu: 6, polarized: true })

finish('gen-mains-plugs.mjs')
