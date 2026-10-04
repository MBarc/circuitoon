// Netlist-first input (circuitoon-netlist/1, agent toolkit spec section 1): what an agent writes to
// describe a circuit, checked against every contract rule. Nothing is guessed: each violation is an
// error naming its path. Repeated sub-circuits are expanded first (repeat.ts), so every rule here
// also holds for every copy. Pure.
import { type ModuleDef, type PinDef, PARAM_RULES, isBoard, isNetLabel, isObj, isNum, isSpacer, moduleSettings, validParamValue, validateModule } from '../format/module.ts'
import { mainsOf } from '../format/mainsModel.ts'
import { ANNOTATION_LABEL_MAX, ANNOTATION_TEXT_MAX, isValidColor } from '../format/diagram.ts'
import { type EndKind, isEndKind, isUsbEnd } from '../format/cables.ts'
import { type RawNet, type RawPart, type RepeatCopy, endpointText, expandRepeat } from './repeat.ts'

export const NETLIST_FORMAT = 'circuitoon-netlist/1'
/** A part reference: a letter, then letters, digits or underscores. */
export const REF_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/

export type ModuleLookup = (id: string) => ModuleDef | undefined

/** One resolved net endpoint. */
export interface Terminal {
  ref: string
  /** The canonical pin or hole group name (a label is resolved to it). */
  name: string
  /** A hole group of a board (a breadboard strip or rail): infrastructure, not a component pin. */
  infra: boolean
  /** A requested hole of a board hole group; absent means any free hole. */
  hole?: number
}
export interface IntentPart {
  ref: string
  module: string
  values?: Record<string, unknown>
  /** Choices for the module's enumerated settings (`electrical.settings`), such as an OLED's I2C address or a fuse holder's fuse. */
  settings?: Record<string, string>
  /** The board ref this part plugs into. */
  on?: string
}
export interface IntentNet {
  name: string
  terminals: Terminal[]
  color?: string
  /**
   * The agent asks for this net to be drawn with net labels instead of wires (`"label": true`): a
   * named flag at each end, joined by name. Never on a net with a mains terminal. Left out when false.
   */
  label?: true
}
export interface Intent {
  title: string
  parts: IntentPart[]
  nets: IntentNet[]
  nc: Terminal[]
  groups: { name: string; refs: string[] }[]
  notes: { text: string; near: string }[]
  copies: RepeatCopy[]
  /** Every module the parts use, by id, sorted by id. */
  modules: Record<string, ModuleDef>
  /** Used ids defined under `modules` in the netlist: custom, unverified parts. */
  custom: string[]
  ends?: EndKind
}
export type IntentResult = { ok: true; intent: Intent } | { ok: false; errors: string[] }

/** One key per pin or hole group of a part (a hole index never makes a second key). */
export const terminalKey = (ref: string, name: string): string => JSON.stringify([ref, name])

/** "U1 GND", or "BB1 c5-top hole 2". */
export const terminalName = (t: Terminal): string => `${t.ref} ${t.name}${t.hole !== undefined ? ` hole ${t.hole}` : ''}`

/** A part that can plug into a board: not a board, with legs, none of them a bus. */
const mountable = (m: ModuleDef) => !isBoard(m) && m.pins.some((p) => !isSpacer(p)) && !m.pins.some((p) => !isSpacer(p) && p.bus)

function valueErrors(values: Record<string, unknown>, at: string): string[] {
  const out: string[] = []
  for (const [key, entry] of Object.entries(values)) {
    if (!Object.hasOwn(PARAM_RULES, key)) continue
    const rule = PARAM_RULES[key]
    if (!(isObj(entry) && isNum(entry.value) && entry.unit === rule.unit && validParamValue(key, entry.value)))
      out.push(`${at}.${key}: must be { "value": <number>, "unit": "${rule.unit}" } within ${rule.range}`)
  }
  return out
}

type PinResult = { ok: true; t: Terminal } | { ok: false; error: string }

/** A pin by exact name (pins and hole groups share one namespace), else by a label exactly one of them has. */
function byName(m: ModuleDef, ref: string, pin: string, at: string): PinResult {
  const pins = m.pins.filter((p): p is PinDef => !isSpacer(p))
  const groups = m.holes ?? []
  if (pins.some((p) => p.name === pin)) return { ok: true, t: { ref, name: pin, infra: false } }
  if (groups.some((g) => g.name === pin)) return { ok: true, t: { ref, name: pin, infra: isBoard(m) } }
  const labelled = [...pins.filter((p) => p.label === pin).map((p) => p.name), ...groups.filter((g) => g.label === pin).map((g) => g.name)]
  if (labelled.length === 1) return { ok: true, t: { ref, name: labelled[0], infra: isBoard(m) && groups.some((g) => g.name === labelled[0]) } }
  if (labelled.length > 1) return { ok: false, error: `${at}: "${pin}" is the label of ${labelled.length} pins on ${ref} (${labelled.join(', ')}); name one of them` }
  return { ok: false, error: `${at}: ${ref} (${m.id}) has no pin or label "${pin}"` }
}

export function parseNetlist(raw: unknown, library: ModuleLookup): IntentResult {
  const errors: string[] = []
  if (!isObj(raw)) return { ok: false, errors: ['netlist must be a JSON object'] }
  if (raw.format === undefined) errors.push(`format: missing (expected "${NETLIST_FORMAT}")`)
  else if (raw.format !== NETLIST_FORMAT) errors.push(`format: unsupported "${String(raw.format)}" (expected "${NETLIST_FORMAT}")`)
  if (typeof raw.title !== 'string' || raw.title.trim() === '') errors.push('title: required')

  // Embedded modules: validated like library modules, under ids of their own.
  const embedded = new Map<string, ModuleDef>()
  if (raw.modules !== undefined) {
    if (!isObj(raw.modules)) errors.push('modules: must be an object of module definitions by id')
    else
      for (const [key, m] of Object.entries(raw.modules)) {
        const r = validateModule(m)
        if (!r.ok) errors.push(...r.errors.map((e) => `modules.${key}: ${e}`))
        else if (r.module.id !== key) errors.push(`modules.${key}: id "${r.module.id}" does not match its key`)
        else if (library(key)) errors.push(`modules.${key}: "${key}" is a built-in part; give the embedded module its own id`)
        else embedded.set(key, r.module)
      }
  }
  const lookup = (id: string) => embedded.get(id) ?? library(id)
  if (!Array.isArray(raw.parts)) errors.push('parts: required list')
  if (!Array.isArray(raw.nets)) errors.push('nets: required list')
  if (!Array.isArray(raw.parts) || !Array.isArray(raw.nets)) return { ok: false, errors }
  const topParts = raw.parts
  const topNets = raw.nets

  // Repeats add parts, nets, and pins to the outside nets their shared ports join.
  const topRefs = new Set(topParts.flatMap((p) => (isObj(p) && typeof p.ref === 'string' ? [p.ref] : [])))
  const topNetNames = topNets.flatMap((n) => (isObj(n) && typeof n.name === 'string' ? [n.name] : []))
  const rep = raw.repeat === undefined ? null : expandRepeat(raw.repeat, topRefs, topNetNames)
  const rawParts: RawPart[] = [...topParts.map((p, i) => ({ p, at: `parts[${i}]` })), ...(rep?.parts ?? [])]

  const parts: IntentPart[] = []
  const byRef = new Map<string, { part: IntentPart; module: ModuleDef; at: string }>()
  const used = new Map<string, ModuleDef>()
  for (const { p, at } of rawParts) {
    if (!isObj(p)) {
      errors.push(`${at}: must be an object`)
      continue
    }
    const ref = p.ref
    if (typeof ref !== 'string' || !REF_PATTERN.test(ref)) {
      errors.push(`${at}.ref: required, a letter then letters, digits or _ (for example "R1")`)
      continue
    }
    if (byRef.has(ref)) {
      errors.push(`${at}.ref: duplicate "${ref}"`)
      continue
    }
    if (typeof p.module !== 'string') {
      errors.push(`${at}.module: required`)
      continue
    }
    const m = lookup(p.module)
    if (!m) {
      errors.push(`${at}.module: no built-in or embedded module "${p.module}"`)
      continue
    }
    if (isNetLabel(m)) {
      errors.push(`${at}.module: ${p.module} is not a part; to draw a net with labels, set "label": true on the net`)
      continue
    }
    const part: IntentPart = { ref, module: p.module }
    if (p.values !== undefined) {
      if (!isObj(p.values)) errors.push(`${at}.values: must be an object`)
      else {
        errors.push(...valueErrors(p.values, `${at}.values`))
        part.values = p.values
      }
    }
    if (p.settings !== undefined) {
      if (!isObj(p.settings)) errors.push(`${at}.settings: must be an object of setting name to choice`)
      else {
        const offered = moduleSettings(m)
        const names = Object.keys(offered)
        let ok = true
        for (const [key, choice] of Object.entries(p.settings)) {
          if (!Object.hasOwn(offered, key)) {
            ok = false
            errors.push(`${at}.settings.${key}: ${m.id} has no setting "${key}"${names.length ? ` (it has ${names.join(', ')})` : ' (it has none)'}`)
          } else if (typeof choice !== 'string' || !offered[key].includes(choice)) {
            ok = false
            errors.push(`${at}.settings.${key}: must be one of ${offered[key].map((c) => JSON.stringify(c)).join(', ')}`)
          }
        }
        if (ok && Object.keys(p.settings).length) part.settings = p.settings as Record<string, string>
      }
    }
    if (p.on !== undefined) {
      if (typeof p.on !== 'string') errors.push(`${at}.on: must be the ref of a breadboard or rail strip`)
      else part.on = p.on
    }
    parts.push(part)
    byRef.set(ref, { part, module: m, at })
    used.set(p.module, m)
  }
  for (const { part, module, at } of byRef.values()) {
    if (part.on === undefined) continue
    const board = byRef.get(part.on)
    if (!board) errors.push(`${at}.on: no part "${part.on}"`)
    else if (!isBoard(board.module)) errors.push(`${at}.on: ${part.on} (${board.module.id}) is not a breadboard or rail strip`)
    else if (!mountable(module)) errors.push(`${at}.on: ${part.ref} (${module.id}) cannot plug into a board (it is a board, has a bus pin or has no legs)`)
  }

  const resolve = (ep: unknown, at: string): Terminal | null => {
    let ref: unknown
    let pin: unknown
    let group: unknown
    let hole: unknown
    if (typeof ep === 'string') {
      const dot = ep.indexOf('.')
      if (dot < 1) {
        errors.push(`${at}: "${ep}" must be "REF.PIN"`)
        return null
      }
      ref = ep.slice(0, dot)
      pin = ep.slice(dot + 1)
    } else if (isObj(ep)) ({ ref, pin, group, hole } = ep)
    else {
      errors.push(`${at}: must be "REF.PIN", { "ref", "pin" } or { "ref", "group", "hole" }`)
      return null
    }
    const hit = typeof ref === 'string' ? byRef.get(ref) : undefined
    if (!hit) {
      errors.push(`${at}: no part "${String(ref)}"`)
      return null
    }
    const r = ref as string
    const m = hit.module
    if (group !== undefined) {
      const g = typeof group === 'string' ? m.holes?.find((h) => h.name === group) : undefined
      if (!g) {
        errors.push(`${at}: ${r} (${m.id}) has no hole group "${String(group)}"`)
        return null
      }
      if (hole !== undefined && !(Number.isInteger(hole) && (hole as number) >= 0 && (hole as number) < g.at.length)) {
        errors.push(`${at}.hole: ${r} ${g.name} has holes 0 to ${g.at.length - 1}`)
        return null
      }
      return { ref: r, name: g.name, infra: isBoard(m), ...(hole !== undefined ? { hole: hole as number } : {}) }
    }
    if (typeof pin !== 'string' || pin === '') {
      errors.push(`${at}: pin required`)
      return null
    }
    const res = byName(m, r, pin, at)
    if (!res.ok) {
      errors.push(res.error)
      return null
    }
    return res.t
  }

  // Nets: the top-level ones (with the copy pins their shared ports bring), then the copies' own.
  const rawNets: RawNet[] = []
  topNets.forEach((n, i) => {
    const at = `nets[${i}]`
    if (!isObj(n) || !Array.isArray(n.pins)) return void errors.push(`${at}: must be { "name", "pins": [...] }`)
    const extra = typeof n.name === 'string' ? (rep?.shared.get(n.name) ?? []) : []
    rawNets.push({ name: n.name, at, pins: [...n.pins.map((ep, j) => ({ ep, at: `${at}.pins[${j}]` })), ...extra], ...(n.label !== undefined ? { label: n.label } : {}) })
  })
  rawNets.push(...(rep?.nets ?? []))
  const nets: IntentNet[] = []
  const inNet = new Map<string, string>()
  // The binding (and its text) that first took each endpoint, so reuse is caught after labels resolve.
  const boundAs = new Map<string, { binding: string; text: string | null }>()
  for (const { name, pins, at, label } of rawNets) {
    if (typeof name !== 'string' || name === '') {
      errors.push(`${at}.name: required`)
      continue
    }
    if (nets.some((x) => x.name === name)) {
      errors.push(`${at}.name: duplicate net "${name}"`)
      continue
    }
    const terminals: Terminal[] = []
    for (const { ep, at: pat, binding } of pins) {
      const t = resolve(ep, pat)
      if (!t) continue
      const key = terminalKey(t.ref, t.name)
      const other = inNet.get(key)
      const prior = boundAs.get(key)
      if (other !== undefined && binding !== undefined && prior !== undefined) {
        // Two copies bound to one endpoint. The same text was already reported by expandRepeat;
        // a label and the pin name it resolves to are only caught here.
        const text = endpointText(ep)
        if (text !== prior.text) errors.push(`${pat}: ${text} is already bound by ${prior.binding} (${terminalName({ ...t, hole: undefined })})`)
        continue
      }
      if (other !== undefined) {
        errors.push(`${pat}: ${terminalName({ ...t, hole: undefined })} is already in net "${other}"`)
        continue
      }
      inNet.set(key, name)
      if (binding !== undefined) boundAs.set(key, { binding, text: endpointText(ep) })
      terminals.push(t)
    }
    if (terminals.length < 2) errors.push(`${at}.pins: a net joins at least 2 pins`)
    // A label never stands in for mains wiring: mains is drawn as real cable, so it can be checked.
    let labelled = false
    if (label !== undefined) {
      if (typeof label !== 'boolean') errors.push(`${at}.label: must be true or false`)
      else if (label) {
        const hot = terminals.find((t) => {
          const m = byRef.get(t.ref)?.module
          return !!m && mainsOf(m).terminals.has(t.name)
        })
        if (hot) errors.push(`${at}.label: net ${name} joins mains terminal ${terminalName({ ...hot, hole: undefined })}; mains is always drawn as wires, never as labels`)
        else labelled = true
      }
    }
    nets.push({ name, terminals, ...(labelled ? { label: true as const } : {}) })
  }
  if (rep) errors.push(...rep.errors)

  const nc: Terminal[] = []
  if (raw.nc !== undefined) {
    if (!Array.isArray(raw.nc)) errors.push('nc: must be a list of pins')
    else
      raw.nc.forEach((ep, i) => {
        const t = resolve(ep, `nc[${i}]`)
        if (!t) return
        if (t.infra) return void errors.push(`nc[${i}]: ${terminalName(t)} is a breadboard hole group, not a pin`)
        const net = inNet.get(terminalKey(t.ref, t.name))
        if (net !== undefined) return void errors.push(`nc[${i}]: ${terminalName(t)} is in net "${net}", so it cannot be not connected`)
        nc.push(t)
      })
  }

  const groups: { name: string; refs: string[] }[] = []
  const groupOf = new Map<string, string>()
  if (raw.groups !== undefined) {
    if (!Array.isArray(raw.groups)) errors.push('groups: must be a list of { "name", "parts" }')
    else
      raw.groups.forEach((g, i) => {
        const at = `groups[${i}]`
        if (!isObj(g) || typeof g.name !== 'string' || g.name === '' || !Array.isArray(g.parts)) return void errors.push(`${at}: must be { "name", "parts": [refs] }`)
        const gname = g.name
        if (gname.length > ANNOTATION_LABEL_MAX) return void errors.push(`${at}.name: at most ${ANNOTATION_LABEL_MAX} characters`)
        if (groups.some((x) => x.name === gname)) return void errors.push(`${at}.name: duplicate group "${gname}"`)
        const refs: string[] = []
        g.parts.forEach((r, j) => {
          if (typeof r !== 'string' || !byRef.has(r)) return void errors.push(`${at}.parts[${j}]: no part "${String(r)}"`)
          const other = groupOf.get(r)
          if (other !== undefined) return void errors.push(`${at}.parts[${j}]: ${r} is already in group "${other}"`)
          groupOf.set(r, gname)
          refs.push(r)
        })
        groups.push({ name: gname, refs })
      })
  }

  const notes: { text: string; near: string }[] = []
  if (raw.notes !== undefined) {
    if (!Array.isArray(raw.notes)) errors.push('notes: must be a list of { "text", "near" }')
    else
      raw.notes.forEach((n, i) => {
        const at = `notes[${i}]`
        if (!isObj(n) || typeof n.text !== 'string' || n.text.trim() === '') return void errors.push(`${at}.text: required`)
        if (n.text.length > ANNOTATION_TEXT_MAX) return void errors.push(`${at}.text: at most ${ANNOTATION_TEXT_MAX} characters`)
        const near = n.near
        if (typeof near !== 'string' || !(byRef.has(near) || groups.some((g) => g.name === near))) return void errors.push(`${at}.near: must name a part ref or a group`)
        notes.push({ text: n.text, near })
      })
  }

  let ends: EndKind | undefined
  if (raw.wires !== undefined) {
    if (!isObj(raw.wires)) errors.push('wires: must be { "color": { NET: color }, "ends": kind }')
    else {
      const { color, ends: kind } = raw.wires
      if (color !== undefined) {
        if (!isObj(color)) errors.push('wires.color: must map net names to colors')
        else
          for (const [net, c] of Object.entries(color)) {
            const target = nets.find((x) => x.name === net)
            if (!target) errors.push(`wires.color.${net}: no net "${net}"`)
            else if (typeof c !== 'string' || !isValidColor(c)) errors.push(`wires.color.${net}: must be a named color or #RRGGBB`)
            else target.color = c
          }
      }
      if (kind !== undefined) {
        if (!isEndKind(kind)) errors.push(`wires.ends: unknown cable end ${JSON.stringify(kind)}`)
        // A USB link gets the cable that fits its two ports from the layout; USB plugs on every wire mean nothing.
        else if (isUsbEnd(kind)) errors.push(`wires.ends: ${JSON.stringify(kind)} is a USB plug: a net of two USB ports gets its USB cable from the layout, so leave it out here`)
        else ends = kind
      }
    }
  }

  if (errors.length) return { ok: false, errors }
  const ids = [...used.keys()].sort()
  return {
    ok: true,
    intent: {
      title: raw.title as string,
      parts,
      nets,
      nc,
      groups,
      notes,
      copies: rep?.copies ?? [],
      modules: Object.fromEntries(ids.map((id) => [id, used.get(id)!])),
      custom: ids.filter((id) => embedded.has(id)),
      ...(ends ? { ends } : {}),
    },
  }
}
