// Plain-words helpers shared by the wiring checker and the mains checks.

/** Natural order, so U2 sorts before U10. */
export const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** "A", "A or B", "A, B or C". */
export function orList(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}

/** "A", "A and B", "A, B and C". */
export function andList(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
