// `circuitoon module new|check|render`: custom parts for agents. `new` builds a custom module from a
// part spec (circuitoon-part-spec/1, from --spec <file> or standard input) with the editor's part
// maker (src/format/partMaker.ts), lints it and writes it; `check` lints any module file; `render`
// draws one part alone as PNG or SVG so the agent can look at it. A module from `new` drops straight
// into a netlist's `modules` under its own id.
import { type Diagram, DIAGRAM_FORMAT } from '../format/diagram.ts'
import { isCustom, isSpacer, layoutModule, type ModuleDef, validateModule } from '../format/module.ts'
import { type LintIssue, buildPart, lintModule } from '../format/partMaker.ts'
import { renderSheetSvg } from '../render/exportSvg.tsx'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, flag, pathIn, printJson, readJson, writeError, writeFile } from './io.ts'
import { writePng } from './png.ts'

export const MODULE_NEW_FORMAT = 'circuitoon-cli/module-new/1'
export const MODULE_CHECK_FORMAT = 'circuitoon-cli/module-check/1'
export const MODULE_USAGE = 'module: usage: circuitoon module new [--spec <spec.json>] [-o <part.json>] | module check <part.json> | module render <part.json> -o <part.png> [--svg <part.svg>] [--dark] [--scale n]'

const issueLines = (errors: LintIssue[], warnings: LintIssue[]) => [
  ...errors.map((e) => `error [${e.code}] ${e.message}`),
  ...warnings.map((w) => `warning [${w.code}] ${w.message}`),
]

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new CliError(`${what}: not valid JSON (${(e as Error).message})`, EXIT.input)
  }
}

/** The spec from --spec <file>, or standard input when --spec is left out or "-". */
function readSpec(args: Args, io: Io): { raw: unknown; from: string } {
  const path = flag(args, '--spec')
  if (path !== undefined && path !== '-') return { raw: readJson(io, path), from: path }
  const text = io.stdin?.() ?? ''
  if (!text.trim()) throw new CliError('module new: give --spec <spec.json>, or pipe the spec on standard input', EXIT.input)
  return { raw: parseJson(text, 'standard input'), from: 'standard input' }
}

function newCommand(args: Args, io: Io): number {
  if (args.positionals.length > 1) throw new CliError('module new: takes no file argument; give the spec with --spec <spec.json> or on standard input', EXIT.input)
  const { raw, from } = readSpec(args, io)
  const built = buildPart(raw)
  if (!built.ok) throw new CliError(`${from} is not a valid part spec: ${built.errors.slice(0, 8).join('; ')}`, EXIT.input)
  const m = built.module
  const lint = lintModule(m)
  const out = flag(args, '--out')
  const text = `${JSON.stringify(m, null, 2)}\n`
  // A part with lint errors is never written: fix the spec first.
  if (out && lint.ok) writeFile(io, out, text)
  const code = lint.ok ? EXIT.ok : EXIT.blocked
  if (args.flags.has('--json')) {
    printJson(io, { format: MODULE_NEW_FORMAT, ok: lint.ok, path: out && lint.ok ? out : null, module: m, notes: built.notes, errors: lint.errors, warnings: lint.warnings })
    return code
  }
  const lines = [...built.notes.map((n) => `note: ${n}`), ...issueLines(lint.errors, lint.warnings)]
  if (out) {
    const lay = layoutModule(m)
    const head = lint.ok ? `Wrote ${out}: ${m.id} (${m.pins.filter((p) => !isSpacer(p)).length} pins, ${lay.w} x ${lay.h} px), a custom part, unverified.` : `Not written: ${m.id} has lint errors.`
    io.stdout(`${[head, ...lines].join('\n')}\n`)
  } else {
    if (lint.ok) io.stdout(text)
    if (lines.length) io.stderr(`${lines.join('\n')}\n`)
  }
  return code
}

export interface ModuleCheckReport {
  format: typeof MODULE_CHECK_FORMAT
  ok: boolean
  path: string
  id: string | null
  name: string | null
  custom: boolean
  pins: number
  size: { w: number; h: number } | null
  errors: LintIssue[]
  warnings: LintIssue[]
}

export function checkModuleFile(raw: unknown, path: string): ModuleCheckReport {
  const lint = lintModule(raw)
  const v = validateModule(raw)
  const m = v.ok ? v.module : null
  const lay = m ? layoutModule(m) : null
  const o = raw as { id?: unknown; name?: unknown } | null
  return {
    format: MODULE_CHECK_FORMAT,
    ok: lint.ok,
    path,
    id: typeof o?.id === 'string' ? o.id : null,
    name: typeof o?.name === 'string' ? o.name : null,
    custom: isCustom(m ?? undefined),
    pins: m ? m.pins.filter((p) => !isSpacer(p)).length : 0,
    size: lay ? { w: lay.w, h: lay.h } : null,
    errors: lint.errors,
    warnings: lint.warnings,
  }
}

function checkCommand(args: Args, io: Io): number {
  const [, input, ...rest] = args.positionals
  if (!input) throw new CliError('module check: give a part file', EXIT.input)
  if (rest.length) throw new CliError('module check: give one part file', EXIT.input)
  const r = checkModuleFile(readJson(io, input), input)
  if (args.flags.has('--json')) printJson(io, r)
  else {
    const what = r.id ? `${r.id}${r.name ? ` (${r.name})` : ''}` : input
    const facts = r.size ? `, ${r.pins} pins, ${r.size.w} x ${r.size.h} px${r.custom ? ', custom (unverified)' : ''}` : ''
    const head = r.ok ? `OK: ${what}${facts}` : `PROBLEMS: ${what}: ${r.errors.length} error${r.errors.length === 1 ? '' : 's'}`
    io.stdout(`${[head, ...issueLines(r.errors, r.warnings)].join('\n')}\n`)
  }
  return r.ok ? EXIT.ok : EXIT.blocked
}

/** A sheet holding one part, alone, for a render. */
export function partSheet(m: ModuleDef): Diagram {
  return { format: DIAGRAM_FORMAT, title: m.name, modules: { [m.id]: m }, parts: [{ uid: 'p1', designator: 'U1', module: m.id, x: 0, y: 0, rotation: 0 }], connections: [] }
}

function renderCommand(args: Args, io: Io): number {
  const [, input] = args.positionals
  const png = flag(args, '--out')
  const svgPath = flag(args, '--svg')
  if (!input) throw new CliError('module render: give a part file', EXIT.input)
  if (!png && !svgPath) throw new CliError('module render: give -o <part.png>, --svg <part.svg>, or both', EXIT.input)
  const scale = Number(flag(args, '--scale') ?? '3')
  if (!(scale > 0 && scale <= 8)) throw new CliError('module render: --scale must be a number above 0, at most 8', EXIT.input)
  const v = validateModule(readJson(io, input))
  if (!v.ok) throw new CliError(`${input} is not a valid module: ${v.errors.slice(0, 5).join('; ')}`, EXIT.input)
  const drawn = renderSheetSvg(partSheet(v.module), { dark: args.flags.has('--dark') })
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
  }
  if (args.flags.has('--json')) printJson(io, { format: 'circuitoon-cli/render/1', outputs })
  else io.stdout(`${outputs.map((o) => `Wrote ${o.path} (${o.width} x ${o.height} px)`).join('\n')}\n`)
  return EXIT.ok
}

export function moduleCommand(args: Args, io: Io): number {
  const sub = args.positionals[0]
  if (sub === 'new') return newCommand(args, io)
  if (sub === 'check') return checkCommand(args, io)
  if (sub === 'render') return renderCommand(args, io)
  throw new CliError(sub ? `module: unknown subcommand "${sub}"; ${MODULE_USAGE.slice('module: '.length)}` : MODULE_USAGE, EXIT.input)
}
