// `circuitoon render <sheet.json> -o <sheet.png> [--svg <sheet.svg>] [--dark] [--scale n] [--focus name]`
// (agent toolkit spec 4.1 and 4.2). --focus frames one repeat copy (`<repeat>_<k>`) or group of the
// sheet's intent, on the full sheet so every route is the same as in the full render. --tiles <px>
// also writes the sheet (or the focused part of it) cut into overlapping square tiles of about <px>
// sheet px, at the same scale, so a reviewer can read every corner of a large sheet up close.
import type { Diagram } from '../format/diagram.ts'
import type { Rect } from '../format/geometry.ts'
import { contentBounds, focusBounds, renderSheetSvg } from '../render/exportSvg.tsx'
import { parseNetlist } from '../agent/netlist.ts'
import { intentLookup } from '../agent/verify.ts'
import { libraryLookup } from '../agent/catalog.ts'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, flag, loadSheet, pathIn, printJson, writeError, writeFile } from './io.ts'
import { writePng } from './png.ts'

/** The part uids of a repeat copy or a group named in the sheet's intent; null when there is none. */
export function focusParts(d: Diagram, name: string): string[] | null {
  if (d.intent === undefined) return null
  const r = parseNetlist(d.intent, intentLookup(d, libraryLookup))
  if (!r.ok) return null
  const refs = r.intent.copies.find((c) => c.id === name)?.refs ?? r.intent.groups.find((g) => g.name === name)?.refs
  const uids = refs ? d.parts.filter((p) => refs.includes(p.designator)).map((p) => p.uid) : []
  return uids.length ? uids : null
}

/** Square tiles of about `size` px covering `box`, overlapping by 40 px, row by row from the top left (rows and columns count from 1). */
export function tilesOf(box: Rect, size: number): { row: number; col: number; box: Rect }[] {
  const overlap = 40
  const across = Math.max(1, Math.ceil((box.w - overlap) / (size - overlap)))
  const down = Math.max(1, Math.ceil((box.h - overlap) / (size - overlap)))
  const w = Math.min(size, box.w)
  const h = Math.min(size, box.h)
  const out: { row: number; col: number; box: Rect }[] = []
  for (let r = 0; r < down; r++)
    for (let c = 0; c < across; c++) {
      const x = across === 1 ? box.x : box.x + ((box.w - w) * c) / (across - 1)
      const y = down === 1 ? box.y : box.y + ((box.h - h) * r) / (down - 1)
      out.push({ row: r + 1, col: c + 1, box: { x: Math.round(x), y: Math.round(y), w, h } })
    }
  return out
}

export function renderCommand(args: Args, io: Io): number {
  const [input] = args.positionals
  const png = flag(args, '--out')
  const svgPath = flag(args, '--svg')
  if (!input) throw new CliError('render: give a sheet file', EXIT.input)
  if (!png && !svgPath) throw new CliError('render: give -o <sheet.png>, --svg <sheet.svg>, or both', EXIT.input)
  const scale = Number(flag(args, '--scale') ?? '2')
  if (!(scale > 0 && scale <= 8)) throw new CliError('render: --scale must be a number above 0, at most 8', EXIT.input)
  const { diagram } = loadSheet(io, input)
  const focus = flag(args, '--focus')
  let box: Rect | undefined
  if (focus !== undefined) {
    if (diagram.intent === undefined) throw new CliError(`render: ${input} has no intent, so there is no repeat copy or group to focus on (lay it out from a netlist)`, EXIT.input)
    const uids = focusParts(diagram, focus)
    if (!uids) throw new CliError(`render: the sheet's intent has no repeat copy or group named "${focus}"`, EXIT.input)
    box = focusBounds(diagram, uids)
  }
  const tileFlag = flag(args, '--tiles')
  const tile = tileFlag === undefined ? null : Number(tileFlag)
  if (tile !== null && !(Number.isInteger(tile) && tile >= 200 && tile <= 4000)) throw new CliError('render: --tiles must be a whole number of sheet px from 200 to 4000', EXIT.input)
  if (tile !== null && !png) throw new CliError('render: --tiles needs -o <sheet.png>; the tiles are written beside it', EXIT.input)
  const drawn = renderSheetSvg(diagram, { dark: args.flags.has('--dark'), box })
  const outputs: { kind: 'svg' | 'png'; path: string; width: number; height: number }[] = []
  if (svgPath) {
    writeFile(io, svgPath, drawn.svg)
    outputs.push({ kind: 'svg', path: svgPath, width: drawn.width, height: drawn.height })
  }
  if (png) {
    let shot: ReturnType<typeof writePng>
    try {
      shot = writePng(drawn, scale, pathIn(io, png), io.env)
    } catch (err) {
      throw writeError(png, err)
    }
    if (!shot.ok) throw new CliError(shot.message, EXIT.environment)
    outputs.push({ kind: 'png', path: png, width: shot.width, height: shot.height })
    if (tile !== null)
      for (const t of tilesOf(box ?? contentBounds(diagram), tile)) {
        const path = png.replace(/(\.png)?$/i, `-tile-${t.row}-${t.col}.png`)
        const part = renderSheetSvg(diagram, { dark: args.flags.has('--dark'), box: t.box })
        let s: ReturnType<typeof writePng>
        try {
          s = writePng(part, scale, pathIn(io, path), io.env)
        } catch (err) {
          throw writeError(path, err)
        }
        if (!s.ok) throw new CliError(s.message, EXIT.environment)
        outputs.push({ kind: 'png', path, width: s.width, height: s.height })
      }
  }
  if (args.flags.has('--json')) printJson(io, { format: 'circuitoon-cli/render/1', outputs })
  else io.stdout(`${outputs.map((o) => `Wrote ${o.path} (${o.width} x ${o.height} px)`).join('\n')}\n`)
  return EXIT.ok
}
