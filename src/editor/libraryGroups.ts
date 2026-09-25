// Groups library modules by category for the editor's Parts panel.
// Pure and unit-tested so a future category slots in predictably: add it here (in order) and
// it groups correctly the moment a module uses it; leave it out and it still shows up, sorted
// alphabetically after the named categories.

import type { ModuleDef } from '../format/module.ts'

/** Fixed display order for these categories; anything else is appended alphabetically. */
export const CATEGORY_ORDER = ['Batteries', 'Power', 'Microcontrollers', 'Displays', 'Chips', 'Passives', 'Indicators', 'Switches']

const UNCATEGORIZED = 'Uncategorized'

export interface LibraryGroup {
  category: string
  modules: ModuleDef[]
}

/**
 * Buckets modules by `category` (missing category becomes "Uncategorized"), in CATEGORY_ORDER
 * first, then any other categories alphabetically. A category with no modules is left out.
 * Modules within a group are sorted by name.
 */
export function groupLibrary(modules: ModuleDef[]): LibraryGroup[] {
  const byCategory = new Map<string, ModuleDef[]>()
  for (const m of modules) {
    const category = m.category ?? UNCATEGORIZED
    const list = byCategory.get(category)
    if (list) list.push(m)
    else byCategory.set(category, [m])
  }

  const known = CATEGORY_ORDER.filter((c) => byCategory.has(c))
  const rest = [...byCategory.keys()].filter((c) => !CATEGORY_ORDER.includes(c)).sort((a, b) => a.localeCompare(b))

  return [...known, ...rest].map((category) => ({
    category,
    modules: [...byCategory.get(category)!].sort((a, b) => a.name.localeCompare(b.name)),
  }))
}
