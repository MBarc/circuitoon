// A small JSON Schema checker for the CLI's --json outputs: the subset the schemas in
// plugin/skills/circuitoon-design/references/schemas use (type, const, enum, required, properties,
// additionalProperties false, items, and $ref to the schema's own $defs). Test helper.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type Schema = {
  type?: string | string[]
  const?: unknown
  enum?: unknown[]
  required?: string[]
  properties?: Record<string, Schema>
  additionalProperties?: boolean
  items?: Schema
  $ref?: string
  $defs?: Record<string, Schema>
}

export const SCHEMA_DIR = join(import.meta.dirname, '..', '..', 'plugin', 'skills', 'circuitoon-design', 'references', 'schemas')
export const loadSchema = (name: string): Schema => JSON.parse(readFileSync(join(SCHEMA_DIR, `${name}.schema.json`), 'utf8'))

const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v)

export function schemaErrors(s: Schema, v: unknown, at = '$', root: Schema = s): string[] {
  if (s.$ref) {
    const name = /^#\/\$defs\/(.+)$/.exec(s.$ref)?.[1]
    const def = name !== undefined ? root.$defs?.[name] : undefined
    if (!def) return [`${at}: unknown $ref ${s.$ref}`]
    return schemaErrors(def, v, at, root)
  }
  if (s.const !== undefined && JSON.stringify(v) !== JSON.stringify(s.const)) return [`${at}: must be ${JSON.stringify(s.const)}`]
  if (s.enum && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) return [`${at}: must be one of ${JSON.stringify(s.enum)}`]
  if (s.type) {
    const want = Array.isArray(s.type) ? s.type : [s.type]
    const t = typeOf(v)
    if (!want.includes(t) && !(t === 'integer' && want.includes('number'))) return [`${at}: must be ${want.join(' or ')}, got ${t}`]
  }
  const out: string[] = []
  if (typeOf(v) === 'object') {
    const o = v as Record<string, unknown>
    for (const k of s.required ?? []) if (!(k in o)) out.push(`${at}.${k}: required`)
    for (const [k, val] of Object.entries(o)) {
      const sub = s.properties?.[k]
      if (sub) out.push(...schemaErrors(sub, val, `${at}.${k}`, root))
      else if (s.additionalProperties === false) out.push(`${at}.${k}: not allowed`)
    }
  }
  if (Array.isArray(v) && s.items) v.forEach((x, i) => out.push(...schemaErrors(s.items!, x, `${at}[${i}]`, root)))
  return out
}
