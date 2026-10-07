import { describe, expect, it } from 'vitest'
import { MY_PARTS_KEY, MyPartsStore, duplicatePart, freeId, importPart, partFileText, placeOnSheet, readMyParts, readMyPartsReport, replaceSheetModule, skippedNotice, updateSheetModule, writeMyParts, type KeyValue, type MyPart } from './myParts.ts'
import { validateModule } from '../format/module.ts'
import { moduleFromSpec, unmodeled } from '../format/partMaker.ts'
import { addPasted, draftFromPart, emptyDraft, idClash, moveRow, moveRowToSide, pinRow, saveId, savedModule, specFromDraft } from './partDraft.ts'
import { SIDES } from '../format/module.ts'
import { parsePinLines } from '../format/partMaker.ts'
import { emptyDiagram } from '../format/diagram.ts'
import { addPart } from './ops.ts'
import { EditorStore } from './store.ts'
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
  it('takes a description and comma separated uses, and leaves both out when empty', () => {
    const d = { ...emptyDraft(), name: 'Sensor B', description: ' Reads light. ', uses: 'plant monitor, , night light ', pins: { left: [pinRow('A')], right: [], top: [], bottom: [] } }
    const m = moduleFromSpec(specFromDraft(d))
    expect(m).toMatchObject({ description: 'Reads light.', uses: ['plant monitor', 'night light'] })
    expect(draftFromPart({ module: m, saved: 1 })).toMatchObject({ description: 'Reads light.', uses: 'plant monitor, night light' })
    const bare = moduleFromSpec(specFromDraft({ ...d, description: ' ', uses: ' , ' }))
    expect('description' in bare || 'uses' in bare).toBe(false)
    // An imported part edited in place takes them too.
    const p = { module: modulesById['tp4056-module'], saved: 1 }
    const r = savedModule({ ...draftFromPart(p), description: 'Charges a cell.', uses: 'power bank' }, p.module.id, p.module, false)
    expect(r.ok && r.module).toMatchObject({ description: 'Charges a cell.', uses: ['power bank'] })
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

  // Exhaustive: every path of eight real modules times three malformed shapes, so it gets more than the default 5 s.
  it('validation never throws on malformed nested objects, anywhere in a module', { timeout: 60_000 }, () => {
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

describe('editing keeps a part its exact id', () => {
  const long = 'A long sensor name that runs well past the sixty character slug limit'
  const make = (name: string) => moduleFromSpec({ name, pins: { left: [{ name: 'VCC', type: 'power_in', supply: '3V3' }, { name: 'GND', type: 'ground' }] } })
  /** What the dialog saves: the draft built under the id it would save with. */
  const save = (d: ReturnType<typeof draftFromPart>, editingId: string | null, taken: Set<string>) => {
    const id = saveId(d, editingId, taken)
    return moduleFromSpec({ ...specFromDraft(d), id })
  }

  it('a long name: the second part keeps its -2 and editing it never lands on the first', () => {
    const a = make(long)
    expect(a.id.length).toBeGreaterThan(60)
    const b = save({ ...emptyDraft(), name: long, pins: draftFromPart({ module: a, saved: 1 }).pins }, null, new Set([a.id]))
    expect(b.id).toBe(`${a.id}-2`)
    const edited = save(draftFromPart({ module: b, saved: 1 }), b.id, new Set([a.id, b.id]))
    expect(edited.id).toBe(b.id)
    const s = memory()
    const store = new MyPartsStore(() => s)
    store.save({ module: a, saved: 1 })
    store.save({ module: b, saved: 1 })
    store.replace(b.id, { module: edited, saved: 2 })
    expect(store.getSnapshot().map((p) => p.module.id).sort()).toEqual([a.id, b.id].sort())
  })

  it('duplicates and imported ids keep theirs too', () => {
    const a = make(long)
    const copy = duplicatePart({ module: a, saved: 1 }, [{ module: a, saved: 1 }])
    expect(save(draftFromPart(copy), copy.module.id, new Set([a.id, copy.module.id])).id).toBe(copy.module.id)
    for (const id of ['custom-custom-x', `custom-${'b'.repeat(80)}`, 'custom-x-2']) {
      const r = importPart(JSON.stringify({ ...make('X'), id }), [])
      expect(r.ok && r.part.module.id).toBe(id)
      if (r.ok) expect(save(draftFromPart(r.part), id, new Set([id, 'custom-x'])).id).toBe(id)
    }
  })

  it('refuses a save that would land on another part, with a clear message', () => {
    expect(idClash('custom-a', null, new Set(['custom-a']))).toMatch(/Another part in My parts already has the id custom-a/)
    expect(idClash('custom-b', 'custom-a', new Set(['custom-a', 'custom-b']))).toMatch(/would change its id from custom-a to custom-b/)
    expect(idClash('custom-a', 'custom-a', new Set(['custom-a']))).toBeNull()
    expect(idClash('custom-c', null, new Set(['custom-a']))).toBeNull()
    const s = memory()
    const store = new MyPartsStore(() => s)
    store.save(part('A'))
    store.save(part('B'))
    expect(store.replace('custom-b', part('A'))).toBe(false)
    expect(store.getSnapshot().map((p) => p.module.id)).toEqual(['custom-b', 'custom-a'])
  })
})

describe('editing an imported part keeps what the part maker does not model', () => {
  const imported = (id: string) => {
    const r = importPart(JSON.stringify(modulesById[id]), [])
    if (!r.ok) throw new Error(r.message)
    return r.part
  }
  it('a no-op edit of an imported resistor keeps its resistance', () => {
    const p = imported('resistor')
    expect(unmodeled(p.module)).toEqual(expect.arrayContaining([expect.stringMatching(/electrical/)]))
    const r = savedModule(draftFromPart(p), p.module.id, p.module, false)
    expect(r.ok && r.module).toEqual(p.module)
    if (r.ok) expect((r.module.electrical as { params: { resistance: { default: number } } }).params.resistance.default).toBe(modulesById.resistor.electrical && (modulesById.resistor.electrical as { params: { resistance: { default: number } } }).params.resistance.default)
  })
  it('pin types and voltages, the name and the links change; holes, mains, capacity and art stay', () => {
    for (const id of ['tp4056-module', 'outlet-au-as3112', 'bme280-module-4pin']) {
      const p = imported(id)
      const d = draftFromPart(p)
      const side = SIDES.find((s) => d.pins[s].some((r) => !r.spacer && r.type !== 'ground'))
      const i = side ? d.pins[side].findIndex((r) => !r.spacer && r.type !== 'ground') : -1
      const edited = side ? { ...d, name: 'Renamed', pins: { ...d.pins, [side]: d.pins[side].map((r, j) => (j === i ? { ...r, supply: '5V' } : r)) } } : { ...d, name: 'Renamed' }
      const r = savedModule(edited, p.module.id, p.module, false)
      expect(r.ok && r.module, id).toBeTruthy()
      if (!r.ok) continue
      if (side) expect(r.module.pins.filter((x) => x.side === side && !('spacer' in x))[0], id).toMatchObject({ supply: '5V' })
      const { name, pins, ...rest } = r.module
      const { name: _n, pins: oldPins, ...oldRest } = p.module
      expect(name).toBe('Renamed')
      expect(rest).toEqual(oldRest)
      expect(pins.filter((x) => !('spacer' in x)).map((x) => ({ ...x, supply: undefined }))).toEqual(oldPins.filter((x) => !('spacer' in x)).map((x) => ({ ...x, supply: undefined })))
    }
  })
  it('a part made in the part maker edits fully; converting an imported one is explicit and drops the rest', () => {
    expect(unmodeled(part().module)).toEqual([])
    const p = imported('resistor')
    const r = savedModule(draftFromPart(p), p.module.id, p.module, true)
    expect(r.ok && r.module.electrical).toBeUndefined()
  })
})

describe('placing one of My parts', () => {
  it('never changes parts already on the sheet: edit, undo, place, then undo and redo keep every wire', () => {
    const v1 = part('A').module
    const v2 = moduleFromSpec({ name: 'A', source: 'https://example.com/a', pins: { left: [{ name: 'VCC', type: 'power_in', supply: '3V3' }, { name: 'GND', type: 'ground' }] } })
    let d = addPart(emptyDiagram(), v1, 0, 0).diagram
    d = addPart(d, modulesById.resistor, 200, 0).diagram
    const [u, r] = d.parts.map((x) => x.uid)
    d = { ...d, connections: [{ uid: 'w1', from: { part: u, pin: 'OUT' }, to: { part: r, pin: '1' } }] }
    const store = new EditorStore(d)
    // Edit: the explicit update drops the wire to OUT and says so.
    const upd = updateSheetModule(store.getState().diagram, v2)
    expect(upd.lost).toBe(1)
    store.commit(upd.diagram)
    store.undo()
    expect(store.getState().diagram.connections).toHaveLength(1)
    // Place the edited version from My parts: the sheet keeps its copy and the wire.
    const placed = placeOnSheet(store.getState().diagram, v2, 400, 0)
    store.commit(placed.diagram)
    const after = store.getState().diagram
    expect(after.modules['custom-a']).toEqual(v1)
    expect(after.connections.map((c) => c.uid)).toEqual(['w1'])
    expect(after.parts.filter((p) => p.module === 'custom-a')).toHaveLength(2)
    store.undo()
    expect(store.getState().diagram.parts).toHaveLength(2)
    expect(store.getState().diagram.connections).toHaveLength(1)
    store.redo()
    expect(store.getState().diagram.parts).toHaveLength(3)
    expect(store.getState().diagram.connections.map((c) => c.uid)).toEqual(['w1'])
    expect(store.getState().diagram.modules['custom-a']).toEqual(v1)
    // A part the sheet does not have yet is placed as given.
    expect(placeOnSheet(emptyDiagram(), v2, 0, 0).diagram.modules['custom-a']).toEqual(v2)
  })
})
