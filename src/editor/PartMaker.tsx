// The part maker: a modal sticker card for making (or editing) a custom part. Name and category on
// the left; the pins in the middle, one side at a time, picked on a little drawing of the body
// (each edge a button with its pin count); a live preview on sheet paper on the right, drawn by the
// real renderer, with what the lint found under it. Pins can be added, removed and reordered with
// the buttons, Alt+Up/Down or by dragging (onto another edge of the body to move a pin there), and
// pasted as lines ("1 VCC power", "GND"). Saving needs a part with no errors.
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import { PIN_TYPES, SIDES, isSpacer, pinRoom, type PinType, type Side } from '../format/module.ts'
import { BODY_COLORS, DEFAULT_COLORS, lintModule, parsePinLines, unmodeled, type PartStyle } from '../format/partMaker.ts'
import { CATEGORY_ORDER } from './libraryGroups.ts'
import { Part, partBounds } from '../render/Part.tsx'
import { SeverityMark } from './SeverityMark.tsx'
import { type Draft, type PinRow, addPasted, emptyDraft, gapRow, idClash, moveRow, moveRowToSide, pinCount, pinRow, saveId, savedModule } from './partDraft.ts'
import type { MyPart } from './myParts.ts'

const SIDE_NAME: Record<Side, string> = { left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom' }
const SIDE_ORDER: Record<Side, string> = { left: 'top to bottom', right: 'top to bottom', top: 'left to right', bottom: 'left to right' }
const TYPE_NAME: Record<PinType, string> = {
  power_in: 'Power in', power_out: 'Power out', ground: 'Ground', input: 'Input', output: 'Output', io: 'In/out', passive: 'Passive', nc: 'Not connected',
}
const PIN_MIME = 'application/x-circuitoon-pin'

export interface PartMakerProps {
  /** The part being edited, or null for a new one. */
  editing: MyPart | null
  /** Ids already used by My parts (a new part avoids them). */
  taken: Set<string>
  onSave: (p: MyPart, wasId: string | null) => void
  onExport: (p: MyPart) => void
  onCancel: () => void
  /** Optional extra actions under the preview (Submit to library). */
  extra?: (p: MyPart | null) => ReactNode
  initial?: Draft
}

/** The little body drawing that picks the side being edited; each edge is a drop target too. */
function SidePicker({ draft, side, onPick, onDropPin }: { draft: Draft; side: Side; onPick: (s: Side) => void; onDropPin: (to: Side, e: React.DragEvent) => void }) {
  return (
    <div className="pm-sides" role="group" aria-label="Side of the part">
      {SIDES.map((s) => (
        <button
          key={s}
          type="button"
          className={`pm-side pm-side-${s}`}
          aria-pressed={side === s}
          onClick={() => onPick(s)}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(PIN_MIME)) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
            }
          }}
          onDrop={(e) => onDropPin(s, e)}
        >
          {SIDE_NAME[s]} <span className="pm-count">{pinCount(draft, s)}</span>
        </button>
      ))}
      <span className="pm-body" style={{ background: draft.color }} aria-hidden="true" />
    </div>
  )
}

export function PartMaker({ editing, taken, onSave, onExport, onCancel, extra, initial }: PartMakerProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState<Draft>(() => initial ?? emptyDraft())
  const [side, setSide] = useState<Side>(() => (['left', 'right', 'top', 'bottom'] as Side[]).find((s) => (initial ?? emptyDraft()).pins[s].length) ?? 'left')
  const [paste, setPaste] = useState('')
  const [pasteErrors, setPasteErrors] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  const focusKey = useRef<{ key: number; field: string } | null>(null)
  const titleId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const pasteRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
    nameRef.current?.focus()
    // A new part starts with the paste box open: pasting a pinout is the quickest way in.
    if (!editing && pasteRef.current) pasteRef.current.open = true
  }, [])
  // After a keyboard move, focus stays on the moved row's field.
  useEffect(() => {
    const f = focusKey.current
    if (!f) return
    focusKey.current = null
    ref.current?.querySelector<HTMLElement>(`[data-row="${f.key}"] [data-field="${f.field}"]`)?.focus()
  })

  const update = (next: Draft) => {
    setDraft(next)
    setDirty(true)
  }
  const id = saveId(draft, editing ? editing.module.id : null, taken)
  // A part the part maker cannot rebuild exactly (an imported resistor, a board with holes) is edited
  // in place, pin types and voltages only, until the person converts it to a plain custom part.
  const limited = useMemo(() => (editing ? unmodeled(editing.module) : []), [editing])
  const [converted, setConverted] = useState(false)
  const pinsOnly = limited.length > 0 && !converted
  const built = useMemo(() => savedModule(draft, id, editing?.module ?? null, converted), [draft, id, editing, converted])
  const lint = useMemo(() => (built.ok ? lintModule(built.module) : null), [built])
  const part: MyPart | null = built.ok ? { module: built.module, ...(draft.maker.trim() ? { maker: draft.maker.trim() } : {}), saved: Date.now() } : null
  const clash = built.ok ? idClash(built.module.id, editing ? editing.module.id : null, taken) : null
  const blockers = !draft.name.trim() ? ['Give the part a name.'] : !built.ok ? built.errors : clash ? [clash] : lint && !lint.ok ? lint.errors.map((e) => e.message) : []
  const canSave = blockers.length === 0 && !!part

  const rows = draft.pins[side]
  const setRows = (next: PinRow[]) => update({ ...draft, pins: { ...draft.pins, [side]: next } })
  const setRow = (i: number, patch: Partial<PinRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const move = (i: number, to: number, field?: string) => {
    if (to < 0 || to >= rows.length) return
    if (field) focusKey.current = { key: rows[i].key, field }
    update(moveRow(draft, side, i, to))
  }

  const cancel = () => {
    if (dirty && !window.confirm(editing ? `Discard your changes to ${editing.module.name}?` : 'Discard this part?')) return
    onCancel()
  }

  const preview = built.ok ? built.module : null
  const box = preview ? partBounds(preview) : null
  const room = preview ? pinRoom(preview) - 8 + 6 : 0

  return (
    <dialog
      ref={ref}
      className="pm-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        cancel()
      }}
    >
      <form
        className="pm-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSave && part) onSave(part, editing ? editing.module.id : null)
        }}
      >
        <div className="pm-head">
          <h2 id={titleId}>{editing ? `Edit ${editing.module.name}` : 'New part'}</h2>
          <p className="hint">Your parts stay in this browser, under My parts. They are marked custom: nobody has checked them.</p>
        </div>

        <section className="pm-about" aria-label="About the part">
          <label className="field">Name
            <input ref={nameRef} data-testid="pm-name" value={draft.name} maxLength={120} placeholder="INA219 current sensor" onChange={(e) => update({ ...draft, name: e.target.value })} />
          </label>
          <label className="field">Category
            <input list="pm-categories" value={draft.category} maxLength={60} onChange={(e) => update({ ...draft, category: e.target.value })} />
            <datalist id="pm-categories">
              {['Custom', ...CATEGORY_ORDER].map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
          <label className="field">Maker or model <span className="pm-opt">optional</span>
            <input value={draft.maker} placeholder="Adafruit 904" onChange={(e) => update({ ...draft, maker: e.target.value })} />
          </label>
          <label className="field">Datasheet and pinout links <span className="pm-opt">one per line</span>
            <textarea rows={3} value={draft.source} placeholder="https://..." onChange={(e) => update({ ...draft, source: e.target.value })} />
          </label>
          <fieldset className="pm-style" disabled={pinsOnly}>
            <legend>Drawn as</legend>
            {(['board', 'chip'] as PartStyle[]).map((s) => (
              <label key={s} className={draft.style === s ? 'on' : undefined}>
                <input
                  type="radio" name="pm-style" value={s} checked={draft.style === s}
                  onChange={() => update({ ...draft, style: s, color: draft.color === DEFAULT_COLORS[draft.style] ? DEFAULT_COLORS[s] : draft.color })}
                />
                {s === 'board' ? 'A board, names on the header' : 'A chip, names at the pin tips'}
              </label>
            ))}
          </fieldset>
          <fieldset className="pm-colors" disabled={pinsOnly}>
            <legend>Body colour</legend>
            <div className="pm-swatches">
              {BODY_COLORS.map((c) => (
                <button key={c} type="button" className="swatch" style={{ background: c }} aria-label={`Body colour ${c}`} aria-pressed={draft.color.toLowerCase() === c.toLowerCase()} onClick={() => update({ ...draft, color: c })} />
              ))}
              <label className="pm-color-pick" title="Any colour">
                <span className="sr-only">Any body colour</span>
                <input type="color" value={draft.color} onChange={(e) => update({ ...draft, color: e.target.value.toUpperCase() })} />
              </label>
            </div>
          </fieldset>
          <fieldset className="pm-size" disabled={pinsOnly}>
            <legend>Body size</legend>
            <label><input type="checkbox" checked={!draft.sized} onChange={(e) => update({ ...draft, sized: !e.target.checked, ...(preview?.size ? { w: preview.size.w, h: preview.size.h } : {}) })} /> Fit the pins and labels</label>
            {draft.sized && (
              <div className="pm-size-row">
                <label>Width <input type="number" min={2} max={400} value={draft.w} onChange={(e) => update({ ...draft, w: Math.max(2, Math.min(400, Math.round(Number(e.target.value) || 2))) })} /></label>
                <label>Height <input type="number" min={2} max={400} value={draft.h} onChange={(e) => update({ ...draft, h: Math.max(2, Math.min(400, Math.round(Number(e.target.value) || 2))) })} /></label>
                <span className="hint">grid squares</span>
              </div>
            )}
          </fieldset>
        </section>

        <section className="pm-pins" aria-label="Pins">
          {pinsOnly && (
            <div className="pm-limited" role="note">
              <p>This part has {limited.join(', ')}, which the part maker does not edit. Here you can change its name, links and each pin's type and voltage; everything else is kept as it is.</p>
              <button type="button" className="tool small" onClick={() => {
                if (window.confirm(`Convert ${editing?.module.name} to a plain custom part? It is redrawn by the part maker, and saving drops: ${limited.join(', ')}.`)) setConverted(true)
              }}>Convert to a plain custom part</button>
            </div>
          )}
          <SidePicker
            draft={draft}
            side={side}
            onPick={setSide}
            onDropPin={(to, e) => {
              if (pinsOnly) return
              const from = Number(e.dataTransfer.getData(PIN_MIME))
              if (!Number.isInteger(from)) return
              e.preventDefault()
              update(moveRowToSide(draft, side, from, to))
              setSide(to)
            }}
          />
          <h3 className="pm-side-title">{SIDE_NAME[side]} side <span className="hint">in order, {SIDE_ORDER[side]}, as the maker's pinout shows it</span></h3>
          {rows.length === 0 && <p className="hint pm-empty">No pins on this side.</p>}
          <ol className="pm-rows">
            {rows.map((r, i) => {
              const label = r.spacer ? `gap ${i + 1}` : r.name.trim() || `pin ${i + 1}`
              return (
                <li
                  key={r.key}
                  data-row={r.key}
                  className={r.spacer ? 'pm-row gap' : 'pm-row'}
                  onKeyDown={(e) => {
                    if (pinsOnly || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
                    e.preventDefault()
                    const field = (e.target as HTMLElement).dataset.field ?? 'name'
                    move(i, i + (e.key === 'ArrowUp' ? -1 : 1), field)
                  }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes(PIN_MIME)) {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                    }
                  }}
                  onDrop={(e) => {
                    const from = Number(e.dataTransfer.getData(PIN_MIME))
                    if (pinsOnly || !Number.isInteger(from)) return
                    e.preventDefault()
                    update(moveRow(draft, side, from, i))
                  }}
                >
                  <span
                    className="pm-grip" draggable={!pinsOnly} title="Drag to reorder, or onto another side of the body"
                    onDragStart={(e) => {
                      e.dataTransfer.setData(PIN_MIME, String(i))
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    aria-hidden="true"
                  />
                  <span className="pm-num" aria-hidden="true">{i + 1}</span>
                  {r.spacer ? (
                    <span className="pm-gap-text">Gap (no pin here)</span>
                  ) : (
                    <>
                      <input data-field="name" aria-label={`Name of pin ${i + 1}`} className="pm-in-name" value={r.name} placeholder="Name" maxLength={40} readOnly={pinsOnly} onChange={(e) => setRow(i, { name: e.target.value })} />
                      <select data-field="type" aria-label={`Type of ${label}`} value={r.type} onChange={(e) => setRow(i, { type: e.target.value as PinType | '' })}>
                        <option value="">Type not set</option>
                        {PIN_TYPES.map((t) => <option key={t} value={t}>{TYPE_NAME[t]}</option>)}
                      </select>
                      <input data-field="supply" aria-label={`Voltage of ${label}`} className="pm-in-supply" value={r.supply} placeholder={r.type === 'power_in' || r.type === 'power_out' ? '3V3/5V' : 'Volts'} maxLength={30} onChange={(e) => setRow(i, { supply: e.target.value })} />
                    </>
                  )}
                  {!pinsOnly && <span className="pm-row-tools">
                    <button type="button" data-field="up" className="tool icon tiny" aria-label={`Move ${label} up`} disabled={i === 0} onClick={() => move(i, i - 1, 'up')}>
                      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 7.5 6 4.5l3 3" /></svg>
                    </button>
                    <button type="button" data-field="down" className="tool icon tiny" aria-label={`Move ${label} down`} disabled={i === rows.length - 1} onClick={() => move(i, i + 1, 'down')}>
                      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5l3-3" /></svg>
                    </button>
                    <button type="button" className="tool icon tiny danger" aria-label={`Remove ${label}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 3.5l5 5M8.5 3.5l-5 5" /></svg>
                    </button>
                  </span>}
                </li>
              )
            })}
          </ol>
          {!pinsOnly && <div className="pm-add">
            <button type="button" className="tool small" onClick={() => {
              const row = pinRow()
              focusKey.current = { key: row.key, field: 'name' }
              setRows([...rows, row])
            }}>Add pin</button>
            <button type="button" className="tool small" onClick={() => setRows([...rows, gapRow()])}>Add gap</button>
          </div>}
          {!pinsOnly && <details ref={pasteRef} className="pm-paste">
            <summary>Paste pins</summary>
            <p className="hint">One pin a line: an optional number, the name, then a type and a voltage if you know them. <code>1 VCC power 3V3</code>, <code>GND</code>. A line saying <code>Right:</code> sends the next pins to that side.</p>
            <textarea aria-label="Pasted pins" rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'1 VCC power 3V3\n2 GND ground\n3 SDA io'} />
            <button type="button" className="tool small" disabled={!paste.trim()} onClick={() => {
              const r = parsePinLines(paste, side)
              setPasteErrors(r.errors)
              if (r.pins.length) update(addPasted(draft, r.pins))
              if (!r.errors.length) setPaste('')
            }}>Add these pins to the {SIDE_NAME[side].toLowerCase()} side</button>
            {pasteErrors.length > 0 && <ul className="pm-paste-errors" role="alert">{pasteErrors.map((e) => <li key={e}>{e}</li>)}</ul>}
          </details>}
        </section>

        <section className="pm-preview" aria-label="Preview">
          <div className="pm-paper" data-testid="pm-preview">
            {preview && box ? (
              <svg viewBox={`${box.x - room} ${box.y - room} ${box.w + 2 * room} ${box.h + 2 * room}`} role="img" aria-label={`Preview of ${preview.name}`}>
                <Part module={preview} />
              </svg>
            ) : <p className="hint">The preview shows here once the part has a name and a pin.</p>}
          </div>
          {preview && (
            <p className="pm-facts">
              <span className="custom-badge">custom</span>
              {preview.pins.filter((p) => !isSpacer(p)).length} pins, {preview.size?.w} x {preview.size?.h} grid squares
              <span className="pm-id" title="The part's id, used in sheets and netlists">{preview.id}</span>
            </p>
          )}
          <div className="pm-lint" aria-live="polite">
            {blockers.map((b) => <p key={b} className="pm-issue error"><SeverityMark severity="error" />{b}</p>)}
            {built.ok && built.notes.map((n) => <p key={n} className="pm-issue info"><SeverityMark severity="info" />{n}</p>)}
            {lint?.warnings.map((w) => <p key={w.code + (w.pin ?? '')} className="pm-issue warning"><SeverityMark severity="warning" />{w.message}</p>)}
            {lint?.ok && !lint.warnings.length && <p className="pm-issue ok"><SeverityMark severity="ok" />Ready. Check every pin against the datasheet once more before you wire it.</p>}
          </div>
          {extra?.(part)}
        </section>

        <div className="pm-actions">
          <button type="button" className="tool" disabled={!part} onClick={() => part && onExport(part)}>Export file</button>
          <span className="pm-spacer" />
          <button type="button" className="tool" onClick={cancel}>Cancel</button>
          <button type="submit" className="tool primary" disabled={!canSave}>{editing ? 'Save changes' : 'Save and place'}</button>
        </div>
      </form>
    </dialog>
  )
}
