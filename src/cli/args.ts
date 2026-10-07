// Command-line parsing for the circuitoon CLI: a command, positionals and a fixed set of flags.
// Unknown flags are errors, never guessed.
export interface Args {
  command?: string
  positionals: string[]
  flags: Map<string, string | true>
  /** Flags that may repeat, each value in order (ruling R26: --probe; run's --input and --press). */
  lists?: Map<string, string[]>
}

const LIST_FLAGS = new Set(['--probe', '--input', '--press'])
const VALUE_FLAGS = new Set(['--out', '--svg', '--scale', '--focus', '--search', '--keep', '--labels', '--tiles', '--spec', '--board', '--for', '--py-dir'])
const BOOL_FLAGS = new Set(['--json', '--dark', '--help'])
const ALIASES: Record<string, string> = { '-o': '--out', '-h': '--help' }

export function parseArgs(argv: string[]): { ok: true; value: Args } | { ok: false; error: string } {
  const positionals: string[] = []
  const flags = new Map<string, string | true>()
  const lists = new Map<string, string[]>()
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    const name = Object.hasOwn(ALIASES, raw) ? ALIASES[raw] : raw
    if (!name.startsWith('-')) {
      positionals.push(raw)
      continue
    }
    if (BOOL_FLAGS.has(name)) {
      flags.set(name, true)
      continue
    }
    if (LIST_FLAGS.has(name)) {
      const v = argv[i + 1]
      if (v === undefined || v.startsWith('--')) return { ok: false, error: `${raw} needs a value` }
      lists.set(name, [...(lists.get(name) ?? []), v])
      i++
      continue
    }
    if (!VALUE_FLAGS.has(name)) return { ok: false, error: `unknown option ${raw}` }
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) return { ok: false, error: `${raw} needs a value` }
    flags.set(name, v)
    i++
  }
  const [command, ...rest] = positionals
  return { ok: true, value: { command, positionals: rest, flags, lists } }
}
