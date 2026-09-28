// Which pins a module joins inside itself (`internal`, transitively): verification uses it to tell a
// pin that is part of a requested net through its own part from an extra connection, and layout
// uses it to wire internally joined pins as one node.
import type { ModuleDef } from '../format/module.ts'

const cache = new WeakMap<ModuleDef, Map<string, string>>()

function components(m: ModuleDef): Map<string, string> {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!
    return r
  }
  for (const g of m.internal ?? [])
    for (let i = 1; i < g.length; i++) {
      const a = find(g[0])
      const b = find(g[i])
      if (a !== b) parent.set(b, a)
    }
  const out = new Map<string, string>()
  for (const g of m.internal ?? []) for (const n of g) out.set(n, find(n))
  return out
}

/** The pin's electrical component inside its part, named by one member; a pin joined to nothing is its own. */
export function internalComponent(m: ModuleDef, name: string): string {
  let map = cache.get(m)
  if (!map) cache.set(m, (map = components(m)))
  return map.get(name) ?? name
}
