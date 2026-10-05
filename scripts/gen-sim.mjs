// Applies every sourced simulation patch (scripts/sim-data/*.json, ruling R1) to its module file.
// For a hand-written module this is the only writer; a generated module gets the same patch from
// emit() in its own generator, so the two agree. Run from the repo root: node scripts/gen-sim.mjs
// (add --check to compare without writing; npm run check:gen runs it that way).
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { emit, finish, log } from './lib/gen-output.mjs'

const dir = fileURLToPath(new URL('./sim-data/', import.meta.url))
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const id = f.slice(0, -'.json'.length)
  const path = fileURLToPath(new URL(`../modules/${id}.json`, import.meta.url))
  const m = JSON.parse(readFileSync(path, 'utf8'))
  if (m.electrical) delete m.electrical.sim
  emit(path, `${JSON.stringify(m, null, 2)}\n`)
  log(`${id}.json`, 'electrical.sim from scripts/sim-data')
}
finish('gen-sim.mjs')
