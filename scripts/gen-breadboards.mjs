// Generates the built-in breadboards: full (830 holes), half (400), mini (170), tiny (25) and a
// power rail strip. Every connected set of holes (a 5-hole terminal strip, a power rail) is one
// hole group; the art is only the body, center channel, rail stripes and labels, so the JSON stays
// small and the renderer draws the holes from the groups. Layout per the breadboards design spec
// (docs/superpowers/specs/2026-09-25-breadboards-design.md); generic boards, so no `source`.
//
// Run from the repo root: `node scripts/gen-breadboards.mjs`
// It overwrites those files in modules/ in place; src/format/breadboards.test.ts pins the layout.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const OUT = fileURLToPath(new URL('../modules/', import.meta.url))

const BODY = '#FFFFFF', CHANNEL = '#E4E7EC', RED = '#E0483E', BLUE = '#3D6FD6', TEXT = '#8A929C'
const P = 10 // hole pitch, px (0.1 inch)

const r = (x, y, w, h, fill, extra = {}) => ({ type: 'rect', x, y, w, h, fill, ...extra })
/** A small silkscreen label centered on (cx, cy); its plate matches the body so only the text shows. */
const text = (cx, cy, label) => r(cx - 6, cy - 4, 12, 8, BODY, { outline: false, label, labelColor: TEXT, labelSize: 6 })
const stripe = (x0, x1, y, fill) => r(x0, y, x1 - x0, 2, fill, { outline: false })
const group = (name, label, at, rail) => (rail ? { name, label, at, rail } : { name, label, at })

/** `n` rail hole x positions from `x0`: groups of 5 with a one-hole gap, as on real boards. */
function railXs(x0, n) {
  const xs = []
  for (let k = 0; xs.length < n; k++) if (k % 6 !== 5) xs.push(x0 + k * P)
  return xs
}

function write(file, m) {
  // One line per [x, y] hole position keeps an 830-hole board around 2,300 lines.
  const json = JSON.stringify(m, null, 2).replace(/\[\s+(-?\d+),\s+(-?\d+)\s+\]/g, '[$1, $2]')
  writeFileSync(OUT + file, json + '\n')
  const holes = m.holes.reduce((n, g) => n + g.at.length, 0)
  console.log(file, 'holes', holes, 'body', m.art.w, 'x', m.art.h)
}

function moduleJson({ id, name, W, H, holes, shapes }) {
  return {
    format: 'circuitoon-module/1', id, version: 1, name, category: 'Prototyping',
    pins: [], holes, obstacle: false, size: { w: W / P, h: H / P }, art: { w: W, h: H, shapes },
  }
}

/**
 * A terminal board: `cols` columns of two 5-hole strips (rows a-e above the center channel, f-j
 * below) and, with `railHoles`, a pair of power rails along the top and bottom edges (+ outer,
 * - inner). Column c's holes sit at x = 20 + 10c; the body leaves 30 px either side for the row
 * letters.
 */
function terminalBoard({ cols, railHoles }) {
  const rails = railHoles > 0
  const W = cols * P + 50
  const yA = rails ? 60 : 30 // row a
  const top = [0, 1, 2, 3, 4].map((i) => yA + i * P)
  const bot = [0, 1, 2, 3, 4].map((i) => yA + 70 + i * P)
  const H = bot[4] + (rails ? 60 : 30)
  const colX = (c) => 20 + c * P
  const holes = []
  for (let c = 1; c <= cols; c++) {
    holes.push(group(`c${c}-top`, `${c} a-e`, top.map((y) => [colX(c), y])))
    holes.push(group(`c${c}-bot`, `${c} f-j`, bot.map((y) => [colX(c), y])))
  }
  const shapes = [r(0, 0, W, H, BODY, { radius: 4 })]
  shapes.push(r(10, top[4] + 9, W - 20, 12, CHANNEL, { radius: 1, outline: false }))
  if (rails) {
    const slots = railHoles + Math.floor((railHoles - 1) / 5)
    const x0 = Math.floor(((colX(1) + colX(cols)) / 2 - ((slots - 1) * P) / 2) / P) * P
    const xs = railXs(x0, railHoles)
    const a = xs[0] - 6
    const b = xs[xs.length - 1] + 6
    holes.unshift(group('top+', '+ rail (top)', xs.map((x) => [x, 20]), '+'), group('top-', '- rail (top)', xs.map((x) => [x, 30]), '-'))
    holes.push(group('bottom-', '- rail (bottom)', xs.map((x) => [x, H - 30]), '-'), group('bottom+', '+ rail (bottom)', xs.map((x) => [x, H - 20]), '+'))
    shapes.push(stripe(a, b, 11, RED), stripe(a, b, 37, BLUE), stripe(a, b, H - 39, BLUE), stripe(a, b, H - 13, RED))
    shapes.push(text(a - 8, 20, '+'), text(a - 8, 30, '-'), text(a - 8, H - 30, '-'), text(a - 8, H - 20, '+'))
  }
  for (const y of [top[0] - 13, bot[4] + 13])
    for (let c = 1; c <= cols; c++) if (c === 1 || c % 5 === 0) shapes.push(text(colX(c), y, String(c)))
  const letters = 'abcdefghij'
  ;[...top, ...bot].forEach((y, i) => shapes.push(text(15, y, letters[i]), text(W - 15, y, letters[i])))
  return { W, H, holes, shapes }
}

write('breadboard-full.json', moduleJson({ id: 'breadboard-full', name: 'Full breadboard (830)', ...terminalBoard({ cols: 63, railHoles: 50 }) }))
write('breadboard-half.json', moduleJson({ id: 'breadboard-half', name: 'Half breadboard (400)', ...terminalBoard({ cols: 30, railHoles: 25 }) }))
write('breadboard-mini.json', moduleJson({ id: 'breadboard-mini', name: 'Mini breadboard (170)', ...terminalBoard({ cols: 17, railHoles: 0 }) }))

// Tiny (25): five vertical strips of five, numbered 1 and 5.
{
  const W = 80, H = 80
  const holes = []
  const shapes = [r(0, 0, W, H, BODY, { radius: 4 })]
  for (let c = 1; c <= 5; c++) {
    holes.push(group(`c${c}`, String(c), [0, 1, 2, 3, 4].map((i) => [10 + c * P, 20 + i * P])))
    if (c === 1 || c === 5) shapes.push(text(10 + c * P, 10, String(c)))
  }
  write('breadboard-tiny.json', moduleJson({ id: 'breadboard-tiny', name: 'Tiny breadboard (25)', W, H, holes, shapes }))
}

// Power rail strip: + and - rails of 25 holes, red stripe above, blue below.
{
  const W = 320, H = 50
  const xs = railXs(20, 25)
  const holes = [group('+', '+ rail', xs.map((x) => [x, 20]), '+'), group('-', '- rail', xs.map((x) => [x, 30]), '-')]
  const shapes = [r(0, 0, W, H, BODY, { radius: 4 }), stripe(14, 306, 8, RED), stripe(14, 306, 40, BLUE)]
  write('power-rail-strip.json', moduleJson({ id: 'power-rail-strip', name: 'Power rail strip', W, H, holes, shapes }))
}
