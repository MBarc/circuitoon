// Builds every Circuitoon brand asset from code: the Chip mark and lockup, the favicon set and web
// manifest icons (into public/), the README banner and hero (into docs/brand/), and the share cards.
//
//   cd docs/brand/src && npm install && npm run build
//
// Text is outlined to SVG paths with opentype.js (fonts in ./fonts, all SIL OFL 1.1), so the SVGs
// render the same anywhere, GitHub's <img> included. PNGs are rasterised by the locally installed
// Chrome through playwright-core. The banner motif and the hero are real sheets drawn by the
// project's own CLI (plugin/bin/circuitoon.mjs), and the hero must pass `circuitoon gate`.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import opentype from 'opentype.js'
import { chromium } from 'playwright-core'

// ---- Copy. Change the tagline here; `lines` is how it breaks on the banner and cards. ----
export const TAGLINE = {
  text: 'Circuit diagrams AI agents can design, check and hand you.',
  lines: ['Circuit diagrams AI agents', 'can design, check and hand you.'],
}

// ---- Paths ----
const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const ROOT = here('../../../')
const BRAND = here('../')
const PUBLIC = join(ROOT, 'public')
const CLI = join(ROOT, 'plugin/bin/circuitoon.mjs')
const HERO_NETLIST = join(ROOT, 'plugin/skills/circuitoon-design/references/examples/esp32-bme280.netlist.json')

// ---- Brand tokens (mirror src/styles.css) ----
const T = {
  paper: '#F7F8F3', bg: '#E9EEE6', grid: '#DCE3D7', green: '#2F9E6E', yellow: '#F4B400', ink: '#23282F',
  text: '#23282F', muted: '#56615B', pin: '#C9CFD4',
}
const DARK = { ...T, bg: '#161B18', grid: '#1F2622', text: '#E4EAE5', muted: '#9CA8A0', shadow: '#4A5A50', edge: '#9AA79F' }
const theme = (dark) => (dark ? DARK : { ...T, shadow: T.ink, edge: T.ink })

// ---- Fonts and outlined text ----
const font = (f) => { const b = readFileSync(here('./fonts/' + f)); return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }
const F = {
  fredoka600: font('fredoka-latin-600-normal.woff'),
  fredoka500: font('fredoka-latin-500-normal.woff'),
  atkinson400: font('AtkinsonHyperlegible-Regular.ttf'),
  atkinson700: font('AtkinsonHyperlegible-Bold.ttf'),
}

/** Outlines `text` at baseline (0, 0); `track` adds em between glyphs. The ohm sign maps to omega. */
function outline(f, text, size, track = 0) {
  const scale = size / f.unitsPerEm
  const glyphs = f.stringToGlyphs(text.replace(/Ω/g, 'Ω'))
  let x = 0
  const d = []
  glyphs.forEach((g, i) => {
    d.push(g.getPath(x, 0, size).toPathData(2))
    x += g.advanceWidth * scale
    if (i < glyphs.length - 1) x += f.getKerningValue(g, glyphs[i + 1]) * scale + track * size
  })
  return { d: d.join(''), width: x }
}

/** `.wordmark` from src/styles.css: Fredoka 600, yellow, a 1.6px (at 32px) ink edge, hard 2/3px shadow. */
function wordmark(size, dark) {
  const t = theme(dark)
  const p = outline(F.fredoka600, 'Circuitoon', size, 0.01)
  const k = size / 32
  const sw = (1.6 * k * 2).toFixed(2)
  return {
    width: p.width + 3 * k,
    svg: `<path d="${p.d}" transform="translate(${2 * k} ${3 * k})" fill="${t.shadow}" stroke="${t.shadow}" stroke-width="${sw}" stroke-linejoin="round"/>
<path d="${p.d}" fill="${T.yellow}" stroke="${T.ink}" stroke-width="${sw}" stroke-linejoin="round" paint-order="stroke fill"/>`,
  }
}

/** A line of plain text as one path. `anchor` is start, middle or end. */
function textLine(f, text, size, fill, { x = 0, y = 0, anchor = 'start' } = {}) {
  const p = outline(f, text, size)
  const dx = anchor === 'middle' ? -p.width / 2 : anchor === 'end' ? -p.width : 0
  return { width: p.width, svg: `<path transform="translate(${(x + dx).toFixed(2)} ${y})" d="${p.d}" fill="${fill}"/>` }
}

// ---- The mark: "Chip", a cartoon DIP chip with a face. 64-unit grid, framed by MARK_BOX. ----
const MARK_BOX = { x: 2, y: 5, w: 60, h: 60 }
function mark(dark = false) {
  const t = theme(dark)
  const leg = (x, y) => `<rect x="${x}" y="${y}" width="9" height="6" rx="1.6" fill="${T.pin}" stroke="${T.ink}" stroke-width="2.6"/>`
  const body = 'M18 9H27A5 5 0 0 0 37 9H46A6 6 0 0 1 52 15V51A6 6 0 0 1 46 57H18A6 6 0 0 1 12 51V15A6 6 0 0 1 18 9Z'
  return `${[19, 31, 43].map((y) => leg(4, y) + leg(51, y)).join('')}
<path d="${body}" transform="translate(2 3)" fill="${t.shadow}"/>
<path d="${body}" fill="${T.yellow}" stroke="${T.ink}" stroke-width="3.4" stroke-linejoin="round"/>
<ellipse cx="25" cy="29" rx="3.6" ry="4.8" fill="${T.ink}"/><ellipse cx="39" cy="29" rx="3.6" ry="4.8" fill="${T.ink}"/>
<circle cx="26.2" cy="27.2" r="1.3" fill="#FFFFFF"/><circle cx="40.2" cy="27.2" r="1.3" fill="#FFFFFF"/>
<path d="M24.5 40Q32 47 39.5 40" fill="none" stroke="${T.ink}" stroke-width="3.2" stroke-linecap="round"/>`
}
/** The mark scaled to `size` px with its top-left at (x, y). */
const markAt = (x, y, size, dark) =>
  `<g transform="translate(${x} ${y}) scale(${size / MARK_BOX.w}) translate(${-MARK_BOX.x} ${-MARK_BOX.y})">${mark(dark)}</g>`

/** The part of the motif sheet that the sticker shows (sheet units): the parts, wires and captions. */
const MOTIF_CROP = [20, 8, 424, 172]

const svg = (w, h, body, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"${title ? ` role="img" aria-label="${title}"><title>${title}</title>` : '>'}${body}</svg>\n`

/** Mark plus wordmark on one line. Returns the inner markup and its size. */
function lockupBody(markSize, dark) {
  const wordSize = markSize * 0.86
  const wm = wordmark(wordSize, dark)
  const gap = markSize * 0.2
  const baseline = markSize * 0.79
  return {
    w: Math.ceil(markSize + gap + wm.width + 2),
    h: Math.ceil(markSize + 4),
    svg: `${markAt(0, 0, markSize, dark)}<g transform="translate(${markSize + gap} ${baseline})">${wm.svg}</g>`,
  }
}

// ---- CLI sheets: render, then outline their text so no web font is needed ----
function cli(...args) {
  return execFileSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}
const attr = (s, name) => (s.match(new RegExp(`\\s${name}="([^"]*)"`)) ?? [])[1]
const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

/** Replaces each <text> of a CLI sheet SVG with an outlined path, and prefixes ids with `ns`. */
function outlineSheet(src, ns) {
  return src
    .replace(/<text([^>]*)>([^<]*)<\/text>/g, (_, a, content) => {
      const size = Number(attr(a, 'font-size') ?? 10)
      const f = Number(attr(a, 'font-weight') ?? 400) >= 600 ? F.atkinson700 : F.atkinson400
      const p = outline(f, unescape(content), size)
      const anchor = attr(a, 'text-anchor') ?? 'start'
      let x = Number(attr(a, 'x') ?? 0)
      let y = Number(attr(a, 'y') ?? 0)
      if (anchor === 'middle') x -= p.width / 2
      else if (anchor === 'end') x -= p.width
      if (attr(a, 'dominant-baseline') === 'central') y += size * 0.34
      const keep = ['fill', 'stroke', 'stroke-width', 'stroke-linejoin', 'paint-order', 'transform', 'opacity']
        .map((k) => (attr(a, k) !== undefined ? ` ${k}="${attr(a, k)}"` : '')).join('')
      return `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)})"><path d="${p.d}"${keep}/></g>`
    })
    .replace(/\sid="([^"]+)"/g, ` id="${ns}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${ns}-$1)`)
}
/** The inner markup and viewBox of a sheet SVG, for nesting inside another SVG. */
function nestable(src) {
  const vb = attr(src.match(/<svg[^>]*>/)[0], 'viewBox').split(/\s+/).map(Number)
  const inner = src.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
  return { vb, inner }
}

// ---- Compositions: banner, share card, GitHub social preview ----
function gridPattern(id, step, color) {
  return `<pattern id="${id}" width="${step}" height="${step}" patternUnits="userSpaceOnUse"><path d="M${step} 0H0V${step}" fill="none" stroke="${color}" stroke-width="1"/></pattern>`
}
/** The motif sheet as a sticker: paper, ink edge, hard shadow, a slight tilt. */
function motifSticker(motif, x, y, scale, dark, tilt = -2.5) {
  const t = theme(dark)
  const [vx, vy, vw, vh] = motif.vb
  const w = vw * scale
  const h = vh * scale
  const r = 14
  return `<g transform="translate(${x} ${y}) rotate(${tilt} ${w / 2} ${h / 2})">
<rect x="5" y="7" width="${w}" height="${h}" rx="${r}" fill="${t.shadow}"/>
<clipPath id="mclip-${dark ? 'd' : 'l'}"><rect width="${w}" height="${h}" rx="${r}"/></clipPath>
<g clip-path="url(#mclip-${dark ? 'd' : 'l'})"><svg width="${w}" height="${h}" viewBox="${vx} ${vy} ${vw} ${vh}">${motif.inner}</svg></g>
<rect width="${w}" height="${h}" rx="${r}" fill="none" stroke="${t.edge}" stroke-width="3"/>
</g>`
}
function taglineLines(x, y, size, lead, dark) {
  const t = theme(dark)
  return TAGLINE.lines.map((l, i) => textLine(F.fredoka500, l, size, t.text, { x, y: y + i * lead }).svg).join('')
}

function banner(motif, dark) {
  const t = theme(dark)
  const W = 1280, H = 420
  const lk = lockupBody(84, dark)
  const body = `<defs>${gridPattern('bgrid', 24, t.grid)}</defs>
<rect x="9" y="11" width="${W - 16}" height="${H - 18}" rx="26" fill="${t.shadow}"/>
<rect x="4" y="4" width="${W - 16}" height="${H - 18}" rx="26" fill="${t.bg}"/>
<rect x="4" y="4" width="${W - 16}" height="${H - 18}" rx="26" fill="url(#bgrid)"/>
<rect x="4" y="4" width="${W - 16}" height="${H - 18}" rx="26" fill="none" stroke="${t.edge}" stroke-width="3"/>
<g transform="translate(64 112)">${lk.svg}</g>
${taglineLines(68, 270, 31, 44, dark)}
${motifSticker(motif, 650, 92, 1.38, dark)}`
  return svg(W, H, body, `Circuitoon. ${TAGLINE.text}`)
}

/** A share card. No URL on it: every platform prints the link's domain itself, and X overlays it bottom left. */
function card(motif, dark, W, H) {
  const t = theme(dark)
  const lk = lockupBody(100, dark)
  const motifScale = 1.32
  const mw = MOTIF_CROP[2] * motifScale
  const mh = MOTIF_CROP[3] * motifScale
  const body = `<defs>${gridPattern('cgrid', 30, t.grid)}</defs>
<rect width="${W}" height="${H}" fill="${t.bg}"/><rect width="${W}" height="${H}" fill="url(#cgrid)"/>
<g transform="translate(72 72)">${lk.svg}</g>
${taglineLines(78, 254, 40, 54, dark)}
${motifSticker(motif, W - mw - 64, H - mh - 70, motifScale, dark, -3)}`
  return svg(W, H, body)
}

// ---- Icons ----
function iconSvg(size, { bg = null, pad = 0, radius = 0 } = {}) {
  const inner = size - pad * 2
  const back = bg ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>` : ''
  return svg(size, size, back + markAt(pad, pad, inner, false))
}
/** A .ico holding PNG images (valid in every current browser and in Windows). */
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length)
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4)
  let offset = head.length
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i
    head.writeUInt8(size >= 256 ? 0 : size, e); head.writeUInt8(size >= 256 ? 0 : size, e + 1)
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([head, ...pngs.map((p) => p.data)])
}

// ---- Build ----
const out = []
const write = (path, data) => { writeFileSync(path, data); out.push(path) }
mkdirSync(BRAND, { recursive: true })
const tmp = mkdtempSync(join(tmpdir(), 'circuitoon-brand-'))

// Logo
for (const dark of [false, true]) {
  const sfx = dark ? '-dark' : ''
  write(join(BRAND, `mark${sfx}.svg`), svg(256, 256, markAt(0, 0, 256, dark), 'Circuitoon'))
  const lk = lockupBody(96, dark)
  write(join(BRAND, `lockup${sfx}.svg`), svg(lk.w, lk.h, lk.svg, 'Circuitoon'))
}
write(join(PUBLIC, 'favicon.svg'), svg(64, 64, markAt(0, 0, 64, false)))

// Motif sheet, light and dark, from the CLI
const motifs = {}
for (const dark of [false, true]) {
  const svgPath = join(tmp, `motif${dark ? '-dark' : ''}.svg`)
  cli('render', join(here('./motif.circuitoon.json')), '-o', join(tmp, 'motif.png'), '--svg', svgPath, ...(dark ? ['--dark'] : []))
  motifs[dark] = { ...nestable(outlineSheet(readFileSync(svgPath, 'utf8'), dark ? 'md' : 'ml')), vb: MOTIF_CROP }
}
write(join(BRAND, 'banner.svg'), banner(motifs[false], false))
write(join(BRAND, 'banner-dark.svg'), banner(motifs[true], true))

// Hero: a real sheet from the agent toolkit's own example, gated
const heroSheet = join(tmp, 'hero.circuitoon.json')
cli('layout', HERO_NETLIST, '-o', heroSheet)
const gate = JSON.parse(cli('gate', heroSheet, '-o', join(tmp, 'gate'), '--json'))
if (!gate.ready || gate.blocking.length || gate.warnings.length) throw new Error('hero sheet does not pass gate cleanly: ' + JSON.stringify(gate.blocking.concat(gate.warnings)))
cli('render', heroSheet, '-o', join(BRAND, 'hero.png'), '--scale', '2')
cli('render', heroSheet, '-o', join(BRAND, 'hero-dark.png'), '--scale', '2', '--dark')
out.push(join(BRAND, 'hero.png'), join(BRAND, 'hero-dark.png'))

// Rasters through Chrome
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ deviceScaleFactor: 1 })
async function png(markup, w, h) {
  await page.setViewportSize({ width: w, height: h })
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${markup}`)
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } })
}
const icoPngs = []
for (const s of [16, 32, 48]) icoPngs.push({ size: s, data: await png(iconSvg(s), s, s) })
write(join(PUBLIC, 'favicon.ico'), ico(icoPngs))
write(join(PUBLIC, 'apple-touch-icon.png'), await png(iconSvg(180, { bg: T.bg, pad: 22 }), 180, 180))
write(join(PUBLIC, 'icon-192.png'), await png(iconSvg(192), 192, 192))
write(join(PUBLIC, 'icon-512.png'), await png(iconSvg(512), 512, 512))
// Maskable: the safe zone is the centre circle of 80% diameter; the mark sits inside it.
write(join(PUBLIC, 'icon-maskable-512.png'), await png(iconSvg(512, { bg: T.bg, pad: 112 }), 512, 512))
write(join(PUBLIC, 'og-card.png'), await png(card(motifs[false], false, 1200, 630), 1200, 630))
write(join(BRAND, 'social-preview.png'), await png(card(motifs[false], false, 1280, 640), 1280, 640))
await browser.close()

writeFileSync(join(PUBLIC, 'site.webmanifest'), JSON.stringify({
  name: 'Circuitoon',
  short_name: 'Circuitoon',
  description: TAGLINE.text,
  start_url: '/circuitoon/',
  scope: '/circuitoon/',
  display: 'standalone',
  background_color: T.bg,
  theme_color: T.bg,
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2) + '\n')
out.push(join(PUBLIC, 'site.webmanifest'))
rmSync(tmp, { recursive: true, force: true })

for (const p of out) console.log(`${String(statSync(p).size).padStart(8)}  ${p.slice(ROOT.length).replace(/\\/g, '/')}`)
