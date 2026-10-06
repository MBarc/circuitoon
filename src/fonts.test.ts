// Firmware spec 2.5: the fonts are self-hosted (latin and latin-ext, the weights in use, the two
// above-the-fold weights preloaded, OFL shipped), so the page loads nothing cross-origin, which
// COEP require-corp would block. Each @font-face's unicode-range is the Fontsource package's own (from its <weight>.css).
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const html = readFileSync('index.html', 'utf8')
const css = readFileSync('src/styles.css', 'utf8')
const FACES = [
  ['atkinson-hyperlegible', 'Atkinson Hyperlegible', 400], ['atkinson-hyperlegible', 'Atkinson Hyperlegible', 700],
  ['fredoka', 'Fredoka', 500], ['fredoka', 'Fredoka', 600],
] as const

describe('self-hosted fonts (spec 2.5)', () => {
  it('loads nothing cross-origin from index.html', () => {
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/)
    // og: and twitter: meta URLs are not loads; every href and src is same-origin.
    const loads = [...html.matchAll(/<(?:link|script)\b[^>]*\b(?:href|src)="([^"]+)"/g)].map((m) => m[1])
    expect(loads.filter((u) => /^(https?:)?\/\//.test(u))).toEqual([])
  })
  it('has a woff2 face per family, weight and subset, each with the package unicode-range', () => {
    for (const [pkg, family, weight] of FACES)
      for (const subset of ['latin', 'latin-ext']) {
        const file = `${pkg}-${subset}-${weight}-normal.woff2`
        expect(existsSync(`public/fonts/${file}`), file).toBe(true)
        const rule = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1]).find((r) => r.includes(file))
        expect(rule, file).toBeDefined()
        expect(rule).toContain(`font-family: "${family}"`)
        expect(rule).toContain(`font-weight: ${weight}`)
        expect(rule).toContain('font-display: swap')
        // The package's <weight>.css holds one commented @font-face per subset; that block has the range.
        const pkgCss = readFileSync(`node_modules/@fontsource/${pkg}/${weight}.css`, 'utf8')
        const block = pkgCss.split('/* ').find((b) => b.startsWith(`${pkg}-${subset}-${weight}-normal */`))!
        const want = /unicode-range:\s*([^;]+);/.exec(block)![1].trim()
        expect(/unicode-range:\s*([^;]+);/.exec(rule!)![1].trim(), file).toBe(want)
      }
  })
  it('preloads the two above-the-fold faces and ships the OFL', () => {
    for (const f of ['atkinson-hyperlegible-latin-400-normal.woff2', 'fredoka-latin-600-normal.woff2'])
      expect(html).toContain(`<link rel="preload" href="/circuitoon/fonts/${f}" as="font" type="font/woff2" crossorigin />`)
    const ofl = readFileSync('public/fonts/OFL.txt', 'utf8')
    expect(ofl).toMatch(/SIL OPEN FONT LICENSE/i)
    // OFL 1.1 condition 2: each redistributed font's copyright notice.
    expect(ofl).toMatch(/Braille Institute/)
    expect(ofl).toMatch(/Fredoka Project/)
  })
})
