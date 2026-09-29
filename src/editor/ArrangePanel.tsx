// Align and Distribute for a multi-selection, in the Inspector: six Align buttons from two items
// up, two Distribute buttons from three. Each click is one undo step (align.ts keeps the grid).
import type { ReactNode } from 'react'
import type { EditorStore } from './store.ts'
import type { Diagram } from '../format/diagram.ts'
import type { Selection } from './ops.ts'
import { alignable, alignSelection, distributeSelection, type AlignHow } from './align.ts'

/** A 22 px icon: a dark axis line and two yellow sticker boxes, drawn per action. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="arrange-icon" viewBox="0 0 22 22" aria-hidden="true">
      {children}
    </svg>
  )
}
const box = (x: number, y: number, w: number, h: number) => <rect className="box" x={x} y={y} width={w} height={h} rx={1.3} />
const axis = (d: string) => <path className="axis" d={d} />

const ALIGN: { how: AlignHow; label: string; icon: ReactNode }[] = [
  { how: 'left', label: 'Align left edges', icon: <Icon>{axis('M3.5 2.5V19.5')}{box(5.5, 4.5, 13, 5)}{box(5.5, 12.5, 8, 5)}</Icon> },
  { how: 'center', label: 'Align centers', icon: <Icon>{box(4, 4.5, 14, 5)}{box(7, 12.5, 8, 5)}{axis('M11 2V20')}</Icon> },
  { how: 'right', label: 'Align right edges', icon: <Icon>{axis('M18.5 2.5V19.5')}{box(3.5, 4.5, 13, 5)}{box(8.5, 12.5, 8, 5)}</Icon> },
  { how: 'top', label: 'Align top edges', icon: <Icon>{axis('M2.5 3.5H19.5')}{box(4.5, 5.5, 5, 13)}{box(12.5, 5.5, 5, 8)}</Icon> },
  { how: 'middle', label: 'Align middles', icon: <Icon>{box(4.5, 4, 5, 14)}{box(12.5, 7, 5, 8)}{axis('M2 11H20')}</Icon> },
  { how: 'bottom', label: 'Align bottom edges', icon: <Icon>{axis('M2.5 18.5H19.5')}{box(4.5, 3.5, 5, 13)}{box(12.5, 8.5, 5, 8)}</Icon> },
]

// Two outer lines with one box between them, and a guide-pink bar in each of the two equal gaps.
const DISTRIBUTE: { axis: 'x' | 'y'; label: string; icon: ReactNode }[] = [
  {
    axis: 'x',
    label: 'Distribute horizontally (equal gaps)',
    icon: <Icon>{axis('M2.5 3V19M19.5 3V19')}{box(8, 5, 6, 12)}<path className="tick" d="M4.5 11H6.5M15.5 11H17.5" /></Icon>,
  },
  {
    axis: 'y',
    label: 'Distribute vertically (equal gaps)',
    icon: <Icon>{axis('M3 2.5H19M3 19.5H19')}{box(5, 8, 12, 6)}<path className="tick" d="M11 4.5V6.5M11 15.5V17.5" /></Icon>,
  },
]

export function ArrangePanel({ store, diagram, selection }: { store: EditorStore; diagram: Diagram; selection: Selection }) {
  const { items, skipped } = alignable(diagram, selection)
  if (items.length < 2) return null
  return (
    <section className="arrange" aria-labelledby="arrange-title">
      <h3 id="arrange-title">Arrange</h3>
      <span className="arrange-label" id="align-label">Align</span>
      <div className="arrange-row" role="group" aria-labelledby="align-label">
        {ALIGN.map(({ how, label, icon }) => (
          <button key={how} type="button" className="tool icon" title={label} aria-label={label} data-align={how}
            onClick={() => store.commit(alignSelection(store.getState().diagram, store.getState().selection, how))}>
            {icon}
          </button>
        ))}
      </div>
      {items.length >= 3 && (
        <>
          <span className="arrange-label" id="distribute-label">Distribute</span>
          <div className="arrange-row" role="group" aria-labelledby="distribute-label">
            {DISTRIBUTE.map(({ axis, label, icon }) => (
              <button key={axis} type="button" className="tool icon" title={label} aria-label={label} data-distribute={axis}
                onClick={() => store.commit(distributeSelection(store.getState().diagram, store.getState().selection, axis))}>
                {icon}
              </button>
            ))}
          </div>
        </>
      )}
      {skipped.length > 0 && (
        <p className="hint">
          {skipped.length === 1 ? '1 part plugged into a board stays put' : `${skipped.length} parts plugged into a board stay put`}: select the board to move it with its parts.
        </p>
      )}
    </section>
  )
}
