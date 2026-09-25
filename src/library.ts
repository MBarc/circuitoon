// Built-in parts: every JSON file in /modules, validated at load. Invalid files are kept
// with their errors so the page shows what is wrong instead of silently dropping them.
import { type ModuleDef, validateModule } from './format/module.ts'

const files = import.meta.glob('../modules/*.json', { eager: true, import: 'default' }) as Record<string, unknown>

export type LibraryEntry = { file: string; raw: unknown } & ({ ok: true; module: ModuleDef } | { ok: false; errors: string[] })

export const library: LibraryEntry[] = Object.entries(files)
  .map(([path, raw]) => ({ file: path.split('/').pop()!, raw, ...validateModule(raw) }))
  .sort((a, b) => a.file.localeCompare(b.file))

export const modulesById: Record<string, ModuleDef> = Object.fromEntries(
  library.flatMap((e) => (e.ok ? [[e.module.id, e.module] as const] : [])),
)
