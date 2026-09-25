// Properties of whatever is selected. Text fields commit on Enter or when they lose focus,
// so typing a name is one undo step, not one per keystroke.
import { useState } from 'react'
import { type EditorStore, useEditorState } from './store.ts'
import { deleteSelection, rotateParts, updatePart, updatePartValue, updateWire } from './ops.ts'
import { NAMED_COLORS, isValidColor, moduleOf } from '../format/diagram.ts'
import { hexEditChanged, shownHex } from './color.ts'
import { CAPACITOR_VALUES, RESISTOR_VALUES, formatValue, parseValue, partValue, primaryParam } from '../format/values.ts'

const GAUGES = Array.from({ length: 15 }, (_, i) => 16 + i)

function CommitInput({ id, label, value, onCommit }: { id: string; label: string; value: string; onCommit: (v: string) => void }) {
  return (
    <label className="field" htmlFor={id}>
      {label}
      <input
        id={id}
        key={value}
        defaultValue={value}
        onBlur={(e) => {
          if (e.target.value !== value) onCommit(e.target.value)
          // A rejected or normalized edit leaves the diagram's value unchanged, so no remount
          // happens; put the real value back so the field never shows stale text.
          e.target.value = value
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  )
}

function WireHexInput({ wireKey, color, onCommit }: { wireKey: string; color: string; onCommit: (v: string) => void }) {
  const [invalid, setInvalid] = useState(false)
  const shown = shownHex(color)
  return (
    <label className="field" htmlFor="wire-hex">
      Custom color
      <input
        id="wire-hex"
        key={wireKey}
        defaultValue={shown}
        placeholder="#3D6FD6"
        aria-invalid={invalid || undefined}
        onBlur={(e) => {
          const v = e.target.value.trim()
          if (!hexEditChanged(color, v)) {
            e.target.value = shown
            return
          }
          if (isValidColor(v)) {
            setInvalid(false)
            onCommit(v)
          } else {
            setInvalid(true)
            e.target.value = shown
          }
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {invalid && <p className="hint" role="status">Use a color name or #RRGGBB, for example #3D6FD6</p>}
    </label>
  )
}

const VALUE_LISTS: Record<string, number[]> = { ohm: RESISTOR_VALUES, F: CAPACITOR_VALUES }

function ValueInput({ fieldKey, label, unit, value, onCommit }: { fieldKey: string; label: string; unit: string; value: number; onCommit: (v: number) => void }) {
  const [invalid, setInvalid] = useState(false)
  const shown = formatValue(value, unit)
  const list = VALUE_LISTS[unit] ?? []
  return (
    <label className="field" htmlFor="part-value">
      {label}
      <input
        id="part-value"
        key={fieldKey}
        defaultValue={shown}
        list={list.length ? 'part-value-options' : undefined}
        aria-invalid={invalid || undefined}
        onBlur={(e) => {
          const parsed = parseValue(e.target.value, unit)
          if (parsed === null) {
            setInvalid(true)
            e.target.value = shown
            return
          }
          setInvalid(false)
          onCommit(parsed)
          // A no-op edit (same value, different notation) leaves the diagram unchanged, so no
          // remount happens; put the canonical text back so the field never shows raw input.
          e.target.value = shown
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {list.length > 0 && (
        <datalist id="part-value-options">
          {list.map((v) => (
            <option key={v} value={formatValue(v, unit)} />
          ))}
        </datalist>
      )}
      {invalid && <p className="hint" role="status">Use a value like 4.7k, 220 or 100n</p>}
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
    const m = moduleOf(diagram, part.module)
    const pp = m && primaryParam(m)
    const resolved = pp && m && partValue(part, m)
    return (
      <aside className="inspector" aria-label="Properties">
        <h2>{m?.name ?? part.module}</h2>
        <CommitInput
          id="part-designator"
          label="Name on sheet"
          value={part.designator}
          onCommit={(v) => v.trim() && store.commit(updatePart(diagram, part.uid, { designator: v.trim() }))}
        />
        {pp && resolved && (
          <ValueInput
            fieldKey={`${part.uid}:${resolved.value}:${resolved.unit}`}
            label={pp.name.charAt(0).toUpperCase() + pp.name.slice(1)}
            unit={pp.unit}
            value={resolved.value}
            onCommit={(v) => store.commit(updatePartValue(diagram, part.uid, pp.name, v, pp.unit))}
          />
        )}
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
    // Skip the commit (and the undo entry it would create) when the patch matches what's
    // already stored, e.g. clicking the swatch for the wire's current color.
    const noChange = (['color', 'gauge', 'label'] as const).every((k) => {
      if (!(k in patch)) return true
      if (k === 'color') return (patch.color ?? '').toLowerCase() === color.toLowerCase()
      if (k === 'gauge') return patch.gauge === gauge
      return (patch.label ?? undefined) === (wire.label ?? undefined)
    })
    if (noChange) return
    store.commit(updateWire(diagram, wire.uid, patch))
    // Only a color or gauge edit should steer the next wire drawn; a label edit shouldn't
    // reset the working style back to this wire's own values, so fall back to the current
    // wireStyle (not this wire's color/gauge) for whichever field the patch didn't touch.
    if ('color' in patch || 'gauge' in patch)
      store.setWireStyle({ color: patch.color ?? wireStyle.color, gauge: patch.gauge ?? wireStyle.gauge })
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
      <WireHexInput wireKey={`${wire.uid}:${color}`} color={color} onCommit={(v) => setWire({ color: v })} />
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
