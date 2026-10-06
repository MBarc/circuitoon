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
  'pwm-approximate': 'PWM average is approximate',
}

/** An LED is drawn lit above this current (ruling R18). */
export const LIT_AMPS = 1e-4

// Ruling R30 leaves one "not powered" warning per load behind an open switch (ten on a typical
// sheet); all of them for the same switch fold into one, wherever they sit in the list. The JSON
// keeps them all.
const OFF = /^(.+?) is not powered in the current state: (\S+) is open\./

/**
 * The findings with the "not powered: SW1 is open" warnings for each switch folded into one entry,
 * placed where the first of them was (`members` holds them, `message` names them all); every other
 * finding stands alone.
 */
export function foldNotPowered<F extends { severity: string; message: string }>(findings: F[]): { members: F[]; message: string }[] {
  const out: { members: F[]; message: string }[] = []
  const bySwitch = new Map<string, { members: F[]; message: string; loads: string[] }>()
  for (const f of findings) {
    const m = f.severity === 'warning' ? OFF.exec(f.message) : null
    if (!m) { out.push({ members: [f], message: f.message }); continue }
    let g = bySwitch.get(m[2])
    if (!g) {
      g = { members: [], message: f.message, loads: [] }
      bySwitch.set(m[2], g)
      out.push(g)
    }
    g.members.push(f)
    g.loads.push(m[1])
    if (g.members.length > 1) g.message = `not powered in the current state because ${m[2]} is open: ${g.loads.join(', ')}. Set ${m[2]} to its operating position to simulate them running.`
  }
  return out.map(({ members, message }) => ({ members, message }))
}
