// Captions and lead labels of plug-in devices seated on an outlet: the device's caption goes beside
// the outlet, level with the device, never on the outlet's caption; the labels of leads another part
// covers (the upper device of a duplex) are drawn inside the device, where they can be seen.
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Diagram, PartInstance } from './diagram.ts'
import { layoutModule } from './module.ts'
import { bodyRect, pivot } from './geometry.ts'
import { mainsOf } from './mainsModel.ts'
import { SOCKET_PATTERNS } from './plugging.ts'
import { load } from './builtinModules.testing.ts'
import { settleMounts } from '../editor/ops.ts'
import { seatedLabels } from './seatedLabels.ts'
import { Sheet } from '../render/Sheet.tsx'

const US = 'outlet-us-5-15r-duplex'
function seated(uid: string, des: string, id: string, outlet: string, k = 0): PartInstance {
  const om = load(outlet), dm = load(id)
  const s = mainsOf(om).sockets[k]
  const holes = new Map((om.holes ?? []).map((h) => [h.name, h.at]))
  const [[lx, ly]] = holes.get(s.contacts.find((c) => c.role === 'L')!.group)!
  const [[px, py]] = SOCKET_PATTERNS[s.family].L
  const c = pivot(layoutModule(dm).w, layoutModule(dm).h)
  return { uid, designator: des, module: id, x: lx - px - c.x, y: ly - py - c.y, rotation: 0 }
}
function sheetOf(parts: PartInstance[]): Diagram {
  const ids = [...new Set(parts.map((p) => p.module))]
  const d: Diagram = { format: 'circuitoon-diagram/1', title: 't', modules: Object.fromEntries(ids.map((id) => [id, load(id)])), parts, connections: [] }
  return settleMounts(d, parts.map((p) => p.uid))
}
const duplex = sheetOf([
  { uid: 'xs1', designator: 'XS1', module: US, x: 0, y: 0, rotation: 0 },
  seated('xp1', 'XP1', 'plug-us-5-15p', US, 0),
  seated('xp2', 'XP2', 'charger-usb-5v-us', US, 1),
])

describe('seated plug-in devices', () => {
  it('both devices are seated', () => {
    expect(duplex.parts.filter((p) => p.mount).map((p) => p.uid)).toEqual(['xp1', 'xp2'])
  })
  it('puts each device caption beside the outlet, level with the device', () => {
    const looks = seatedLabels(duplex)
    const outlet = bodyRect(duplex.parts[0], layoutModule(load(US)))
    for (const uid of ['xp1', 'xp2']) {
      const p = duplex.parts.find((q) => q.uid === uid)!
      const box = bodyRect(p, layoutModule(load(p.module)))
      const at = looks.get(uid)!.caption
      // Part-local: the caption starts right of the outlet's right edge, at the device's middle.
      expect(p.x + at.x).toBeGreaterThan(outlet.x + outlet.w)
      expect(p.y + at.y).toBe(box.y + box.h / 2)
    }
    expect(looks.get('xs1')!.anchor).toBe('middle')
  })
  it('draws the labels of leads under the lower device inside the upper one; the lower one keeps its own', () => {
    const looks = seatedLabels(duplex)
    expect(looks.get('xp1')!.labelInset).toBeGreaterThan(0)
    expect(looks.get('xp2')!.labelInset).toBeNull()
  })
  it('the sheet draws the device captions beside the outlet', () => {
    const html = renderToStaticMarkup(createElement(Sheet, { diagram: duplex, box: { x: -20, y: -20, w: 300, h: 200 }, label: 'd' }))
    expect(html).toMatch(/<text[^>]*text-anchor="start"[^>]*>XP1<\/text>/)
  })
  it('a loose device keeps its caption under its body', () => {
    const d = sheetOf([{ uid: 'xp9', designator: 'XP9', module: 'plug-us-5-15p', x: 400, y: 0, rotation: 0 }])
    expect(seatedLabels(d).size).toBe(0)
  })
})

describe('the outlet a device is seated on', () => {
  it('puts its own caption above its body, clear of the leads that leave below', () => {
    const at = seatedLabels(duplex).get('xs1')!
    const outlet = bodyRect(duplex.parts[0], layoutModule(load(US)))
    expect(at.caption.y).toBeLessThan(outlet.y)
    expect(at.caption.x).toBe(outlet.x + outlet.w / 2)
    expect(at.anchor).toBe('middle')
    expect(seatedLabels(duplex).get('xp1')!.anchor).toBe('start')
  })
  it('the covered labels clear the part that covers them', () => {
    const jp = 'outlet-jp-1-15r-duplex'
    const d = sheetOf([{ uid: 'xs1', designator: 'XS1', module: jp, x: 0, y: 0, rotation: 0 }, seated('xp1', 'XP1', 'charger-usb-5v-us', jp, 0), seated('xp2', 'XP2', 'adapter-barrel-us', jp, 1)])
    const upper = d.parts.find((p) => p.uid === 'xp1')!
    const lower = d.parts.find((p) => p.uid === 'xp2')!
    const top = bodyRect(lower, layoutModule(load(lower.module))).y
    const inset = seatedLabels(d).get('xp1')!.labelInset!
    const edge = bodyRect(upper, layoutModule(load(upper.module)))
    // A 7 px label centred `inset` in from the bottom edge ends above the lower device.
    expect(edge.y + edge.h - inset + 4).toBeLessThanOrEqual(top)
  })
})
