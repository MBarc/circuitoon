// Net labels in the editor: placing one, renaming it as one undo step with its connectivity live,
// and finding the labels that share its name.
import { describe, expect, it } from 'vitest'
import { EditorStore } from './store.ts'
import { addPart, designatorPrefix, renameLabel } from './ops.ts'
import { emptyDiagram } from '../format/diagram.ts'
import { load } from '../format/builtinModules.testing.ts'
import { netlist, nodeKey } from '../format/netlist.ts'
import { labelMates, labelName } from '../format/netLabels.ts'
import { groupLibrary } from './libraryGroups.ts'

const label = load('net-label')

describe('net labels in the editor', () => {
  it('names new labels NL1, NL2 and starts them unnamed', () => {
    expect(designatorPrefix(label)).toBe('NL')
    const a = addPart(emptyDiagram(), label, 0, 0)
    const b = addPart(a.diagram, label, 100, 0)
    expect(b.diagram.parts.map((p) => p.designator)).toEqual(['NL1', 'NL2'])
    expect(labelName(b.diagram.parts[0])).toBe('')
  })
  it('renames as one undo step, trimmed, and the join follows the name at once', () => {
    let d = addPart(emptyDiagram(), label, 0, 0).diagram
    d = addPart(d, label, 100, 0).diagram
    const s = new EditorStore(d)
    s.commit(renameLabel(s.getState().diagram, 'p1', ' SDA '))
    s.commit(renameLabel(s.getState().diagram, 'p2', 'SDA'))
    const named = s.getState().diagram
    expect(named.parts[0].values).toEqual({ net: 'SDA' })
    expect(netlist(named).nets).toEqual([[nodeKey('p1', 'NET'), nodeKey('p2', 'NET')]])
    expect(labelMates(named, 'p1').map((p) => p.uid)).toEqual(['p2'])
    s.undo()
    expect(labelName(s.getState().diagram.parts[1])).toBe('')
    expect(netlist(s.getState().diagram).nets).toEqual([])
    s.undo()
    expect(s.canUndo).toBe(false)
    expect(labelName(s.getState().diagram.parts[0])).toBe('')
  })
  it('leaves the sheet alone for the same name, a part that is not a label, or a missing part', () => {
    const d = addPart(emptyDiagram(), label, 0, 0).diagram
    const named = renameLabel(d, 'p1', 'GND')
    expect(renameLabel(named, 'p1', 'GND ')).toBe(named)
    expect(renameLabel(named, 'nope', 'X')).toBe(named)
    const other = addPart(named, { ...label, id: 'not-label', netLabel: undefined }, 0, 0).diagram
    expect(renameLabel(other, 'p2', 'X')).toBe(other)
  })
  it('clears the stored name when renamed to nothing', () => {
    const d = renameLabel(addPart(emptyDiagram(), label, 0, 0).diagram, 'p1', 'GND')
    expect(renameLabel(d, 'p1', '  ').parts[0].values).toBeUndefined()
  })
  it('shows labels in their own Wiring group in the Parts panel', () => {
    const groups = groupLibrary([label, load('resistor'), load('jst-xh-2'), load('outlet-us-5-15r-duplex')])
    expect(groups.map((g) => g.category)).toEqual(['Passives', 'Connectors', 'Wiring', 'Mains'])
  })
})
