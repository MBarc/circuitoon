// Which grid cell the pointer is over, so pointer-move work that only matters per cell (finding the
// net label under the pointer) runs once per cell crossed rather than on every move event. Pure.
import type { Pt } from '../format/geometry.ts'

/** The 10 px grid cell holding world point `p`, as a key. */
export const gridCell = (p: Pt, grid = 10): string => `${Math.floor(p.x / grid)},${Math.floor(p.y / grid)}`

/** A gate that says yes once per new cell: `moved(p)` is true the first time `p` is in a cell other than the last one asked about. */
export function cellGate(grid = 10): { moved: (p: Pt) => boolean; reset: () => void } {
  let last: string | null = null
  return {
    moved(p) {
      const cell = gridCell(p, grid)
      if (cell === last) return false
      last = cell
      return true
    },
    reset() {
      last = null
    },
  }
}
