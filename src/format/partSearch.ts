// Describe a part in words and get the closest match. One pure ranking shared by the editor's Parts
// panel ("Closest matches") and `circuitoon parts --search`. The query is cut into words, stop words
// dropped and a few synonyms added ("rpi" is also "raspberry pi"); each part scores the best hit of
// every word in its name, uses, description, category and pin names. Built-in parts get their
// description and uses from src/format/partText.json; a custom part carries its own.
import { isSpacer, type ModuleDef } from './module.ts'

export interface PartText {
  description: string
  uses: string[]
}
export interface RankedPart {
  module: ModuleDef
  score: number
}

/** A part's description and uses: its own (a custom part's) win over the library table's. */
export function partTextOf(m: ModuleDef, table: Record<string, PartText>): PartText | undefined {
  if (m.description || m.uses?.length) return { description: m.description ?? '', uses: m.uses ?? [] }
  return Object.hasOwn(table, m.id) ? table[m.id] : undefined
}

const STOP = new Set(
  ('a an the for with to of and or my that on in i im me need want wanted some something thing part parts is it its this these those ' +
    'can could would should will use using used like looking look find get which what from by at be any into so').split(' '),
)

/** Other words for the same thing, matched at full weight (already in stem form, see `stem`). */
const SYNONYMS: Record<string, string[]> = {
  rpi: ['raspberry', 'pi'], pi: ['raspberry'], raspberry: ['pi'],
  screen: ['display'], monitor: ['display'], touchscreen: ['touch', 'display'],
  mcu: ['microcontroller'], microcontroller: ['mcu'],
  charger: ['charge', 'charging'], charging: ['charge', 'charger'], charge: ['charger', 'charging'],
  batt: ['battery'], amp: ['amplifier'], mic: ['microphone'], microphone: ['mic'],
  pushbutton: ['push', 'button'], temp: ['temperature'], temperature: ['temp'], humidity: ['humid', 'hygrometer'],
  sd: ['microsd'], microsd: ['sd'], pot: ['potentiometer'], cap: ['capacitor'], neopixel: ['ws2812b', 'ws2812d'],
  lipo: ['lithium', 'li', 'ion'],
}
/** Words for a related or wider thing, matched at half weight, so "oled" lists OLEDs before other displays and "servo" servos before motor drivers. */
const RELATED: Record<string, string[]> = {
  lcd: ['display'], tft: ['display'], oled: ['display'], arduino: ['microcontroller'], microcontroller: ['arduino', 'board'],
  button: ['switch'], switch: ['button'], motor: ['servo', 'stepper'], servo: ['motor'], stepper: ['motor'],
  cell: ['battery'], light: ['led', 'lamp'], led: ['light'],
}

/** "USB-C", "usb c", "Type-C" and "usbc" all become the one word "usbc", and "3.3V" becomes "3v3", on both sides. */
const normalize = (s: string) =>
  s.toLowerCase().replace(/\b(?:usb|type)[\s-]?c\b/g, 'usbc').replace(/(\d)\.(\d)\s?v\b/g, '$1v$2')

/** Plural to singular, the same on both sides: "displays" is "display", "batteries" is "battery", "switches" is "switch". */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`
  if (/(?:ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

const words = (s: string): string[] => normalize(s).split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).map(stem)

/** True when a and b differ by one edit: a change, an insertion, a deletion or two neighbours swapped. */
function oneEdit(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false
  if (a.length === b.length) {
    const diff: number[] = []
    for (let i = 0; i < a.length && diff.length < 3; i++) if (a[i] !== b[i]) diff.push(i)
    return diff.length === 1 || (diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]])
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a]
  let i = 0
  while (i < s.length && s[i] === l[i]) i++
  return s.slice(i) === l.slice(i + 1)
}

/** How well `q` matches one of `fieldWords`: 1 whole word, 0.8 prefix (4+ letters), 0.5 one typo (5+ letters, not a number). */
function hit(q: string, fieldWords: string[]): number {
  let best = 0
  for (const w of fieldWords) {
    if (w === q) return 1
    if (q.length >= 4 && w.startsWith(q)) best = Math.max(best, 0.8)
    else if (q.length >= 5 && /[a-z]/.test(q) && oneEdit(q, w)) best = Math.max(best, 0.5)
  }
  return best
}

/**
 * The `limit` parts that best match a description in words, best first. A part is listed only when
 * it hits at least half of the query's meaningful words (the first 20). Each word scores its best
 * hit (or a synonym's; a related word's at half weight) in the name (5), uses (3), description (3), category (2) or pin names (1).
 * Ties go to the part whose fields hit the words most often, then by name.
 */
export function rankParts(modules: ModuleDef[], query: string, table: Record<string, PartText>, limit = 5): RankedPart[] {
  const concepts = [...new Set(words(query))].slice(0, 20).map((w): [string, number][] => [[w, 1], ...(SYNONYMS[w] ?? []).map((x): [string, number] => [x, 1]), ...(RELATED[w] ?? []).map((x): [string, number] => [x, 0.5])])
  if (!concepts.length) return []
  const ranked: (RankedPart & { depth: number })[] = []
  for (const m of modules) {
    const t = partTextOf(m, table)
    const fields: [number, string[]][] = [
      [5, words(m.name)],
      [3, words((t?.uses ?? []).join(' '))],
      [3, words(t?.description ?? '')],
      [2, words(m.category ?? '')],
      [1, words(m.pins.flatMap((p) => (isSpacer(p) ? [] : [p.name, p.label ?? ''])).join(' '))],
    ]
    let score = 0
    let hits = 0
    let depth = 0
    for (const alts of concepts) {
      let best = 0
      for (const [weight, fw] of fields) {
        let inField = 0
        for (const [q, factor] of alts) inField = Math.max(inField, weight * hit(q, fw) * factor)
        best = Math.max(best, inField)
        depth += inField
      }
      if (best > 0) hits++
      score += best
    }
    if (hits * 2 >= concepts.length) ranked.push({ module: m, score: Math.round(score * 10) / 10, depth })
  }
  return ranked
    .sort((a, b) => b.score - a.score || b.depth - a.depth || a.module.name.localeCompare(b.module.name))
    .slice(0, limit)
    .map(({ module, score }) => ({ module, score }))
}
