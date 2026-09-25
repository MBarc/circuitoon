// Properties of whatever is selected. Text fields commit on Enter or when they lose focus,
// so typing a name is one undo step, not one per keystroke.
import { type EditorStore, useEditorState } from './store.ts'
import { deleteSelection, rotateParts, updatePart, updateWire } from './ops.ts'
import { NAMED_COLORS, isValidColor, wireColor } from '../format/diagram.ts'

const GAUGES = Array.from({ length: 15 }, (_, i) => 16 + i)

function CommitInput({ id, label, value, onCommit }: { id: string; label: string; value: string; onCommit: (v: string) => void }) {
  return (
    <label className="field" htmlFor={id}>
      {label}
      <input
        id={id}
        key={value}
        defaultValue={value}
        onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  )
}

export function Inspector({ store }: { store: EditorStore }) {
  const { diagram, selection, wireStyle } = useEditorState(store)
  const count = selection.parts.length + selection.wires.length
  const remove = (
    <button type="button" className="tool" onClick={() => store.commit(deleteSelection(diagram, selection))}>
      Delete
    </button>
  )

  if (count === 0)
    return (
      <aside className="inspector" aria-label="Properties">
        <h2>Sheet</h2>
        <CommitInput id="sheet-title" label="Title" value={diagram.title} onCommit={(title) => store.commit({ ...diagram, title: title.trim() || 'Untitled sheet' })} />
        <p className="hint">Drag from a pin tip to another pin to add a wire. Drag the paper to pan, scroll to zoom. R rotates, Delete removes, Ctrl+Z undoes.</p>
      </aside>
    )

  if (count > 1)
    return (
      <aside className="inspector" aria-label="Properties">
        <h2>{count} items selected</h2>
        {selection.parts.length > 0 && (
          <button type="button" className="tool" onClick={() => store.commit(rotateParts(diagram, selection.parts))}>Rotate parts</button>
        )}
        {remove}
      </aside>
    )

  const part = diagram.parts.find((p) => p.uid === selection.parts[0])
  if (part) {
    const m = diagram.modules[part.module]
    return (
      <aside className="inspector" aria-label="Properties">
        <h2>{m?.name ?? part.module}</h2>
        <CommitInput
          id="part-designator"
          label="Name on sheet"
          value={part.designator}
          onCommit={(v) => v.trim() && store.commit(updatePart(diagram, part.uid, { designator: v.trim() }))}
        />
        <p className="hint">Rotation: {part.rotation ?? 0} degrees</p>
        <button type="button" className="tool" onClick={() => store.commit(rotateParts(diagram, [part.uid]))}>Rotate 90 degrees</button>
        {remove}
      </aside>
    )
  }

  const wire = diagram.connections.find((c) => c.uid === selection.wires[0])
  if (!wire) return <aside className="inspector" aria-label="Properties" />
  const color = wire.color ?? 'black'
  const gauge = wire.gauge ?? 22
  const setWire = (patch: { color?: string; gauge?: number; label?: string }) => {
    store.commit(updateWire(diagram, wire.uid, patch))
    store.setWireStyle({ color: patch.color ?? color, gauge: patch.gauge ?? gauge })
  }
  return (
    <aside className="inspector" aria-label="Properties">
      <h2>Wire</h2>
      <div className="field" role="group" aria-label="Color">
        Color
        <div className="swatches">
          {Object.keys(NAMED_COLORS).map((name) => (
            <button
              key={name}
              type="button"
              className="swatch"
              title={name}
              aria-label={name}
              aria-pressed={color.toLowerCase() === name}
              style={{ background: NAMED_COLORS[name] }}
              onClick={() => setWire({ color: name })}
            />
          ))}
        </div>
      </div>
      <label className="field" htmlFor="wire-hex">
        Custom color
        <input
          id="wire-hex"
          key={color}
          defaultValue={color.startsWith('#') ? color : wireColor(color)}
          placeholder="#2458C6"
          onBlur={(e) => {
            const v = e.target.value.trim()
            if (v !== color && isValidColor(v)) setWire({ color: v })
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </label>
      <label className="field" htmlFor="wire-gauge">
        Gauge (AWG)
        <select id="wire-gauge" value={gauge} onChange={(e) => setWire({ gauge: Number(e.target.value) })}>
          {GAUGES.map((g) => (
            <option key={g} value={g}>{g}{g === 22 ? ' (breadboard jumper)' : ''}</option>
          ))}
        </select>
      </label>
      <CommitInput id="wire-label" label="Label" value={wire.label ?? ''} onCommit={(v) => setWire({ label: v.trim() || undefined })} />
      <p className="hint">New wires use {wireStyle.color}, {wireStyle.gauge} AWG.</p>
      {remove}
    </aside>
  )
}
