// The modules and gpiozero names the simulator does not have (firmware spec 5.1), read from the Python
// stand-ins themselves (one entry per line in _circuitoon.py's UNSUPPORTED and gpiozero's
// UNSUPPORTED_NAMES), so the gate's static scan and the run-time errors never disagree.
import { PY_FILES } from './pyFiles.ts'

function dict(text: string, name: string): Record<string, string> {
  const body = new RegExp(`${name} = \\{([\\s\\S]*?)\\n\\}`).exec(text)?.[1] ?? ''
  return Object.fromEntries([...body.matchAll(/'([^']+)': '([^']+)'/g)].map((m) => [m[1], m[2]]))
}

export const UNSUPPORTED_MODULES = dict(PY_FILES['_circuitoon.py'], 'UNSUPPORTED')
export const UNSUPPORTED_GPIOZERO = dict(PY_FILES['gpiozero/__init__.py'], 'UNSUPPORTED_NAMES')

/** What a script uses that the simulator does not have, in the order found, each once. Comments are skipped. */
export function unsupportedImports(source: string): { name: string; why: string }[] {
  const found = new Map<string, string>()
  const gz = (name: string) => name in UNSUPPORTED_GPIOZERO && found.set(`gpiozero.${name}`, `gpiozero.${name} ${UNSUPPORTED_GPIOZERO[name]}`)
  const code = source.replace(/#[^\n]*/g, '')
  // Newlines are allowed only inside parentheses (m[3]); a plain from-import (m[4]) ends at the line.
  for (const m of code.matchAll(/^[ \t]*(?:import[ \t]+([\w., \t]+)|from[ \t]+([\w.]+)[ \t]+import[ \t]+(?:\(([\w., \t\n]+)\)|([\w., \t]+)))/gm)) {
    const mods = m[1] ? m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]) : [m[2]]
    for (const mod of mods) {
      const root = mod.split('.')[0]
      if (root in UNSUPPORTED_MODULES) found.set(root, UNSUPPORTED_MODULES[root])
    }
    if (m[2] === 'gpiozero') for (const n of (m[3] ?? m[4]).split(',')) gz(n.trim().split(/\s+as\s+/)[0])
  }
  for (const m of code.matchAll(/\bgpiozero\.(\w+)/g)) gz(m[1])
  return [...found].map(([name, why]) => ({ name, why }))
}
