// What simulating draws on the sheet (spec 6.3): each LED's glow from its current (log scale, full
// at its current limit, in its colour) with the current as a text tag, an LED over its absolute
// maximum drawn dark red with a warning ring (never "burnt"), and the simulation's finding badges
// (the checker's SeverityMark, centred above a part; the checker lights its own at the top
// left), with a ring on each pin a finding names. Static, so reduced motion needs nothing more.
// A running board wears a "running" pill at its top right (red "error" when an exception stopped it), and a servo's
// horn is drawn at its angle (with reduced motion it jumps to the target).
// Stale readings (the last good result while a solve fails) are dimmed and say so.
// Imports from src/sim are types and display.ts only: the compute code stays in the lazy chunk.
import { memo } from 'react'
import { type Diagram, moduleOf, resolveEndpoint } from '../format/diagram.ts'
import { bodyRect } from '../format/geometry.ts'
import { isObj, layoutModule } from '../format/module.ts'
import { formatValue } from '../format/values.ts'
import { LIT_AMPS } from '../sim/display.ts'
import type { Circuit } from '../sim/model.ts'
import type { SimFinding, SimOutcome, SimResult } from '../sim/results.ts'
import { captionBox } from '../render/captionBox.ts'
import { SeverityMark } from './SeverityMark.tsx'
import type { RunView } from './store.ts'

/** Glow colours by `values.color`; an unknown colour glows red, the LED module's default. */
export const LED_GLOW: Record<string, string> = { red: '#FF3B30', green: '#34D158', yellow: '#FFD60A', orange: '#FF9F0A', blue: '#3A8DFF', white: '#FFFFFF' }
/** The current limit an LED with none resolved glows full at (the LED module's maxCurrent default). */
const DEFAULT_LIMIT = 0.02

/** Brightness 0 to 1: dark at LIT_AMPS and below, full at `limit`, log-scaled between (spec 6.3). */
export function glowLevel(amps: number, limit: number): number {
  if (amps <= LIT_AMPS) return 0
  if (limit <= LIT_AMPS) return 1
  return Math.min(1, Math.log10(amps / LIT_AMPS) / Math.log10(limit / LIT_AMPS))
}

/** The result to draw: the live one, or the last good one (stale) after a failed solve; none otherwise. */
export function shownResult(o: SimOutcome | undefined): { result: SimResult; stale: boolean } | null {
  if (!o) return null
  if (o.status === 'ok') return { result: o.result, stale: false }
  if (o.status === 'failed' && o.lastGood) return { result: o.lastGood.result, stale: true }
  return null
}

/**
 * The findings that describe the current state: the live result's, or after a failed solve the
 * failure and the findings decided before solving (an unavailable engine: those alone).
 */
export function currentFindings(o: SimOutcome | undefined): SimFinding[] {
  if (!o) return []
  if (o.status === 'ok') return o.result.findings
  return o.status === 'failed' ? [o.finding, ...o.findings] : o.findings
}

// Three significant figures, as the findings' messages give them.
const amps = (a: number) => formatValue(Number(a.toPrecision(3)), 'A')

/** Ruling R14: a pill at the body's top-right corner (the checker's mark owns the top left, simulation findings the top centre). */
export function runBadges(d: Diagram, run: RunView): { uid: string; kind: 'running' | 'error'; x: number; y: number }[] {
  return Object.entries(run.boards).flatMap(([uid, b]) => {
    const kind = b.status === 'running' || b.status === 'starting' ? 'running' : b.status === 'error' ? 'error' : null
    const p = d.parts.find((x) => x.uid === uid)
    const m = p && moduleOf(d, p.module)
    if (!kind || !p || !m) return []
    const box = bodyRect(p, layoutModule(m))
    return [{ uid, kind, x: box.x + box.w - 62, y: box.y - 10 }]
  })
}

/** A servo horn from the pivot at `angle` degrees: 0 points left, 90 up, 180 right. */
export function hornPath(cx: number, cy: number, r: number, angle: number): string {
  const a = Math.PI - (angle * Math.PI) / 180
  const f = (x: number) => Number(x.toFixed(2))
  return `M${f(cx)} ${f(cy)} L${f(cx + r * Math.cos(a))} ${f(cy - r * Math.sin(a))}`
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * `result` draws the glow (the last good one, dimmed, while `stale`); `findings` draws the badges,
 * the current state's (currentFindings), so a failed solve still badges what it found.
 */
export const SimLayer = memo(function SimLayer({ diagram, result, stale, circuit, findings, run }: { diagram: Diagram; result: SimResult | null; stale: boolean; circuit: Circuit | null; findings: SimFinding[]; run: RunView }) {
  const staleWord = stale ? ' (stale, from before your last edit)' : ''
  const leds = diagram.parts.flatMap((p) => {
    const r = result?.corners.typical.parts[p.uid]
    const m = moduleOf(diagram, p.module)
    if (!r?.state || !m) return []
    // The current into the anode: the one pin current that flows in.
    const into = Math.max(0, ...Object.values(r.pins).map((x) => (x.kind === 'value' ? x.value : 0)))
    const lit = r.state === 'lit' ? into : 0
    const limit = circuit?.limits.find((l) => l.part === p.uid && l.kind === 'current')?.value.value ?? DEFAULT_LIMIT
    // The colour as the simulation reads it (build.ts): the part's value, else the module's default.
    const e = m.electrical
    const color = isObj(e) && isObj(e.params) ? e.params.color : undefined
    const fallback = isObj(color) ? color.default : undefined
    const named = String(typeof p.values?.color === 'string' ? p.values.color : typeof fallback === 'string' ? fallback : 'red').toLowerCase()
    const over = result!.findings.some((f) => f.code === 'sim-over-abs-max' && f.severity !== 'note' && f.parts.includes(p.uid))
    const box = bodyRect(p, layoutModule(m))
    // The current tag sits under the part's caption, never over it.
    const cap = captionBox(p, m)
    const tagY = Math.max(box.y + box.h, cap.y + cap.h) + 3
    return [{ p, box, tagY, amps: lit, level: glowLevel(lit, limit), colour: Object.hasOwn(LED_GLOW, named) ? named : 'red', over }]
  })
  // One badge per part, at the first part a finding names, carrying every part those findings name.
  const byPart = new Map<string, { severity: 'error' | 'warning'; messages: string[]; parts: Set<string> }>()
  const pins: { part: string; pin: string; severity: 'error' | 'warning' }[] = []
  for (const f of findings) {
    if (f.severity === 'note' || !f.parts.length) continue
    const at = byPart.get(f.parts[0]) ?? { severity: f.severity, messages: [], parts: new Set<string>() }
    if (f.severity === 'error') at.severity = 'error'
    at.messages.push(f.message)
    for (const uid of f.parts) at.parts.add(uid)
    byPart.set(f.parts[0], at)
    for (const pin of f.pins ?? []) pins.push({ ...pin, severity: f.severity })
  }
  return (
    <g className="sim-layer">
      <defs>
        {Object.entries(LED_GLOW).map(([name, c]) => (
          <radialGradient key={name} id={`sim-glow-${name}`}>
            <stop offset="0" stopColor={c} stopOpacity={0.9} />
            <stop offset="0.35" stopColor={c} stopOpacity={0.6} />
            {/* White on light paper: a soft grey edge so the glow still reads. */}
            {name === 'white' && <stop offset="0.7" stopColor="#7C8794" stopOpacity={0.35} />}
            <stop offset="1" stopColor={name === 'white' ? '#7C8794' : c} stopOpacity={0} />
          </radialGradient>
        ))}
      </defs>
      <g className={stale ? 'sim-readings stale' : 'sim-readings'} data-sim-stale={stale || undefined} pointerEvents="none">
        {leds.map(({ p, box, tagY, amps: a, level, colour, over }) => {
          const cx = box.x + box.w / 2
          const cy = box.y + box.h / 2
          const r = Math.min(box.w, box.h) / 2
          const reading = over ? `${amps(a)}, over max` : level > 0 ? amps(a) : 'dark'
          const tagW = reading.length * 4.9 + 10
          return (
            <g key={p.uid} className={over ? 'sim-led over' : 'sim-led'} data-sim-led={p.uid} data-sim-level={level.toFixed(2)}>
              <title>{`${p.designator}: ${over ? `${amps(a)}, over its absolute maximum` : level > 0 ? `lit, ${amps(a)}` : 'dark'}${staleWord}`}</title>
              {over ? (
                <>
                  <circle cx={cx} cy={cy} r={r * 0.55} fill="#5A1010" opacity={0.9} />
                  <rect className="sim-ring" x={box.x - 5} y={box.y - 5} width={box.w + 10} height={box.h + 10} rx={8} />
                </>
              ) : (
                level > 0 && <circle className="sim-glow" cx={cx} cy={cy} r={r * (1 + 1.4 * level)} fill={`url(#sim-glow-${colour})`} opacity={0.35 + 0.65 * level} />
              )}
              {/* An unlit LED says so quietly (text, not colour alone); a reading gets a sticker tag. */}
              <g className={level > 0 || over ? 'sim-tag' : 'sim-tag quiet'}>
                {(level > 0 || over) && <rect x={cx - tagW / 2} y={tagY} width={tagW} height={13} rx={4} />}
                <text x={cx} y={tagY + 6.5} textAnchor="middle" dominantBaseline="central">{reading}</text>
              </g>
            </g>
          )
        })}
      </g>
      <g pointerEvents="none">
        {pins.map(({ part, pin, severity }) => {
          const at = resolveEndpoint(diagram, { part, pin })
          return at ? <circle key={`${part}/${pin}`} className={`sim-pin ${severity}`} cx={at.end.x} cy={at.end.y} r={6.5} /> : null
        })}
      </g>
      {[...byPart].map(([uid, b]) => {
        const p = diagram.parts.find((x) => x.uid === uid)
        const m = p && moduleOf(diagram, p.module)
        if (!p || !m) return null
        const box = bodyRect(p, layoutModule(m))
        return (
          <g key={uid} className="sim-badge" data-sim-badge={[...b.parts].join(' ')}>
            <title>{`Simulation: ${b.messages.join('\n')}`}</title>
            {/* Centred above the body, clear of the side pins' wire ends and the checker's top-left mark. */}
            <SeverityMark severity={b.severity} at={{ x: box.x + box.w / 2 - 9, y: box.y - 20, size: 18 }} />
          </g>
        )
      })}
      {runBadges(diagram, run).map((b) => (
        <g key={`run-${b.uid}`} className={`run-badge ${b.kind}`} data-run-badge={b.uid} pointerEvents="none">
          <rect x={b.x} y={b.y} width={60} height={18} rx={9} />
          <text x={b.x + 30} y={b.y + 9} textAnchor="middle" dominantBaseline="central">{b.kind === 'running' ? 'running' : 'error'}</text>
        </g>
      ))}
      {Object.entries(run.servos).map(([uid, s]) => {
        const p = diagram.parts.find((x) => x.uid === uid)
        const m = p && moduleOf(diagram, p.module)
        if (!p || !m) return null
        const box = bodyRect(p, layoutModule(m))
        const cx = box.x + box.w / 2
        const cy = box.y + box.h / 2
        const r = Math.min(box.w, box.h) * 0.42
        return (
          <g key={`horn-${uid}`} className="servo-horn" data-servo-horn={uid} data-angle={s.angle.toFixed(1)} pointerEvents="none">
            <title>{`${p.designator} at ${Math.round(s.angle)} degrees`}</title>
            <path d={hornPath(cx, cy, r, reducedMotion() ? s.target : s.angle)} />
            <circle cx={cx} cy={cy} r={4} />
          </g>
        )
      })}
    </g>
  )
})
