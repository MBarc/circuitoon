// A small PNG reader for the render tests (amendment A11): 8-bit RGB or RGBA, not interlaced, which
// is what Chrome and Edge write for a screenshot. Enough to look at pixels, not a general decoder.
// Test helper.
import { inflateSync } from 'node:zlib'

export interface Pixels {
  width: number
  height: number
  /** RGBA, row by row. */
  data: Uint8Array
}

export function decodePng(buf: Uint8Array): Pixels {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)
  if (b.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('not a PNG')
  let width = 0
  let height = 0
  let channels = 0
  const idat: Buffer[] = []
  for (let at = 8; at < b.length; ) {
    const len = b.readUInt32BE(at)
    const type = b.toString('latin1', at + 4, at + 8)
    const body = b.subarray(at + 8, at + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const depth = body[8]
      const color = body[9]
      if (depth !== 8 || (color !== 2 && color !== 6) || body[12] !== 0) throw new Error(`unsupported PNG: depth ${depth}, color type ${color}, interlace ${body[12]}`)
      channels = color === 6 ? 4 : 3
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    at += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const rows = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const row = rows.subarray(y * stride, (y + 1) * stride)
    const up = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0
      const c = i >= channels ? up[i - channels] : 0
      const u = up[i]
      let v = src[i]
      if (filter === 1) v += a
      else if (filter === 2) v += u
      else if (filter === 3) v += (a + u) >> 1
      else if (filter === 4) {
        const p = a + u - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - u)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? u : c
      }
      row[i] = v & 255
    }
  }
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rows[i * channels]
    data[i * 4 + 1] = rows[i * channels + 1]
    data[i * 4 + 2] = rows[i * channels + 2]
    data[i * 4 + 3] = channels === 4 ? rows[i * channels + 3] : 255
  }
  return { width, height, data }
}

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))

/** The pixel at (x, y) as #RRGGBB. */
export function pixelAt(p: Pixels, x: number, y: number): string {
  const i = (y * p.width + x) * 4
  return `#${[p.data[i], p.data[i + 1], p.data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

/** Standard deviation of the grey level over every pixel: 0 for a blank image. */
export function greyDeviation(p: Pixels): number {
  let sum = 0
  let sq = 0
  const n = p.width * p.height
  for (let i = 0; i < n; i++) {
    const g = (p.data[i * 4] + p.data[i * 4 + 1] + p.data[i * 4 + 2]) / 3
    sum += g
    sq += g * g
  }
  const mean = sum / n
  return Math.sqrt(Math.max(0, sq / n - mean * mean))
}

/**
 * The box of pixels that are neither paper nor grid (within a tolerance for anti-aliasing): the
 * drawing itself. Null when there is none.
 */
export function inkBox(p: Pixels, background: string[], tolerance = 40): { x0: number; y0: number; x1: number; y1: number } | null {
  const bg = background.map(hex)
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const i = (y * p.width + x) * 4
      const near = bg.some(([r, g, b]) => Math.abs(p.data[i] - r) + Math.abs(p.data[i + 1] - g) + Math.abs(p.data[i + 2] - b) <= tolerance)
      if (near) continue
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  return x1 < 0 ? null : { x0, y0, x1, y1 }
}
