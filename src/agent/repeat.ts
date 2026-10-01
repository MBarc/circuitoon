// Repeated sub-circuits (agent toolkit spec 1.1): `count` copies of a template, each copy's
// non-shared ports bound to its own outside endpoint and its shared ports joined to one outside
// net. Expands to plain parts and nets for the netlist parser, so every netlist rule also holds for
// every copy; this file checks only what is particular to repeats (bindings, refs). Pure.
import { isObj } from '../format/module.ts'

export interface RawPin {
  ep: unknown
  /** Where the endpoint came from, for error messages. */
  at: string
  /** Set on a copy's binding endpoint: which binding it is ("copy 2 port SIG"), for reuse checks after pin resolution. */
  binding?: string
}
export interface RawPart {
  p: unknown
  at: string
}
export interface RawNet {
  name: unknown
  pins: RawPin[]
  at: string
  /** The net's `label` request, unvalidated (parseNetlist checks it). */
  label?: unknown
}
export interface RepeatCopy {
  /** `<repeat name>_<copy>`: what `render --focus` and the channel table call the copy. */
  id: string
  repeat: string
  index: number
  refs: string[]
  /** Port to the outside endpoint it is bound to, as text ("U2.GPA0"). */
  bindings: Record<string, string>
}
export interface RepeatExpansion {
  parts: RawPart[]
  /** One net per copy per template net that is not a shared port. */
  nets: RawNet[]
  /** Outside net name to the copy pins joined to it through shared ports. */
  shared: Map<string, RawPin[]>
  copies: RepeatCopy[]
  errors: string[]
}

export const REPEAT_MAX = 500
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/

/** An endpoint as text, for binding reuse checks and the channel table: "U2.GPA0", "BB1.c5-top hole 2". */
export function endpointText(ep: unknown): string | null {
  if (typeof ep === 'string') return ep
  if (!isObj(ep) || typeof ep.ref !== 'string') return null
  if (typeof ep.pin === 'string') return `${ep.ref}.${ep.pin}`
  if (typeof ep.group === 'string') return `${ep.ref}.${ep.group}${ep.hole !== undefined ? ` hole ${String(ep.hole)}` : ''}`
  return null
}

/** A template endpoint with its ref renamed for one copy ("SA.1" in copy 3 is "SA_3.1"). */
function renameEndpoint(ep: unknown, rename: (ref: string) => string): unknown {
  if (typeof ep === 'string') {
    const dot = ep.indexOf('.')
    return dot < 1 ? ep : `${rename(ep.slice(0, dot))}${ep.slice(dot)}`
  }
  if (isObj(ep) && typeof ep.ref === 'string') return { ...ep, ref: rename(ep.ref) }
  return ep
}

export function expandRepeat(raw: unknown, topRefs: Set<string>, topNets: string[]): RepeatExpansion {
  const out: RepeatExpansion = { parts: [], nets: [], shared: new Map(), copies: [], errors: [] }
  const fail = (e: string) => {
    out.errors.push(e)
    return out
  }
  if (!isObj(raw)) return fail('repeat: must be { "name", "count", "template", "bindings", "shared" }')
  const { name, count, template, bindings } = raw
  if (typeof name !== 'string' || !NAME.test(name)) return fail('repeat.name: required, a letter then letters, digits or _')
  if (!(Number.isInteger(count) && (count as number) >= 1 && (count as number) <= REPEAT_MAX))
    return fail(`repeat.count: must be a whole number from 1 to ${REPEAT_MAX}`)
  const n = count as number
  if (!isObj(template) || !Array.isArray(template.parts) || !Array.isArray(template.nets) || !Array.isArray(template.ports))
    return fail('repeat.template: must be { "parts", "nets", "ports" }')
  const shared = raw.shared ?? {}
  if (!isObj(shared)) return fail('repeat.shared: must map a port to an outside net name')
  const tParts = template.parts
  const tNets = template.nets
  const tRefs = tParts.flatMap((p) => (isObj(p) && typeof p.ref === 'string' ? [p.ref] : []))
  const netNames = tNets.flatMap((x) => (isObj(x) && typeof x.name === 'string' ? [x.name] : []))
  const ports = template.ports.filter((p): p is string => typeof p === 'string')
  template.ports.forEach((p, i) => {
    if (typeof p !== 'string' || !netNames.includes(p)) out.errors.push(`repeat.template.ports[${i}]: must name a template net`)
  })
  for (const [port, net] of Object.entries(shared)) {
    if (!ports.includes(port)) out.errors.push(`repeat.shared.${port}: not a template port`)
    else if (typeof net !== 'string' || !topNets.includes(net)) out.errors.push(`repeat.shared.${port}: no outside net "${String(net)}"`)
  }
  const bound = ports.filter((p) => !Object.hasOwn(shared, p))
  if (!Array.isArray(bindings) || bindings.length !== n) return fail(`repeat.bindings: must list ${n} entries, one per copy`)
  const pattern = raw.refs ?? '{ref}_{copy}'
  if (typeof pattern !== 'string' || !pattern.includes('{ref}') || !pattern.includes('{copy}'))
    return fail('repeat.refs: must contain {ref} and {copy}, for example "{ref}_{copy}"')

  const seenRefs = new Set(topRefs)
  const boundBy = new Map<string, string>()
  for (let k = 1; k <= n; k++) {
    const rename = (ref: string) => pattern.replaceAll('{ref}', ref).replaceAll('{copy}', String(k))
    const refs: string[] = []
    tParts.forEach((p, i) => {
      const at = `repeat.template.parts[${i}]`
      if (!isObj(p) || typeof p.ref !== 'string') {
        if (k === 1) out.errors.push(`${at}.ref: required`)
        return
      }
      if (p.on !== undefined) {
        if (k === 1) out.errors.push(`${at}.on: a repeated part cannot be mounted`)
        return
      }
      const ref = rename(p.ref)
      if (seenRefs.has(ref)) return void out.errors.push(`${at}.ref: copy ${k} ref "${ref}" collides with another part`)
      seenRefs.add(ref)
      refs.push(ref)
      out.parts.push({ p: { ...p, ref }, at: `${at} (copy ${k})` })
    })

    const entry = bindings[k - 1]
    const at = `repeat.bindings[${k - 1}]`
    const chosen: Record<string, string> = {}
    if (!isObj(entry)) out.errors.push(`${at}: must map every port except shared ones (${bound.join(', ')}) to an outside pin`)
    else {
      for (const port of bound) {
        if (!Object.hasOwn(entry, port)) {
          out.errors.push(`${at}: port ${port} is not bound`)
          continue
        }
        const text = endpointText(entry[port])
        if (text === null) {
          out.errors.push(`${at}.${port}: must be "REF.PIN" or { "ref", "pin" }`)
          continue
        }
        const prior = boundBy.get(text)
        if (prior) {
          out.errors.push(`${at}.${port}: ${text} is already bound by ${prior}`)
          continue
        }
        boundBy.set(text, `copy ${k} port ${port}`)
        chosen[port] = text
      }
      for (const key of Object.keys(entry)) if (!bound.includes(key)) out.errors.push(`${at}.${key}: not a port that takes a binding (${bound.join(', ')})`)
    }

    tNets.forEach((net, i) => {
      const nat = `repeat.template.nets[${i}]`
      if (!isObj(net) || typeof net.name !== 'string' || !Array.isArray(net.pins)) {
        if (k === 1) out.errors.push(`${nat}: must be { "name", "pins": [...] }`)
        return
      }
      const pins: RawPin[] = net.pins.map((ep, j) => ({ ep: renameEndpoint(ep, (r) => (tRefs.includes(r) ? rename(r) : r)), at: `${nat}.pins[${j}] (copy ${k})` }))
      const port = ports.includes(net.name) ? net.name : null
      if (port !== null && Object.hasOwn(shared, port)) {
        const target = shared[port] as string
        out.shared.set(target, [...(out.shared.get(target) ?? []), ...pins])
        return
      }
      // Binding values here are unvalidated when errors is non-empty; callers may resolve them for error reporting but must not emit a diagram from them.
      if (port !== null && isObj(entry) && Object.hasOwn(entry, port)) pins.push({ ep: entry[port], at: `${at}.${port}`, binding: `copy ${k} port ${port}` })
      out.nets.push({ name: `${name}_${k}.${net.name}`, pins, at: `${nat} (copy ${k})`, ...(net.label !== undefined ? { label: net.label } : {}) })
    })
    out.copies.push({ id: `${name}_${k}`, repeat: name, index: k, refs, bindings: chosen })
  }
  return out
}
