// The one tie-break every toolkit step uses: natural order ("R2" before "R10"), then plain code
// point order so two different strings never compare equal.
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0)
}
