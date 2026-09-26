// Test helpers for the built-in parts in modules/: load one validated module, list them all, and
// read its real pins (spacers left out). Shared by the per-family pin-order tests.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isSpacer, validateModule, type ModuleDef, type PinDef } from './module.ts'

export const modulesDir = join(import.meta.dirname, '..', '..', 'modules')

/** Loads and validates modules/<file> (".json" may be left off); throws on a validation error. */
export function load(file: string): ModuleDef {
  const name = file.endsWith('.json') ? file : `${file}.json`
  const r = validateModule(JSON.parse(readFileSync(join(modulesDir, name), 'utf8')))
  if (!r.ok) throw new Error(`${name}: ${r.errors.join('; ')}`)
  return r.module
}

/** Every module file name in modules/, sorted. */
export const moduleFiles = (): string[] => readdirSync(modulesDir).filter((f) => f.endsWith('.json')).sort()

/** The module's pins without spacers, in array order. */
export const pinsOf = (m: ModuleDef): PinDef[] => m.pins.filter((p): p is PinDef => !isSpacer(p))

/** The pin named `name`, or undefined. */
export const pin = (m: ModuleDef, name: string): PinDef | undefined => pinsOf(m).find((p) => p.name === name)
