// Loaded with --import into the run's child process when it runs from the source tree (the tests):
// the two modules Vite fills at build time (import.meta.glob) become empty, because the child is
// handed the built-in parts and our Python files by its parent. The CLI bundle never needs this.
import { registerHooks } from 'node:module'

const STUBS: Record<string, string> = {
  '/src/library.ts': 'export const library = []; export const modulesById = {}',
  '/src/run/pyFiles.ts': 'export const PY_FILES = {}',
}

registerHooks({
  load(url, context, next) {
    const stub = Object.keys(STUBS).find((s) => url.endsWith(s))
    return stub ? { format: 'module', source: STUBS[stub], shortCircuit: true } : next(url, context)
  },
})
