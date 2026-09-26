// Budget test: an 830-hole board draws its holes as one path and renders fast enough to drag.
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Part, holePathData } from './Part.tsx'
import type { HoleGroup, ModuleDef } from '../format/module.ts'

/** Same hole layout as the full breadboard: 63 columns of two 5-hole strips plus four 50-hole rails. */
function fullBoard(): ModuleDef {
  const holes: HoleGroup[] = []
  for (let c = 1; c <= 63; c++) {
    holes.push({ name: `c${c}-top`, at: [60, 70, 80, 90, 100].map((y) => [20 + c * 10, y] as [number, number]) })
    holes.push({ name: `c${c}-bot`, at: [130, 140, 150, 160, 170].map((y) => [20 + c * 10, y] as [number, number]) })
  }
  const xs: number[] = []
  for (let k = 0; xs.length < 50; k++) if (k % 6 !== 5) xs.push(50 + k * 10)
  for (const [name, y] of [['top+', 20], ['top-', 30], ['bottom-', 200], ['bottom+', 210]] as const)
    holes.push({ name, at: xs.map((x) => [x, y] as [number, number]) })
  return { format: 'circuitoon-module/1', id: 'full', name: 'Full', pins: [], holes, obstacle: false, size: { w: 68, h: 23 } }
}

function median(fn: () => void, runs = 15): number {
  for (let i = 0; i < 3; i++) fn()
  const t: number[] = []
  for (let i = 0; i < runs; i++) {
    const s = performance.now()
    fn()
    t.push(performance.now() - s)
  }
  t.sort((a, b) => a - b)
  return t[runs >> 1]
}

describe('hole rendering budget', () => {
  it('draws 830 holes as a single path', () => {
    const m = fullBoard()
    const p = holePathData(m)
    expect(p.holes.match(/M/g)).toHaveLength(830)
    expect(p.pads).toBe('')
    const markup = renderToStaticMarkup(createElement(Part, { module: m }))
    const group = markup.match(/<g data-holes="">(.*?)<\/g>/)![1]
    expect(group.match(/<path/g)).toHaveLength(1)
  })
  it('renders the 830-hole board in 30 ms or less (median, uncached module)', () => {
    const base = fullBoard()
    // A fresh module object each run defeats the per-module path cache, so the path is rebuilt too.
    const ms = median(() => renderToStaticMarkup(createElement(Part, { module: { ...base } })))
    expect(ms).toBeLessThanOrEqual(30)
  })
})
