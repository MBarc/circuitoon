// Validates every file in /modules against the module format. Run in CI: npm run validate
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CUSTOM_PREFIX, validateModule } from '../src/format/module.ts'
import { railProblem, simOf } from '../src/format/simModel.ts'

const dir = join(import.meta.dirname, '..', 'modules')
const ids = new Map<string, string>()
let failed = 0

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  } catch (e) {
    console.error(`FAIL ${file}: not valid JSON (${(e as Error).message})`)
    failed++
    continue
  }
  const r = validateModule(raw)
  if (!r.ok) {
    console.error(`FAIL ${file}:\n  ${r.errors.join('\n  ')}`)
    failed++
    continue
  }
  // The custom- prefix and flag belong to parts made in the part maker, never to the library.
  if (r.module.custom || r.module.id.startsWith(CUSTOM_PREFIX)) {
    console.error(`FAIL ${file}: built-in parts may not be custom or use an id starting with "${CUSTOM_PREFIX}"`)
    failed++
    continue
  }
  // Spec 3.1: a built-in module must state every field its rails need (an embedded one is listed
  // as not simulated instead, by the simulator).
  const incomplete = (simOf(r.module)?.power?.rails ?? []).map(railProblem).filter((x) => x !== null)
  if (incomplete.length) {
    console.error(`FAIL ${file}: electrical.sim: ${incomplete.join('; ')}`)
    failed++
    continue
  }
  if (ids.has(r.module.id)) {
    console.error(`FAIL ${file}: id "${r.module.id}" is already used by ${ids.get(r.module.id)}`)
    failed++
    continue
  }
  ids.set(r.module.id, file)
  console.log(`ok   ${file}`)
}

if (failed) {
  console.error(`\n${failed} module file(s) failed validation`)
  process.exit(1)
}
