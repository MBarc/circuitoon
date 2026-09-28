// Diagram links (agent toolkit spec 6): `#/editor?d=v1.<base64url(deflate-raw(json))>`. The diagram
// travels in the URL fragment, which browsers never send to a server, so nothing is uploaded; anyone
// with the link can see the diagram. Encoding and decoding use the web CompressionStream API, which
// the browser and Node 22+ both have, so the site and the CLI share this file. The encoder and the
// decoder apply one eligibility check, `linkLimit` (amendment A9), so every link the encoder makes
// the decoder opens.
import { type Diagram, serializeDiagram, validateDiagram } from './diagram.ts'
import { isObj } from './module.ts'

export const SITE_URL = 'https://mbarc.github.io/circuitoon/'
export const LINK_VERSION = 'v1.'
/** Longest payload a link may carry, in characters (64 KB), `v1.` included. */
export const LINK_MAX_CHARS = 64 * 1024
/** Most JSON a link may hold, in UTF-8 bytes: the file import limit (5 MB). Decompression stops here. */
export const LINK_MAX_JSON_BYTES = 5 * 1024 * 1024
export const LINK_MAX_PARTS = 2000
export const LINK_MAX_CONNECTIONS = 10_000
export const LINK_NOTICE = 'Anyone with this link can see the diagram: it is stored in the link itself. Nothing is uploaded.'

const DAMAGED = 'This link is damaged (it could not be decoded), so nothing was opened.'
const TOO_BIG = 'This link holds a diagram larger than 5 MB, so it was not opened.'

/** What a link carries, as far as it is known: payload characters, JSON bytes, parts, connections. */
export interface LinkSize {
  chars?: number
  bytes?: number
  parts?: number
  connections?: number
}
/** The limit a link breaks, with its count and the most it may be. */
export interface LinkLimit {
  limit: 'chars' | 'bytes' | 'parts' | 'connections'
  count: number
  max: number
}

/**
 * The one eligibility check (A9): the first limit `size` breaks, or null. The encoder refuses what
 * the decoder would refuse, so a link that is made always opens. `maxChars` lowers the payload limit
 * (tests); nothing may raise it.
 */
export function linkLimit(size: LinkSize, maxChars = LINK_MAX_CHARS): LinkLimit | null {
  const checks: [LinkLimit['limit'], number | undefined, number][] = [
    ['chars', size.chars, Math.min(maxChars, LINK_MAX_CHARS)],
    ['bytes', size.bytes, LINK_MAX_JSON_BYTES],
    ['parts', size.parts, LINK_MAX_PARTS],
    ['connections', size.connections, LINK_MAX_CONNECTIONS],
  ]
  for (const [limit, count, max] of checks) if (count !== undefined && count > max) return { limit, count, max }
  return null
}

const n = (x: number) => x.toLocaleString('en')

/** The limit in plain words, for the CLI: "2,001 parts, more than the 2,000 a link may carry". */
export function limitText(l: LinkLimit): string {
  if (l.limit === 'bytes') return 'more than 5 MB of JSON, the most a link may carry'
  const unit = l.limit === 'chars' ? 'characters' : l.limit
  return `${n(l.count)} ${unit}, more than the ${n(l.max)} a link may carry`
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4))
    return Uint8Array.from(bin, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

export async function encodePayload(json: string): Promise<string> {
  const packed = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()
  return LINK_VERSION + toBase64Url(new Uint8Array(packed))
}

/** The JSON text a payload holds; refuses a payload over LINK_MAX_CHARS, and stops reading past LINK_MAX_JSON_BYTES. */
export async function decodePayload(payload: string): Promise<{ ok: true; json: string } | { ok: false; message: string }> {
  const long = linkLimit({ chars: payload.length })
  if (long) return { ok: false, message: `This link is ${n(long.count)} characters long, more than the ${n(long.max)} a link may carry, so it was not opened.` }
  if (!payload.startsWith(LINK_VERSION)) return { ok: false, message: DAMAGED }
  const bytes = fromBase64Url(payload.slice(LINK_VERSION.length))
  if (!bytes) return { ok: false, message: DAMAGED }
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (linkLimit({ bytes: total })) {
        await reader.cancel().catch(() => {})
        return { ok: false, message: TOO_BIG }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, message: DAMAGED }
  }
  const all = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    all.set(c, at)
    at += c.length
  }
  try {
    return { ok: true, json: new TextDecoder('utf-8', { fatal: true }).decode(all) }
  } catch {
    return { ok: false, message: DAMAGED }
  }
}

/** A payload as the editor opens it: decoded, within the limits, and loaded like a file. Never rejects. */
export async function openLinkPayload(payload: string): Promise<{ ok: true; diagram: Diagram; warnings: string[] } | { ok: false; message: string }> {
  try {
    const r = await decodePayload(payload)
    if (!r.ok) return r
    let raw: unknown
    try {
      raw = JSON.parse(r.json)
    } catch {
      return { ok: false, message: DAMAGED }
    }
    const count = (key: string) => (isObj(raw) && Array.isArray(raw[key]) ? (raw[key] as unknown[]).length : 0)
    const over = linkLimit({ parts: count('parts'), connections: count('connections') })
    if (over) return { ok: false, message: `This link's diagram has ${limitText(over)}, so it was not opened.` }
    const v = validateDiagram(raw)
    if (!v.ok) return { ok: false, message: `This link is not a Circuitoon diagram: ${v.errors.slice(0, 3).join('; ')}` }
    return { ok: true, diagram: v.diagram, warnings: v.warnings }
  } catch (err) {
    return { ok: false, message: `This link could not be read: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/**
 * A link that opens `d` in the editor, or, when `d` breaks a link limit (checked by `linkLimit`, as
 * the decoder checks it), the payload size and the limit it breaks.
 */
export async function diagramLink(
  d: Diagram,
  base = SITE_URL,
  max = LINK_MAX_CHARS,
): Promise<{ ok: true; url: string; chars: number } | { ok: false; chars: number; limit: LinkLimit }> {
  // Compact JSON: the link is shorter, and it opens to the same diagram as the file text.
  const json = JSON.stringify(JSON.parse(serializeDiagram(d)))
  const payload = await encodePayload(json)
  const limit = linkLimit({ chars: payload.length, bytes: new TextEncoder().encode(json).length, parts: d.parts.length, connections: d.connections.length }, max)
  return limit ? { ok: false, chars: payload.length, limit } : { ok: true, url: `${base}#/editor?d=${payload}`, chars: payload.length }
}

/** The payload of an editor link hash (`#/editor?d=...`), or null for any other hash. */
export function payloadFromHash(hash: string): string | null {
  if (!hash.startsWith('#/editor?')) return null
  return new URLSearchParams(hash.slice('#/editor?'.length)).get('d')
}
