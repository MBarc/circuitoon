// Properties of whatever is selected. Text fields commit on Enter or when they lose focus,
// so typing a name is one undo step, not one per keystroke.
import { useEffect, useState } from 'react'
import { type EditorStore, useEditorState } from './store.ts'
import { clearPartValue, clearWireRoute, deleteSelection, rotateParts, setWireEnds, updatePart, updatePartSetting, updatePartValue, updateWire, type WireStyle } from './ops.ts'
import { type Diagram, type Endpoint, NAMED_COLORS, isValidColor, moduleOf, partObstacles, routeWire, wireColor, wireWidth } from '../format/diagram.ts'
import { CABLE_PRESETS, END_KINDS, END_NAMES, END_SIZE, type EndKind, type WireEnds, endKind, normalizeEnds, presetEnds, presetOf, sharedCable, swapEnds } from '../format/cables.ts'
import { CableEnd } from '../render/CableEnd.tsx'
import { INK } from '../render/Part.tsx'
import { hexEditChanged, shownHex } from './color.ts'
import { checkFailed, highlightOf, severityCounts, useProblems } from './problems.ts'
import { type Finding, RULES, brokenConnection } from '../format/checks.ts'
import { SeverityMark } from './SeverityMark.tsx'
import { CAPACITOR_VALUES, RESISTOR_VALUES, editableParams, formatValue, paramValue, parseValue } from '../format/values.ts'
import { moduleSettings, partSetting } from '../format/module.ts'

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

/** A pin or hole as the sheet names it: "U1 GND", "BB1 c4-top". */
function endpointName(d: Diagram, ep: Endpoint): string {
  const part = d.parts.find((p) => p.uid === ep.part)
  const m = part && moduleOf(d, part.module)
  const pin = m?.pins.find((p) => 'name' in p && p.name === ep.pin)
  const label = pin && 'label' in pin && typeof pin.label === 'string' ? pin.label : ep.pin
  return `${part?.designator ?? ep.part} ${label}`
}

/** The cable as a small sticker: a short run of the wire with both of its ends drawn on. */
function CablePreview({ ends, color, gauge }: { ends: WireEnds | undefined; color: string; gauge: number | undefined }) {
  const w = wireWidth(gauge)
  const c = wireColor(color)
  const from = endKind(ends, 'from')
  const to = endKind(ends, 'to')
  const inset = (k: EndKind) => (END_SIZE[k].exposed ? END_SIZE[k].trim + (w + 2.2) / 2 : END_SIZE[k].trim)
  const x0 = 7
  const x1 = 113
  const d = `M${x0 + inset(from)} 13H${x1 - inset(to)}`
  return (
    <svg className="cable-preview" viewBox="0 0 120 26" aria-hidden="true">
      <path d={d} stroke={INK} strokeWidth={w + 2.2} strokeLinecap="round" fill="none" />
      <path d={d} stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" />
      <CableEnd kind={from} x={x0} y={13} angle={0} scale={1} color={c} width={w} />
      <CableEnd kind={to} x={x1} y={13} angle={180} scale={1} color={c} width={w} />
    </svg>
  )
}

/**
 * The Cable select: every preset, plus Custom when the ends match none, or Mixed (for several
 * wires) when they differ. Picking a preset sets both ends.
 */
function CableSelect({ id, value, onPick }: { id: string; value: string; onPick: (presetId: string) => void }) {
  return (
    <label className="field" htmlFor={id}>
      Cable
      <select id={id} value={value} onChange={(e) => onPick(e.target.value)}>
        {CABLE_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
        {value === 'custom' && <option value="custom" disabled>Custom</option>}
        {value === 'mixed' && <option value="mixed" disabled>Mixed</option>}
      </select>
    </label>
  )
}

/** The next wire's style in words: "black, 22 AWG, Dupont M-M". */
function newWireStyle(style: WireStyle): string {
  const picked = presetOf(style.ends)
  const cable = !picked ? 'a custom cable' : picked.id === 'wire' ? 'plain wire' : picked.name
  return `${style.color}, ${style.gauge} AWG, ${cable}`
}

/**
 * The "Ends: from / to" disclosure. It opens by itself only when a wire is first shown with a
 * Custom cable (the caller keys it on the wire uid); after that only the person opens or closes
 * it, so editing the ends never snaps it shut.
 */
function EndsDisclosure({ initiallyOpen, children }: { initiallyOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <details className="cable-ends" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Ends: from / to</summary>
      <div className="cable-ends-body">{children}</div>
    </details>
  )
}

const VALUE_LISTS: Record<string, number[]> = { ohm: RESISTOR_VALUES, F: CAPACITOR_VALUES }
const VALUE_LABELS: Record<string, string> = { resistance: 'Resistance', capacitance: 'Capacitance', voltage: 'Voltage', acVoltage: 'Mains voltage', fuseRating: 'Fuse rating' }
const SETTING_LABELS: Record<string, string> = { fuse: 'Fuse' }
const CHOICE_LABELS: Record<string, string> = { fitted: 'Fitted', absent: 'Absent (empty holder)' }

/**
 * Not given a `key` here; the caller keys the whole component on part uid plus the resolved
 * value, so switching parts (or an undo/redo that changes the value) remounts it from scratch,
 * including `invalid`, rather than leaving a stale hint from a previous part or value showing.
 */
function ValueInput({ id, label, unit, value, onCommit, onClear }: { id: string; label: string; unit: string; value: number | null; onCommit: (v: number) => void; onClear?: () => void }) {
  const [invalid, setInvalid] = useState(false)
  // An optional param with no value (a fuse rating not yet set) shows an empty field reading Unknown.
  const shown = value === null ? '' : formatValue(value, unit)
  const list = VALUE_LISTS[unit] ?? []
  return (
    <label className="field" htmlFor={id}>
      {label}
      <input
        id={id}
        defaultValue={shown}
        placeholder={value === null ? 'Unknown' : undefined}
        list={list.length ? `${id}-options` : undefined}
        aria-invalid={invalid || undefined}
        onBlur={(e) => {
          if (e.target.value === shown) return // unchanged: nothing to parse or commit
          // Emptying an optional value clears it, back to unknown.
          if (e.target.value.trim() === '' && onClear) {
            setInvalid(false)
            onClear()
            return
          }
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
        <datalist id={`${id}-options`}>
          {list.map((v) => (
            <option key={v} value={formatValue(v, unit)} />
          ))}
        </datalist>
      )}
      {invalid && <p className="hint" role="status">{unit === 'A' ? 'Use a rating like 2, 500m or 13 (amps), or leave it empty if unknown' : unit === 'VAC' ? 'Use a voltage like 120 or 230' : 'Use a value like 4.7k, 220 or 100n'}</p>}
    </label>
  )
}

/** Focuses the element found once React has drawn the next state (the panel swaps content). */
function focusSoon(find: () => HTMLElement | null) {
  requestAnimationFrame(() => find()?.focus())
}


/**
 * Each row's Select button name, "Select U1 VCC, voltage too high": its target and rule, with a
 * number added where two rows would otherwise read the same.
 */
function selectLabels(findings: Finding[]): string[] {
  const base = findings.map((f) => `Select ${f.target}, ${RULES[f.rule].title.toLowerCase()}`)
  const total = new Map<string, number>()
  for (const b of base) total.set(b, (total.get(b) ?? 0) + 1)
  const seen = new Map<string, number>()
  return base.map((b) => {
    if (total.get(b) === 1) return b
    const n = (seen.get(b) ?? 0) + 1
    seen.set(b, n)
    return `${b} (${n} of ${total.get(b)})`
  })
}

/**
 * The wiring checker's findings, errors first, with Select (the parts and wires involved, panned
 * into view) and, for a broken connection, Delete. Hovering or focusing a row lights its parts,
 * pins and wires on the canvas. Focus never falls to the page: Select moves it to the panel
 * heading of what it selected; Delete moves it to the next row's Select (the previous row's after
 * the last one), or to the list heading once no row is left.
 */
export function ProblemList({ store, findings }: { store: EditorStore; findings: Finding[] }) {
  const errors = findings.filter((f) => f.severity === 'error').length
  // The canvas light belongs to this list: it goes out when the list does (a selection, an empty list).
  useEffect(() => () => store.setHighlight(null), [store])
  if (checkFailed(store))
    return (
      <section className="problems has-warnings" aria-labelledby="problems-title">
        <h3 id="problems-title" tabIndex={-1}>Problems</h3>
        <ul>
          <li className="warning" data-checker-failed="">
            <SeverityMark severity="warning" />
            <div className="problem-text">
              <span className="problem-message">The wiring checker hit an error on this sheet.</span>
            </div>
          </li>
        </ul>
      </section>
    )
  if (!findings.length)
    return (
      <section className="problems clean" aria-labelledby="problems-title">
        <h3 id="problems-title" tabIndex={-1}>
          <SeverityMark severity="ok" />
          No wiring problems found
        </h3>
      </section>
    )
  const light = (f: Finding) => store.setHighlight(highlightOf(f))
  const unlight = () => store.setHighlight(null)
  const labels = selectLabels(findings)
  return (
    <section className={`problems ${errors ? 'has-errors' : 'has-warnings'}`} aria-labelledby="problems-title">
      <h3 id="problems-title" tabIndex={-1}>
        Problems
        <span className="problems-count">{severityCounts(findings)}</span>
      </h3>
      <ul onMouseLeave={unlight}>
        {findings.map((f, i) => {
          const title = RULES[f.rule].title
          const broken = f.rule === 'broken'
          return (
            <li
              key={f.id}
              className={f.severity}
              onMouseEnter={() => light(f)}
              onFocus={() => light(f)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) unlight()
              }}
            >
              <SeverityMark severity={f.severity} />
              <div className="problem-text">
                <span className="problem-title">
                  <span className="sr-only">{f.severity === 'error' ? 'Error: ' : 'Warning: '}</span>
                  {title}
                </span>
                <span className="problem-message" id={`problem-message-${i}`}>{f.message}</span>
              </div>
              <div className="problem-actions">
                <button
                  type="button"
                  className="tool small"
                  data-problem-select={f.id}
                  aria-label={labels[i]}
                  aria-describedby={`problem-message-${i}`}
                  onClick={() => {
                    const sel = f.select
                    store.setHighlight(null)
                    store.select(sel)
                    store.reveal()
                    focusSoon(() => document.getElementById(sel.parts.length === 0 && sel.wires.length === 1 ? 'wire-title' : 'selection-title'))
                  }}
                >
                  Select
                </button>
                {broken && (
                  <button
                    type="button"
                    className="tool small danger"
                    aria-label={`Delete ${f.subject}`}
                    aria-describedby={`problem-message-${i}`}
                    onClick={() => {
                      const s = store.getState()
                      store.setHighlight(null)
                      store.commit(deleteSelection(s.diagram, { parts: [], wires: f.wires }))
                      const next = (findings[i + 1] ?? findings[i - 1])?.id
                      focusSoon(() =>
                        (next !== undefined
                          ? document.querySelector<HTMLElement>(`[data-problem-select="${CSS.escape(next)}"]`)
                          : null) ?? document.getElementById('problems-title') ?? document.getElementById('sheet-heading'),
                      )
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function Inspector({ store }: { store: EditorStore }) {
  const { diagram, selection, wireStyle } = useEditorState(store)
  const findings = useProblems(store)
  const count = selection.parts.length + selection.wires.length
  const remove = (
    <button type="button" className="tool" onClick={() => store.commit(deleteSelection(diagram, selection))}>
      Delete
    </button>
  )

  if (count === 0)
    return (
      <aside className="inspector" aria-label="Properties">
        <h2 id="sheet-heading" tabIndex={-1}>Sheet</h2>
        <CommitInput id="sheet-title" label="Title" value={diagram.title} onCommit={(title) => store.commit({ ...diagram, title: title.trim() || 'Untitled sheet' })} />
        <p className="hint new-wires">New wires: {newWireStyle(wireStyle)}</p>
        <p className="hint">Drag from a pin tip or a hole to another pin or hole to add a wire. Drag the paper to pan, scroll to zoom. R rotates, Delete removes, Ctrl+Z undoes.</p>
        <ProblemList store={store} findings={findings} />
      </aside>
    )

  if (count > 1)
    return (
      <aside className="inspector" aria-label="Properties">
        <h2 id="selection-title" tabIndex={-1}>{count} items selected</h2>
        {selection.wires.length > 0 && (() => {
          const value = sharedCable(diagram.connections.filter((c) => selection.wires.includes(c.uid)).map((c) => c.ends))
          return (
            <CableSelect
              id="wires-cable"
              value={value}
              onPick={(pid) => {
                const ends = presetEnds(pid)
                store.commit(setWireEnds(diagram, selection.wires, ends))
                store.setWireStyle({ ...wireStyle, ends })
              }}
            />
          )
        })()}
        {selection.parts.length > 0 && (
          <button type="button" className="tool" onClick={() => store.commit(rotateParts(diagram, selection.parts))}>Rotate parts</button>
        )}
        {remove}
      </aside>
    )

  const part = diagram.parts.find((p) => p.uid === selection.parts[0])
  if (part) {
    const m = moduleOf(diagram, part.module)
    return (
      <aside className="inspector" aria-label="Properties">
        <h2 id="selection-title" tabIndex={-1}>{m?.name ?? part.module}</h2>
        <CommitInput
          id="part-designator"
          label="Name on sheet"
          value={part.designator}
          onCommit={(v) => v.trim() && store.commit(updatePart(diagram, part.uid, { designator: v.trim() }))}
        />
        {m && editableParams(m).map((pp, i) => {
          const v = paramValue(part, m, pp.name)
          return (
            <ValueInput
              key={`${part.uid}:${pp.name}:${v}`}
              id={i === 0 ? 'part-value' : `part-value-${pp.name}`}
              label={VALUE_LABELS[pp.name] ?? pp.name}
              unit={pp.unit}
              value={v}
              onCommit={(x) => store.commit(updatePartValue(diagram, part.uid, pp.name, x, pp.unit))}
              onClear={pp.default === null ? () => store.commit(clearPartValue(diagram, part.uid, pp.name)) : undefined}
            />
          )
        })}
        {m && Object.entries(moduleSettings(m)).map(([name, choices]) => (
          <label key={name} className="field" htmlFor={`part-setting-${name}`}>
            {SETTING_LABELS[name] ?? name}
            <select id={`part-setting-${name}`} value={partSetting(part, m, name) ?? choices[0]} onChange={(e) => store.commit(updatePartSetting(diagram, part.uid, name, e.target.value))}>
              {choices.map((c) => <option key={c} value={c}>{CHOICE_LABELS[c] ?? c}</option>)}
            </select>
          </label>
        ))}
        <p className="hint">Rotation: {part.rotation ?? 0} degrees</p>
        <button type="button" className="tool" onClick={() => store.commit(rotateParts(diagram, [part.uid]))}>Rotate 90 degrees</button>
        {remove}
      </aside>
    )
  }

  const wire = diagram.connections.find((c) => c.uid === selection.wires[0])
  if (!wire) return <aside className="inspector" aria-label="Properties" />
  // The Problems list has the broken wires; the notice names this one's missing ends.
  const brokenWire = findings.some((f) => f.rule === 'broken' && f.wires[0] === wire.uid) ? brokenConnection(diagram, wire) : null
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
      store.setWireStyle({ ...wireStyle, color: patch.color ?? wireStyle.color, gauge: patch.gauge ?? wireStyle.gauge })
  }
  // One undo step each. A cable picked (a preset or one end) also becomes the new-wire cable;
  // Swap ends only turns this wire round, so it leaves that alone.
  const setEnds = (ends: WireEnds | undefined, remember: boolean) => {
    store.commit(setWireEnds(diagram, [wire.uid], ends))
    if (remember) store.setWireStyle({ ...wireStyle, ends: normalizeEnds(ends) })
  }
  const cable = presetOf(wire.ends)

  return (
    <aside className="inspector" aria-label="Properties">
      <h2 id="wire-title" tabIndex={-1}>Wire</h2>
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
      <div className="cable">
        <CableSelect id="wire-cable" value={cable?.id ?? 'custom'} onPick={(pid) => setEnds(presetEnds(pid), true)} />
        <CablePreview ends={wire.ends} color={color} gauge={wire.gauge} />
        <EndsDisclosure key={wire.uid} initiallyOpen={!cable}>
          {(['from', 'to'] as const).map((which) => (
            <label key={which} className="field" htmlFor={`wire-end-${which}`}>
              <span>
                {which === 'from' ? 'From' : 'To'} <span className="end-at">{endpointName(diagram, wire[which])}</span>
              </span>
              <select
                id={`wire-end-${which}`}
                value={endKind(wire.ends, which)}
                onChange={(e) => setEnds({ ...wire.ends, [which]: e.target.value as EndKind }, true)}
              >
                {END_KINDS.map((k) => (
                  <option key={k} value={k}>{END_NAMES[k]}</option>
                ))}
              </select>
            </label>
          ))}
          <button
            type="button"
            className="tool small"
            disabled={endKind(wire.ends, 'from') === endKind(wire.ends, 'to')}
            onClick={() => setEnds(swapEnds(wire.ends), false)}
          >
            Swap ends
          </button>
        </EndsDisclosure>
      </div>
      <CommitInput id="wire-label" label="Label" value={wire.label ?? ''} onCommit={(v) => setWire({ label: v.trim() || undefined })} />
      <p className="hint">New wires use {newWireStyle(wireStyle)}.</p>
      {wire.route && (
        <div className="field" role="group" aria-label="Shape">
          <p className="hint">Shaped by hand</p>
          {/* A hand-shaped wire is never re-routed, so it can end up running through a part. */}
          {routeWire(diagram, wire, partObstacles(diagram))?.blocked && (
            <p className="hint warn" role="status">This wire passes through a part.</p>
          )}
          <button type="button" className="tool" onClick={() => store.commit(clearWireRoute(diagram, wire.uid))}>
            Reset to automatic
          </button>
        </div>
      )}
      {brokenWire ? (
        <p className="hint warn" role="status">
          Broken: {brokenWire.missing.join(' and ')} {brokenWire.missing.length > 1 ? 'are' : 'is'} not on the sheet, so this wire connects nothing and cannot be reshaped or reconnected. Delete it, and draw it again if you still need it.
        </p>
      ) : (
        <p className="hint">Drag the small handles to reshape the wire. Alt+click adds a bend.</p>
      )}
      {remove}
    </aside>
  )
}
