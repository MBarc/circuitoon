// What the editor and the CLI show of a simulation, kept apart from the compute code so the editor's
// main bundle can import it (spec 8: the solver, the findings and the engine load lazily). Type
// imports only. Pure.
import type { SimCode } from './results.ts'

export const SIM_TITLES: Record<SimCode, string> = {
  'sim-short': 'Short circuit',
  'sim-source-conflict': 'Supplies fight',
  'sim-over-abs-max': 'Over its absolute maximum',
  'sim-over-limit': 'Over its rating',
  'sim-brownout': 'Not enough voltage',
  'sim-dropout': 'Regulator out of regulation',
  'sim-converter-off': 'Converter off',
  'sim-min-load': 'Below its minimum load',
  'sim-outside-model': 'Outside the model',
  'sim-floating-input': 'Floating input',
  'sim-no-convergence': 'Could not be solved',
  'sim-incomplete': 'Not simulated',
  'sim-estimate': 'Estimates used',
}

/** An LED is drawn lit above this current (ruling R18). */
export const LIT_AMPS = 1e-4

// Ruling R30 leaves one "not powered" warning per load behind an open switch (ten on a typical
// sheet); a run of them for the same switch folds into one. The JSON keeps them all.
const OFF = /^(.+?) is not powered in the current state: (\S+) is open\./

/**
 * The findings with each run of "not powered: SW1 is open" warnings for one switch folded into one
 * entry (`members` holds the run, `message` names them all); every other finding stands alone.
 */
export function foldNotPowered<F extends { severity: string; message: string }>(findings: F[]): { members: F[]; message: string }[] {
  const out: { members: F[]; message: string }[] = []
  for (let i = 0; i < findings.length; i++) {
    const m = findings[i].severity === 'warning' ? OFF.exec(findings[i].message) : null
    const members = [findings[i]]
    const loads = [m?.[1]]
    while (m && i + 1 < findings.length && findings[i + 1].severity === 'warning') {
      const next = OFF.exec(findings[i + 1].message)
      if (next?.[2] !== m[2]) break
      members.push(findings[++i])
      loads.push(next[1])
    }
    out.push({
      members,
      message: m && members.length > 1
        ? `not powered in the current state because ${m[2]} is open: ${loads.join(', ')}. Set ${m[2]} to its operating position to simulate them running.`
        : findings[i].message,
    })
  }
  return out
}
