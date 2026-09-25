// Validates every file in /modules against the module format. Run in CI: npm run validate
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateModule } from '../src/format/module.ts'

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
