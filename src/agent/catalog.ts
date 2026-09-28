// The built-in parts as a lookup, for the netlist parser, layout and verification. The catalog is
// src/library.ts (import.meta.glob over modules/), which Vite resolves at build time for the site
// and for the CLI bundle alike.
import { modulesById } from '../library.ts'
import type { ModuleLookup } from './netlist.ts'

export const libraryLookup: ModuleLookup = (id) => (Object.hasOwn(modulesById, id) ? modulesById[id] : undefined)
