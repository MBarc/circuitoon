// Diagram links (spec 6): round trip, the 64 KB refusal, damaged payloads, the 5 MB, 2,000-part and
// 10,000-connection limits, where the payload is read from, and one eligibility check shared by the
// encoder and the decoder (amendment A9): every link the encoder makes, the decoder opens.
import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { randomBytes } from 'node:crypto'
import {
  LINK_MAX_CHARS,
  LINK_MAX_CONNECTIONS,
  LINK_MAX_JSON_BYTES,
  LINK_MAX_PARTS,
  LINK_NOTICE,
  diagramLink,
  encodePayload,
  linkLimit,
  openLinkPayload,
  payloadFromHash,
} from './link.ts'
import { type Diagram, serializeDiagram, validateDiagram } from './diagram.ts'
import { buttonLed } from '../samples/buttonLed.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { layoutNetlist } from '../agent/layout.ts'
import { ledNetlist, tiltSensors, typewriter } from '../agent/fixtures.testing.ts'

const raw = (bytes: Buffer) => `v1.${deflateRawSync(bytes).toString('base64url')}`
const sheet = (parts: number, connections: number) =>
  JSON.stringify({
    format: 'circuitoon-diagram/1', title: 't', modules: {},
    parts: Array.from({ length: parts }, (_, i) => ({ uid: `p${i}`, designator: `R${i}`, module: 'resistor', x: 0, y: 0 })),
    connections: Array.from({ length: connections }, (_, i) => ({ uid: `w${i}`, from: { part: 'p0', pin: '1' }, to: { part: 'p0', pin: '2' } })),
  })
/** A sheet that loads: `parts` resistors (the module embedded) and `connections` wires between two of them. */
const loaded = (parts: number, connections: number): Diagram => {
  const d = JSON.parse(sheet(parts, connections))
  d.modules = { resistor: libraryLookup('resistor') }
  d.parts.forEach((p: { x: number; y: number }, i: number) => Object.assign(p, { x: (i % 50) * 100, y: Math.floor(i / 50) * 60 }))
  d.connections.forEach((c: { to: { part: string } }) => (c.to.part = 'p1'))
  const r = validateDiagram(d)
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.diagram
}
const laid = (netlist: unknown): Diagram => {
  const r = layoutNetlist(netlist)
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.value.diagram
}

describe('diagram links', () => {
  it('round-trips a diagram through the URL fragment', async () => {
    const r = await diagramLink(buttonLed)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.url.startsWith('https://mbarc.github.io/circuitoon/#/editor?d=v1.')).toBe(true)
    const opened = await openLinkPayload(payloadFromHash(new URL(r.url).hash)!)
    expect(opened).toEqual({ ok: true, diagram: JSON.parse(serializeDiagram(buttonLed)), warnings: [] })
  })
  it('refuses to make a link over the limit, which is 64 KB of payload', async () => {
    expect(LINK_MAX_CHARS).toBe(65536)
    const r = await diagramLink(buttonLed, 'https://example.test/', 10)
    expect(r.ok).toBe(false)
    expect(r.chars).toBeGreaterThan(10)
    if (!r.ok) expect(r.limit).toEqual({ limit: 'chars', count: r.chars, max: 10 })
  })
  it('reports damaged payloads as a load error, never a throw', async () => {
    for (const p of ['v1.@@@', 'v2.abc', 'v1.', 'd=v1.abc', raw(Buffer.from('not deflate at all')).replace('v1.', 'v1.AAAA'), raw(Buffer.from('{"format": 1')), raw(Buffer.from([0xff, 0xfe, 0x7b]))]) {
      const r = await openLinkPayload(p)
      expect(r.ok, p).toBe(false)
      if (!r.ok) expect(r.message).toMatch(/damaged|not a Circuitoon diagram/)
    }
    const other = await openLinkPayload(raw(Buffer.from('{"format":"circuitoon-diagram/9","title":"t","modules":{},"parts":[],"connections":[]}')))
    expect(other.ok).toBe(false)
    if (!other.ok) expect(other.message).toMatch(/^This link is not a Circuitoon diagram: format: unsupported/)
  })
  it('aborts decompression past 5 MB', async () => {
    const big = raw(Buffer.alloc(6 * 1024 * 1024, 32))
    expect(big.length).toBeLessThan(LINK_MAX_CHARS)
    expect(await openLinkPayload(big)).toEqual({ ok: false, message: 'This link holds a diagram larger than 5 MB, so it was not opened.' })
    // Exactly 5 MB is not over the limit: it decodes (and is then refused only as not a diagram).
    const edge = await openLinkPayload(raw(Buffer.alloc(LINK_MAX_JSON_BYTES, 32)))
    expect(edge.ok).toBe(false)
    if (!edge.ok) expect(edge.message).toMatch(/damaged/)
  })
  it('refuses more than 2,000 parts or 10,000 connections', async () => {
    const parts = await openLinkPayload(await encodePayload(sheet(2001, 0)))
    expect(parts.ok).toBe(false)
    if (!parts.ok) expect(parts.message).toContain('2,001 parts')
    const wires = await openLinkPayload(await encodePayload(sheet(1, 10001)))
    expect(wires.ok).toBe(false)
    if (!wires.ok) expect(wires.message).toContain('10,001 connections')
  })
  it('refuses a payload longer than 64 KB when opening it, too (A9)', async () => {
    // Random text does not compress, so this payload is well over the limit.
    const long = await encodePayload(JSON.stringify({ format: 'circuitoon-diagram/1', title: randomBytes(60_000).toString('base64'), modules: {}, parts: [], connections: [] }))
    expect(long.length).toBeGreaterThan(LINK_MAX_CHARS)
    const r = await openLinkPayload(long)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toBe(`This link is ${long.length.toLocaleString('en')} characters long, more than the 65,536 a link may carry, so it was not opened.`)
  })
  it('reads a payload only from the editor route', () => {
    expect(payloadFromHash('#/editor?d=v1.abc')).toBe('v1.abc')
    expect(payloadFromHash('#/editor')).toBe(null)
    expect(payloadFromHash('#/?d=v1.abc')).toBe(null)
  })
  it('says who can see a link and that nothing is uploaded', () => {
    expect(LINK_NOTICE).toBe('Anyone with this link can see the diagram: it is stored in the link itself. Nothing is uploaded.')
  })
})

describe('one eligibility check for the encoder and the decoder (A9)', () => {
  it('names the first limit a size breaks, or null within every limit', () => {
    expect(linkLimit({ chars: LINK_MAX_CHARS, bytes: LINK_MAX_JSON_BYTES, parts: LINK_MAX_PARTS, connections: LINK_MAX_CONNECTIONS })).toBe(null)
    expect(linkLimit({})).toBe(null)
    expect(linkLimit({ chars: LINK_MAX_CHARS + 1 })).toEqual({ limit: 'chars', count: LINK_MAX_CHARS + 1, max: LINK_MAX_CHARS })
    expect(linkLimit({ chars: 11 }, 10)).toEqual({ limit: 'chars', count: 11, max: 10 })
    expect(linkLimit({ bytes: LINK_MAX_JSON_BYTES + 1 })).toEqual({ limit: 'bytes', count: LINK_MAX_JSON_BYTES + 1, max: LINK_MAX_JSON_BYTES })
    expect(linkLimit({ parts: 2001 })).toEqual({ limit: 'parts', count: 2001, max: 2000 })
    expect(linkLimit({ connections: 10_001 })).toEqual({ limit: 'connections', count: 10_001, max: 10_000 })
  })
  it('makes no link for more than 2,000 parts or 10,000 connections, however short it would be', async () => {
    const parts = await diagramLink(loaded(2001, 0))
    expect(parts.ok).toBe(false)
    if (!parts.ok) {
      expect(parts.chars).toBeLessThan(LINK_MAX_CHARS)
      expect(parts.limit).toEqual({ limit: 'parts', count: 2001, max: 2000 })
    }
    const wires = await diagramLink(loaded(2, 10_001))
    expect(wires.ok).toBe(false)
    if (!wires.ok) expect(wires.limit).toEqual({ limit: 'connections', count: 10_001, max: 10_000 })
  })
  it('opens every link it makes: samples, laid-out fixtures, and sheets at the count limits', async () => {
    const sheets = [buttonLed, laid(ledNetlist()), laid(tiltSensors()), laid(typewriter(false)), loaded(LINK_MAX_PARTS, 0), loaded(2, LINK_MAX_CONNECTIONS)]
    for (const d of sheets) {
      const r = await diagramLink(d)
      expect(r.ok, d.title).toBe(true)
      if (!r.ok) continue
      const opened = await openLinkPayload(payloadFromHash(new URL(r.url).hash)!)
      expect(opened.ok, d.title).toBe(true)
      if (opened.ok) expect(serializeDiagram(opened.diagram)).toBe(serializeDiagram(d))
    }
  }, 60_000)
})
