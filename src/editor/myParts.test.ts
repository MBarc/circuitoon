import { describe, expect, it } from 'vitest'
import { MY_PARTS_KEY, MyPartsStore, duplicatePart, freeId, importPart, partFileText, readMyParts, readMyPartsReport, replaceSheetModule, skippedNotice, writeMyParts, type KeyValue, type MyPart } from './myParts.ts'
import { validateModule } from '../format/module.ts'
import { moduleFromSpec } from '../format/partMaker.ts'
import { addPasted, draftFromPart, emptyDraft, moveRow, moveRowToSide, pinRow, specFromDraft } from './partDraft.ts'
import { parsePinLines } from '../format/partMaker.ts'
import { emptyDiagram } from '../format/diagram.ts'
import { addPart } from './ops.ts'
import { modulesById } from '../library.ts'

const memory = (init: Record<string, string> = {}): KeyValue & { data: Record<string, string> } => {
  const data = { ...init }
  return { data, getItem: (k) => (Object.hasOwn(data, k) ? data[k] : null), setItem: (k, v) => void (data[k] = v) }
}
const broken: KeyValue = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
}
const part = (name = 'Sensor A', extra: Partial<MyPart> = {}): MyPart => ({
  module: moduleFromSpec({ name, source: 'https://example.com/a', pins: { left: [{ name: 'VCC', type: 'power_in', supply: '3V3' }, { name: 'GND', type: 'ground' }, { name: 'OUT', type: 'output' }] } }),
  saved: 1,
  ...extra,
})

describe('My parts storage', () => {
  it('writes and reads the list back, maker included', () => {
    const s = memory()
    expect(writeMyParts([part('A', { maker: 'Acme 1' }), part('B')], s)).toBe(true)
    const back = readMyParts(s)
    expect(back.map((p) => [p.module.id, p.maker])).toEqual([['custom-a', 'Acme 1'], ['custom-b', undefined]])
  })

  it('survives storage that throws, and says the write did not persist', () => {
    expect(readMyParts(broken)).toEqual([])
    expect(writeMyParts([part()], broken)).toBe(false)
    expect(readMyParts(null)).toEqual([])
    const store = new MyPartsStore(() => broken)
    store.save(part())
    expect(store.getSnapshot()).toHaveLength(1)
    expect(store.persisted).toBe(false)
  })

  it('leaves out anything unreadable: bad JSON, another format, invalid or non-custom modules, repeats', () => {
    expect(readMyParts(memory({ [MY_PARTS_KEY]: '{' }))).toEqual([])
    expect(readMyParts(memory({ [MY_PARTS_KEY]: JSON.stringify({ format: 'other', parts: [part()] }) }))).toEqual([])
    const good = part('Good')
    const notCustom = { ...part('Lib'), module: { ...modulesById.resistor } }
    const invalid = { module: { format: 'circuitoon-module/1', id: 'custom-x', name: 'x', pins: [] }, saved: 1 }
    const s = memory({ [MY_PARTS_KEY]: JSON.stringify({ format: 'circuitoon-my-parts/1', parts: [good, notCustom, invalid, good, 7] }) })
    expect(readMyParts(s).map((p) => p.module.id)).toEqual(['custom-good'])
  })

  it('saves newest first, replaces by id, duplicates beside the original and removes', () => {
    const s = memory()
    const store = new MyPartsStore(() => s)
    let calls = 0
    store.subscribe(() => calls++)
    store.save(part('A'))
    store.save(part('B'))
    expect(store.getSnapshot().map((p) => p.module.id)).toEqual(['custom-b', 'custom-a'])
    const renamed = { ...part('A'), module: { ...part('A').module, name: 'A2' } }
    store.replace('custom-a', renamed)
    expect(store.getSnapshot().map((p) => p.module.name)).toEqual(['B', 'A2'])
    const copy = store.duplicate('custom-b')!
    expect(copy.module).toMatchObject({ id: 'custom-b-copy', name: 'B (copy)' })
    expect(store.getSnapshot().map((p) => p.module.id)).toEqual(['custom-b', 'custom-b-copy', 'custom-a'])
    store.remove('custom-b')
    expect(store.getSnapshot().map((p) => p.module.id)).toEqual(['custom-b-copy', 'custom-a'])
    expect(calls).toBe(5)
    // Persisted: a fresh store reads the same list.
    expect(new MyPartsStore(() => s).getSnapshot().map((p) => p.module.id)).toEqual(['custom-b-copy', 'custom-a'])
  })

  it('finds free ids, never a built-in one', () => {
    expect(freeId('custom-a', new Set())).toBe('custom-a')
    expect(freeId('custom-a', new Set(['custom-a', 'custom-a-2']))).toBe('custom-a-3')
    expect(freeId('resistor', new Set())).toBe('resistor-2')
    expect(duplicatePart(part('A'), [part('A'), duplicatePart(part('A'), [])]).module.id).toBe('custom-a-copy-2')
  })
})

describe('part files', () => {
  it('exports the module and imports it back', () => {
    const p = part('A')
    const r = importPart(partFileText(p), [])
    expect(r).toMatchObject({ ok: true, note: null })
    if (r.ok) expect(r.part.module).toEqual(p.module)
  })
  it('says when the same part is already there, and imports a different one under a free id', () => {
    const p = part('A')
    expect(importPart(partFileText(p), [p])).toMatchObject({ ok: true, note: 'A is already in My parts.' })
    const other = { ...p, module: { ...p.module, name: 'Different' } }
    const r = importPart(partFileText(other), [p])
    expect(r.ok && r.part.module.id).toBe('custom-a-2')
    expect(r.ok && r.note).toContain('custom-a-2')
  })
  it('marks a module from outside the library as custom', () => {
    const r = importPart(JSON.stringify({ format: 'circuitoon-module/1', id: 'relay-2ch', name: 'Relay', pins: [{ name: 'IN', side: 'left' }] }), [])
    expect(r.ok && r.part.module).toMatchObject({ id: 'custom-relay-2ch', custom: true })
  })
  it('refuses what is not a part, with a message', () => {
    expect(importPart('{', [], 'x.json')).toEqual({ ok: false, message: 'x.json is not valid JSON, so nothing was imported.' })
    expect(importPart(JSON.stringify(emptyDiagram()), [], 'sheet.json')).toMatchObject({ ok: false, message: expect.stringContaining('is a sheet') })
    expect(importPart(JSON.stringify({ format: 'circuitoon-module/1', id: 'custom-x', custom: true, name: 'x', pins: [] }), [])).toMatchObject({ ok: false })
  })
})

describe('replaceSheetModule', () => {
  it('takes the new copy and drops wires to pins it no longer has', () => {
    const p = part('A')
    let d = addPart(emptyDiagram(), p.module, 0, 0).diagram
    d = addPart(d, modulesById.resistor, 200, 0).diagram
    const [u, r] = d.parts.map((x) => x.uid)
    d = { ...d, connections: [
      { uid: 'w1', from: { part: u, pin: 'OUT' }, to: { part: r, pin: '1' } },
      { uid: 'w2', from: { part: u, pin: 'GND' }, to: { part: r, pin: '2' } },
    ] }
    const next = moduleFromSpec({ name: 'A', source: 'https://example.com/a', pins: { left: [{ name: 'VCC', type: 'power_in', supply: '3V3' }, { name: 'GND', type: 'ground' }] } })
    const out = replaceSheetModule(d, next)
    expect(out.modules['custom-a']).toEqual(next)
    expect(out.connections.map((c) => c.uid)).toEqual(['w2'])
    expect(replaceSheetModule(out, next)).toBe(out)
    expect(replaceSheetModule(emptyDiagram(), next).modules).toEqual({})
  })
})

describe('the part maker draft', () => {
  it('turns a draft into a spec and a saved part back into the same draft', () => {
    let d = { ...emptyDraft(), name: 'Sensor A', source: 'https://example.com/a\n https://example.com/b' }
    d = addPasted(d, parsePinLines('VCC power 3V3\nGND ground\nRight:\nOUT out').pins)
    expect(d.pins.left.map((r) => r.name)).toEqual(['VCC', 'GND'])
    const spec = specFromDraft(d)
    expect(spec).toMatchObject({ name: 'Sensor A', source: ['https://example.com/a', 'https://example.com/b'], body: { color: '#2F9E6E' } })
    const m = moduleFromSpec(spec)
    const again = draftFromPart({ module: m, maker: 'Acme', saved: 1 })
    expect(again).toMatchObject({ name: 'Sensor A', maker: 'Acme', id: 'custom-sensor-a', sized: false, source: 'https://example.com/a\nhttps://example.com/b' })
    expect(moduleFromSpec(specFromDraft(again))).toEqual(m)
  })
  it('moves rows within a side and onto another side', () => {
    const d = { ...emptyDraft(), pins: { left: [pinRow('A'), pinRow('B'), pinRow('C')], right: [], top: [], bottom: [] } }
    expect(moveRow(d, 'left', 0, 2).pins.left.map((r) => r.name)).toEqual(['B', 'C', 'A'])
    expect(moveRow(d, 'left', 5, 0)).toBe(d)
    const moved = moveRowToSide(d, 'left', 1, 'top')
    expect([moved.pins.left.map((r) => r.name), moved.pins.top.map((r) => r.name)]).toEqual([['A', 'C'], ['B']])
  })
  it('keeps a size only when one is chosen, and drops internal joins whose pins are gone', () => {
    const d = { ...emptyDraft(), name: 'X', sized: true, w: 12, h: 5, pins: { left: [pinRow('GND'), pinRow('GND 2')], right: [], top: [], bottom: [] }, internal: [['GND', 'GND 2'], ['GND', 'OLD']] }
    expect(specFromDraft(d)).toMatchObject({ body: { w: 12, h: 5 }, internal: [['GND', 'GND 2']] })
  })
})

describe('tampered My parts', () => {
  // An object whose toString and valueOf are not functions: String() and template literals throw on it.
  const evil = () => JSON.parse('{"toString":null,"valueOf":null}')
  const paths = (v: unknown, p: (string | number)[] = [], out: (string | number)[][] = []) => {
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
      const q = [...p, Array.isArray(v) ? Number(k) : k]
      out.push(q)
      paths(x, q, out)
    }
    return out
  }
  const swap = (m: unknown, path: (string | number)[], bad: unknown) => {
    const c = structuredClone(m) as Record<string | number, unknown>
    let o = c
    for (const k of path.slice(0, -1)) o = o[k] as Record<string | number, unknown>
    o[path[path.length - 1]] = bad
    return c
  }

  it('validation never throws on malformed nested objects, anywhere in a module', () => {
    const rich = ['bme280-module-4pin', 'outlet-au-as3112', 'adapter-barrel-au', 'tp4056-module', 'lamp-holder-e26', 'arduino-nano', 'fuse-holder-5x20-inline']
    for (const m of [part().module, ...rich.map((id) => modulesById[id])])
      for (const p of paths(m))
        for (const bad of [evil(), [evil()], [[evil(), evil()]]]) {
          const c = swap(m, p, bad)
          expect(() => validateModule(c), `${m.id} ${p.join('.')}`).not.toThrow()
          expect(() => importPart(JSON.stringify(c), []), `${m.id} ${p.join('.')}`).not.toThrow()
        }
  })

  it('skips a stored entry that cannot be read, keeps the rest and says so; startup never fails', () => {
    const good = part('Good')
    const bad = { ...part('Bad'), module: { ...part('Bad').module, format: evil() } }
    const nested = { ...part('Nested'), module: { ...part('Nested').module, internal: [[evil(), evil()]] } }
    const s = memory({ [MY_PARTS_KEY]: JSON.stringify({ format: 'circuitoon-my-parts/1', parts: [bad, good, nested] }) })
    expect(readMyPartsReport(s)).toMatchObject({ skipped: 2 })
    expect(readMyParts(s).map((p) => p.module.id)).toEqual(['custom-good'])
    const store = new MyPartsStore(() => s)
    expect(store.getSnapshot().map((p) => p.module.id)).toEqual(['custom-good'])
    expect(store.skipped).toBe(2)
    expect(skippedNotice(2)).toMatch(/2 saved parts in this browser could not be read/)
    expect(skippedNotice(1)).toMatch(/1 saved part in this browser could not be read/)
  })
})
