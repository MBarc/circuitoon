// The gate's code checks (firmware spec 7): code a board does not accept is an error (`code-language`);
// a module or gpiozero name the simulator does not have is a warning (`code-unsupported-import`), from
// a static scan. The gate never runs code.
import type { Diagram } from '../format/diagram.ts'
import { languageMismatch } from '../format/code.ts'
import { withLibraryData } from '../format/simModel.ts'
import type { ModuleLookup } from '../agent/netlist.ts'
import { unsupportedImports } from '../run/unsupported.ts'
import type { CliFinding } from './verifyCmd.ts'

export function codeFindings(d: Diagram, library: ModuleLookup): CliFinding[] {
  const out: CliFinding[] = []
  for (const p of d.parts) {
    if (!p.code) continue
    const stored = d.modules[p.module]
    const m = stored && withLibraryData(stored, library)
    const lang = p.code.language
    const mismatch = m ? languageMismatch(p.designator, m, lang) : null
    if (mismatch) out.push({ id: `code-language|${p.uid}`, rule: 'code-language', severity: 'error', parts: [p.uid], pins: [], wires: [], message: `${mismatch}.` })
    if (lang === 'python-rpi')
      for (const u of unsupportedImports(p.code.source))
        out.push({ id: `code-unsupported-import|${p.uid}|${u.name}`, rule: 'code-unsupported-import', severity: 'warning', parts: [p.uid], pins: [], wires: [], message: `${p.designator}'s code: ${u.why}.` })
  }
  return out
}
