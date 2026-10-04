// USB links and their rules (docs/superpowers/specs/2026-10-04-usb-design.md): a connection between
// two USB ports is a USB cable (its ends are the cable's plugs) or, when one port is a plug, the plug
// pushed straight into the other port. The rules here judge fit, roles and the current a host port
// or a hub tree is asked for; checkDiagram runs them and keeps USB nets out of the DC and pin rules.
// Pure, no React.
import { type Connection, type Diagram, type Endpoint, type PartInstance, moduleOf } from './diagram.ts'
import { type EndKind, END_NAMES, CABLE_PRESETS, endKind, isUsbEnd, type WireEnds } from './cables.ts'
import { type ModuleDef, type UsbConnector, type UsbSpec, isNetLabel, isSpacer, usbBudgets, usbHubOf, usbPorts } from './module.ts'
import { labelName } from './netLabels.ts'
import { type Netlist, nodeKey } from './netlist.ts'
import { andList, natural } from './words.ts'

/** A USB port in words: "USB micro-B receptacle, device, 2.0 full speed, draws 270 mA". */
export function usbWords(u: UsbSpec): string {
  return [`USB ${u.connector} ${u.gender}`, u.role, u.power === 'only' ? 'charge only' : '', u.hub ? `hub ${u.hub}` : '',
    [u.version, u.speed ? `${u.speed} speed` : ''].filter(Boolean).join(' '), u.source !== undefined ? `supplies ${u.source} mA` : '',
    u.draw !== undefined ? `draws ${u.draw} mA` : u.role === 'device' ? 'draw not known' : '', u.through ? `passes the bus through to ${u.through}` : ''].filter(Boolean).join(', ')
}

/** The cable plug that fits each USB receptacle. */
export const PLUG_KIND: Record<UsbConnector, EndKind> = { A: 'usb-a', B: 'usb-b', 'mini-B': 'usb-mini-b', 'micro-B': 'usb-micro-b', C: 'usb-c' }
/** A connector in a sentence. */
export const CONNECTOR_WORDS: Record<UsbConnector, string> = { A: 'USB-A', B: 'USB-B', 'mini-B': 'mini-B', 'micro-B': 'micro-B', C: 'USB-C' }
/** The USB default a host port supplies when its maker gives no figure (USB 2.0 and 3.0 specifications). */
export const DEFAULT_SOURCE: Record<string, number> = { '1.1': 500, '2.0': 500, '3.0': 900 }
/** What a bus-powered hub's downstream port may give (USB 2.0 specification: one unit load). */
export const BUS_HUB_PORT_MA = 100

/** A USB port on the sheet. */
export interface Port {
  part: PartInstance
  module: ModuleDef
  name: string
  /** "U1 USB": designator and silkscreen. */
  title: string
  usb: UsbSpec
  key: string
}

const pinLabel = (m: ModuleDef, name: string): string => {
  const p = m.pins.find((q) => !isSpacer(q) && q.name === name)
  return p && !isSpacer(p) ? (p.label ?? p.name) : name
}

const indexCache = new WeakMap<Diagram, Map<string, Port>>()
/** Every USB port on the sheet by node key, built once per sheet object (most sheets have none). */
function portIndex(d: Diagram): Map<string, Port> {
  let index = indexCache.get(d)
  if (index) return index
  index = new Map()
  for (const part of d.parts) {
    const m = moduleOf(d, part.module)
    if (!m || !m.pins.some((p) => !isSpacer(p) && p.type === 'usb')) continue
    for (const p of usbPorts(m)) {
      const key = nodeKey(part.uid, p.name)
      index.set(key, { part, module: m, name: p.name, title: `${part.designator} ${p.label ?? p.name}`, usb: p.usb, key })
    }
  }
  indexCache.set(d, index)
  return index
}

/** The USB port an endpoint names, or null (not a USB port, a missing part, or an offset or hole that cannot be on one). */
export function portOf(d: Diagram, ep: Endpoint): Port | null {
  if (ep.offset !== undefined || ep.hole !== undefined) return null
  return portIndex(d).get(nodeKey(ep.part, ep.pin)) ?? null
}

/** True when the endpoint is a USB port. */
export const isUsbEndpoint = (d: Diagram, ep: Endpoint): boolean => portOf(d, ep) !== null

/**
 * The ends a new connection between two USB ports gets (USB design 2.1): between two receptacles, the
 * cable whose plugs fit them; none when either port is a plug, which pushes straight in (or, for two
 * plugs, cannot meet at all: the checker says so).
 */
export function usbEndsFor(a: UsbSpec, b: UsbSpec): WireEnds | undefined {
  return a.gender === 'receptacle' && b.gender === 'receptacle' ? { from: PLUG_KIND[a.connector], to: PLUG_KIND[b.connector] } : undefined
}

/** A connection between two USB ports: a cable, or (`direct`) a plug pushed into a socket. */
export interface UsbLink {
  conn: Connection
  from: Port
  to: Port
  direct: boolean
}

/** The connection as a USB link, or null when it does not join two USB ports (or does not resolve). */
export function usbLink(d: Diagram, c: Connection): UsbLink | null {
  const from = portOf(d, c.from)
  const to = from && portOf(d, c.to)
  if (!from || !to) return null
  return { conn: c, from, to, direct: from.usb.gender === 'plug' || to.usb.gender === 'plug' }
}

/** True for a plug pushed straight into a socket: drawn as a short dashed link, never a wire to buy. */
export function isPluggedIn(d: Diagram, c: Connection): boolean {
  return usbLink(d, c)?.direct === true
}

/** The cable preset these ends make, as a name ("USB A to micro-B cable"), or a description. */
export function cableWords(a: EndKind, b: EndKind): string {
  const p = CABLE_PRESETS.find((q) => (q.from === a && q.to === b) || (q.from === b && q.to === a))
  return p ? `a ${p.name}` : `a cable with a ${END_NAMES[a]} and a ${END_NAMES[b]}`
}

/** The parts a linked USB port powers (a device, dual or charge-only port with a link): never "no power". */
export function usbFedParts(d: Diagram): Set<string> {
  const out = new Set<string>()
  for (const c of d.connections) {
    const l = usbLink(d, c)
    if (!l) continue
    for (const p of [l.from, l.to]) if (p.usb.role === 'device' || p.usb.role === 'dual') out.add(p.part.uid)
  }
  return out
}

export type UsbRuleId = 'usb-to-pin' | 'usb-fit' | 'usb-role' | 'usb-power' | 'usb-hub-bus-power' | 'usb-power-unknown'
export interface UsbDraft {
  rule: UsbRuleId
  subject: string
  target: string
  message: string
  parts: string[]
  pins: Endpoint[]
  wires: string[]
  causes: string[]
}

const mA = (n: number) => `${Math.round(n)} mA`
const pinOf = (p: Port): Endpoint => ({ part: p.part.uid, pin: p.name })

/** What is at a node key, in words: "U2 GPIO5", "label SDA", "BB1 hole strip". */
function nodeWords(d: Diagram, key: string): string {
  const [uid, pin] = JSON.parse(key) as [string, string]
  const part = d.parts.find((p) => p.uid === uid)
  const m = part && moduleOf(d, part.module)
  if (!part || !m) return pin
  if (isNetLabel(m)) return labelName(part) ? `label ${labelName(part)}` : `${part.designator} (unnamed label)`
  return `${part.designator} ${pinLabel(m, pin)}`
}

/** Every USB finding on the sheet. `nl` is the sheet's netlist; `netWires` its wires per net. */
export function usbFindings(d: Diagram, nl: Netlist, netWires: string[][]): UsbDraft[] {
  const out: UsbDraft[] = []
  const portByKey = portIndex(d)
  if (!portByKey.size) return out

  // Rule usb-to-pin: a USB port on a net with anything that is not a USB port.
  const mixed = new Set<number>()
  nl.nets.forEach((keys, i) => {
    const ports = keys.filter((k) => portByKey.has(k)).map((k) => portByKey.get(k)!)
    const others = keys.filter((k) => !portByKey.has(k))
    if (!ports.length || !others.length) return
    mixed.add(i)
    const names = others.map((k) => nodeWords(d, k)).sort(natural.compare)
    const list = names.length > 3 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : andList(names)
    for (const p of ports)
      out.push({ rule: 'usb-to-pin', subject: p.part.designator, target: p.title,
        message: `${p.title} is a USB port, and it is wired to ${list}. A USB port connects only to another USB port, by a USB cable or by plugging in: never by jumper wires to pins, which skip the cable's shielding and twisted pair and can short VBUS. Remove the wire and connect ${p.title} to a USB port.`,
        parts: [p.part.uid, ...others.map((k) => (JSON.parse(k) as [string])[0])], pins: [pinOf(p)], wires: netWires[i] ?? [], causes: [p.key, ...others] })
  })

  // Links, and ports with more than one.
  const links: UsbLink[] = []
  const linksAt = new Map<string, UsbLink[]>()
  for (const c of d.connections) {
    const l = usbLink(d, c)
    if (!l) continue
    const i = nl.netOf.get(l.from.key)
    if (i !== undefined && mixed.has(i)) continue
    links.push(l)
    for (const p of [l.from, l.to]) linksAt.set(p.key, [...(linksAt.get(p.key) ?? []), l])
  }
  const crowded = new Set<string>()
  for (const [key, list] of linksAt) {
    if (list.length < 2) continue
    crowded.add(key)
    const p = portByKey.get(key)!
    const far = list.map((l) => (l.from.key === key ? l.to : l.from).title).sort(natural.compare)
    out.push({ rule: 'usb-fit', subject: p.part.designator, target: p.title,
      message: `${p.title} has ${list.length} connections (${andList(far)}), but a USB port takes one plug. Keep one; to share a port, put a USB hub between them.`,
      parts: [p.part.uid, ...list.flatMap((l) => [l.from.part.uid, l.to.part.uid])], pins: [pinOf(p)], wires: list.map((l) => l.conn.uid), causes: [key] })
  }

  // Rule usb-fit, per link: plugs meet sockets, a cable's plugs fit its two sockets.
  for (const l of links) {
    const { from: a, to: b, conn: c } = l
    const say = (message: string) =>
      out.push({ rule: 'usb-fit', subject: a.part.designator, target: `${a.title} to ${b.title}`, message, parts: [a.part.uid, b.part.uid], pins: [pinOf(a), pinOf(b)], wires: [c.uid], causes: [c.uid] })
    const ends = [endKind(c.ends, 'from'), endKind(c.ends, 'to')] as const
    if (a.usb.gender === 'plug' && b.usb.gender === 'plug') {
      say(`${a.title} and ${b.title} are both plugs (${CONNECTOR_WORDS[a.usb.connector]} and ${CONNECTOR_WORDS[b.usb.connector]}), and two plugs cannot meet. Connect each to a matching socket instead.`)
      continue
    }
    if (l.direct) {
      const [plug, socket] = a.usb.gender === 'plug' ? [a, b] : [b, a]
      if (ends.some((k) => k !== 'bare')) {
        say(`${plug.title} is a ${CONNECTOR_WORDS[plug.usb.connector]} plug: it goes straight into ${socket.title}, with no cable. Set this connection's cable to Wire, which draws it as plugged in.`)
        continue
      }
      if (plug.usb.connector !== socket.usb.connector) {
        say(`${plug.title}'s ${CONNECTOR_WORDS[plug.usb.connector]} plug does not fit ${socket.title}, a ${CONNECTOR_WORDS[socket.usb.connector]} socket. Use an adapter or a port with a ${CONNECTOR_WORDS[plug.usb.connector]} socket.`)
        continue
      }
      continue
    }
    // Two sockets: the cable's plug at each end must fit the socket it goes into.
    const want = [PLUG_KIND[a.usb.connector], PLUG_KIND[b.usb.connector]] as const
    if (ends[0] === 'bare' && ends[1] === 'bare') {
      say(`No USB cable is chosen between ${a.title} (${CONNECTOR_WORDS[a.usb.connector]}) and ${b.title} (${CONNECTOR_WORDS[b.usb.connector]}). Use ${cableWords(want[0], want[1])}.`)
      continue
    }
    const wrong = [0, 1].filter((i) => ends[i] !== want[i])
    if (wrong.length) {
      const bits = wrong.map((i) => {
        const p = i === 0 ? a : b
        const k = ends[i]
        return k === 'bare' || !isUsbEnd(k)
          ? `the end at ${p.title} is a ${END_NAMES[k].toLowerCase()}, not a USB plug`
          : `its ${END_NAMES[k]} does not fit ${p.title}, a ${CONNECTOR_WORDS[p.usb.connector]} socket`
      })
      say(`The cable from ${a.title} to ${b.title} does not fit: ${andList(bits)}. Use ${cableWords(want[0], want[1])}.`)
      continue
    }
  }

  // The bus, port to port: links plus passthrough joins (an extension's two ends).
  const far = new Map<string, Port>()
  for (const l of links) {
    // Two plugs never meet: no bus to judge (usb-fit says so).
    if (l.from.usb.gender === 'plug' && l.to.usb.gender === 'plug') continue
    far.set(l.from.key, l.to)
    far.set(l.to.key, l.from)
  }
  const through = (p: Port): Port | null => {
    if (p.usb.role !== 'passthrough' || !p.usb.through) return null
    return portOf(d, { part: p.part.uid, pin: p.usb.through })
  }
  /** The port at the far end of `p`'s link, followed through extensions; null when it ends at nothing. */
  const reach = (p: Port): Port | null => {
    const seen = new Set<string>([p.key])
    let q = far.get(p.key) ?? null
    while (q && q.usb.role === 'passthrough') {
      if (seen.has(q.key)) return null
      seen.add(q.key)
      const t = through(q)
      if (!t) return null
      seen.add(t.key)
      q = far.get(t.key) ?? null
    }
    return q
  }

  // Rule usb-role: one end must be able to host and the other to be a device.
  const judged = new Set<string>()
  const pairs: [Port, Port][] = []
  for (const p of portByKey.values()) {
    if (p.usb.role === 'passthrough' || crowded.has(p.key)) continue
    const q = reach(p)
    if (!q || crowded.has(q.key)) continue
    const id = [p.key, q.key].sort().join('|')
    if (judged.has(id)) continue
    judged.add(id)
    pairs.push([p, q])
    const [x, y] = [p, q].sort((s, t) => natural.compare(s.title, t.title))
    const wires = links.filter((l) => [l.from.part.uid, l.to.part.uid].some((u) => u === x.part.uid || u === y.part.uid)).map((l) => l.conn.uid)
    const say = (message: string) =>
      out.push({ rule: 'usb-role', subject: x.part.designator, target: `${x.title} to ${y.title}`, message, parts: [x.part.uid, y.part.uid], pins: [pinOf(x), pinOf(y)], wires, causes: [x.key, y.key] })
    const hubUp = [x, y].find((s) => s.usb.hub === 'upstream')
    if (x.usb.role === 'host' && y.usb.role === 'host') {
      const what = (s: Port) => (s.usb.hub === 'downstream' ? `a hub's downstream port` : 'a host port')
      say(`${x.title} (${what(x)}) is connected to ${y.title} (${what(y)}): two hosts cannot talk, and both may drive VBUS into each other. Connect a host to a device, or to a hub's upstream port.`)
    } else if (x.usb.role === 'device' && y.usb.role === 'device') {
      say(hubUp
        ? `${hubUp.title} is a hub's upstream port, and it is connected to ${(hubUp === x ? y : x).title}, which is a device, not a host. A hub's upstream port must face a host or another hub's downstream port: connect it to one.`
        : `${x.title} and ${y.title} are both device ports: neither can host the other, and neither supplies VBUS. Connect each to a host, such as a computer, a Raspberry Pi or a hub's downstream port.`)
    }
  }

  // Power: what each host port is asked for. Demand is known mA plus the ports whose draw is unknown.
  type Demand = { mA: number; unknown: Port[] }
  const hubSelfPowered = (p: Port): boolean => {
    const h = usbHubOf(p.module)
    if (!h) return false
    if (h.power === 'self') return true
    if (h.power === 'bus') return false
    // Self-powered when its DC input pin is wired to something.
    const k = nodeKey(p.part.uid, h.power.pin)
    const i = nl.netOf.get(k)
    return i !== undefined && nl.nets[i].length > 1
  }
  const downstreamOf = (p: Port): Port[] => usbPorts(p.module).filter((q) => q.usb.hub === 'downstream').map((q) => portOf(d, { part: p.part.uid, pin: q.name })!)
  const demand = (dev: Port, depth = 0): Demand => {
    const own: Demand = dev.usb.draw === undefined ? { mA: 0, unknown: [dev] } : { mA: dev.usb.draw, unknown: [] }
    if (dev.usb.hub !== 'upstream' || hubSelfPowered(dev) || depth > 8) return own
    // A bus-powered hub passes what its downstream devices draw on to its upstream port.
    for (const ds of downstreamOf(dev)) {
      const q = reach(ds)
      if (!q || q.usb.role === 'host') continue
      const sub = demand(q, depth + 1)
      own.mA += sub.mA
      own.unknown.push(...sub.unknown)
    }
    return own
  }
  const sourceOf = (h: Port): number | null => {
    if (h.usb.source !== undefined) return h.usb.source
    if (h.usb.hub === 'downstream') return hubSelfPowered(h) ? DEFAULT_SOURCE[h.usb.version ?? '2.0'] : BUS_HUB_PORT_MA
    return h.usb.role === 'host' && h.usb.version ? DEFAULT_SOURCE[h.usb.version] : null
  }
  /** The host side and device side of a pair, or null when that is not clear (two dual ports, a role error). */
  const sides = ([p, q]: [Port, Port]): [Port, Port] | null => {
    const [a, b] = [p.usb.role, q.usb.role]
    if (a === 'host' && (b === 'device' || b === 'dual')) return [p, q]
    if (b === 'host' && (a === 'device' || a === 'dual')) return [q, p]
    if (a === 'dual' && b === 'device') return [p, q]
    if (b === 'dual' && a === 'device') return [q, p]
    return null
  }
  const asked = new Map<string, { host: Port; dev: Port; demand: Demand }>()
  for (const pair of pairs) {
    const s = sides(pair)
    if (s) asked.set(s[0].key, { host: s[0], dev: s[1], demand: demand(s[1]) })
  }
  const names = (ps: Port[]) => {
    const list = [...new Set(ps.map((p) => p.title))].sort(natural.compare)
    return list.length > 3 ? `${list.slice(0, 2).join(', ')} and ${list.length - 2} more` : andList(list)
  }
  const wiresOf = (ps: Port[]) => links.filter((l) => ps.some((p) => p.part.uid === l.from.part.uid || p.part.uid === l.to.part.uid)).map((l) => l.conn.uid)
  for (const { host, dev, demand: dm } of asked.values()) {
    const supply = sourceOf(host)
    const busHub = host.usb.hub === 'downstream' && !hubSelfPowered(host)
    const parts = [host.part.uid, dev.part.uid]
    if (supply !== null && dm.mA > supply) {
      if (busHub)
        out.push({ rule: 'usb-hub-bus-power', subject: host.part.designator, target: host.title,
          message: `${host.part.designator} is a bus-powered hub, so ${host.title} gives at most ${mA(BUS_HUB_PORT_MA)}, but ${dev.title} draws ${mA(dm.mA)}. Power the hub from its own supply, or plug ${dev.part.designator} into the host directly.`,
          parts, pins: [pinOf(host), pinOf(dev)], wires: wiresOf([host, dev]), causes: [host.key, dev.key] })
      else
        out.push({ rule: 'usb-power', subject: host.part.designator, target: host.title,
          message: `${host.title} supplies ${mA(supply)}, but ${dev.title}${dev.usb.hub === 'upstream' ? ' and the devices on its hub' : ''} draw${dev.usb.hub === 'upstream' ? '' : 's'} ${mA(dm.mA)}${dm.unknown.length ? ', and more where the draw is unknown' : ''}. The port can shut down or brown out. Use a powered hub, or a supply for ${dev.part.designator}.`,
          parts, pins: [pinOf(host), pinOf(dev)], wires: wiresOf([host, dev]), causes: [host.key, dev.key] })
      continue
    }
    // Unknown draws are reported once, at the port that pays for them: not at a bus-powered hub's port.
    if (dm.unknown.length && !busHub)
      out.push({ rule: 'usb-power-unknown', subject: host.part.designator, target: host.title,
        message: `The current ${host.title} is asked for is not fully known: ${names(dm.unknown)} ${dm.unknown.length === 1 ? 'has' : 'have'} no sourced draw${dm.mA ? ` (the rest draws ${mA(dm.mA)})` : ''}${supply !== null ? `, against the ${mA(supply)} the port supplies` : ''}. Check ${dm.unknown.length === 1 ? 'its' : 'their'} datasheet${dm.unknown.length === 1 ? '' : 's'}.`,
        parts: [host.part.uid, ...dm.unknown.map((p) => p.part.uid)], pins: [pinOf(host)], wires: wiresOf([host, ...dm.unknown]), causes: [host.key, 'unknown'] })
  }

  // Shared budgets (Pi 4: 1.2 A over its four ports).
  for (const part of d.parts) {
    const m = moduleOf(d, part.module)
    if (!m) continue
    for (const b of usbBudgets(part, m)) {
      const used = b.ports.map((n) => asked.get(nodeKey(part.uid, n))).filter((x) => x !== undefined)
      const total = used.reduce((s, u) => s + u.demand.mA, 0)
      if (used.length < 1 || total <= b.mA) continue
      const ps = used.map((u) => u.host)
      out.push({ rule: 'usb-power', subject: part.designator, target: `${part.designator} USB ports`,
        message: `${part.designator}'s USB ports share ${mA(b.mA)}${b.note ? ` (${b.note})` : ''}, but ${names(used.map((u) => u.dev))} draw ${mA(total)} together. Move a device to a powered hub, or give it its own supply.`,
        parts: [part.uid, ...used.map((u) => u.dev.part.uid)], pins: ps.map(pinOf), wires: wiresOf([...ps, ...used.map((u) => u.dev)]), causes: [part.uid, ...b.ports] })
    }
  }
  return out
}
