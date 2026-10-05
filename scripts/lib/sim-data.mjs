// Sourced electrical.sim patches (ruling R1): scripts/sim-data/<module id>.json, each
// { id, researched, sim, notes, unaccounted, review }. withSim puts a patch's `sim` into a module
// file's JSON as electrical.sim; emit() calls it for every generated module, and gen-sim.mjs for the
// hand-written ones, so a module's simulation data has one source.
import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'

const DIR = new URL('../sim-data/', import.meta.url)

export function simPatch(id, dir = DIR) {
  const f = new URL(`${id}.json`, dir)
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null
}

export function withSim(path, content, dir = DIR) {
  if (!/[\\/]modules[\\/][^\\/]+\.json$/.test(path)) return content
  const patch = simPatch(basename(path, '.json'), dir)
  if (!patch) return content
  const m = JSON.parse(content)
  m.electrical = { ...(m.electrical ?? {}), sim: patch.sim }
  return `${JSON.stringify(m, null, 2)}\n`
}
