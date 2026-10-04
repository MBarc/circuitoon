// Command-line parsing for the circuitoon CLI: a command, positionals and a fixed set of flags.
// Unknown flags are errors, never guessed.
export interface Args {
  command?: string
  positionals: string[]
  flags: Map<string, string | true>
}

const VALUE_FLAGS = new Set(['--out', '--svg', '--scale', '--focus', '--search', '--keep', '--labels', '--tiles', '--spec'])
const BOOL_FLAGS = new Set(['--json', '--dark', '--help'])
const ALIASES: Record<string, string> = { '-o': '--out', '-h': '--help' }

export function parseArgs(argv: string[]): { ok: true; value: Args } | { ok: false; error: string } {
  const positionals: string[] = []
  const flags = new Map<string, string | true>()
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
    if (!VALUE_FLAGS.has(name)) return { ok: false, error: `unknown option ${raw}` }
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) return { ok: false, error: `${raw} needs a value` }
    flags.set(name, v)
    i++
  }
  const [command, ...rest] = positionals
  return { ok: true, value: { command, positionals: rest, flags } }
}
