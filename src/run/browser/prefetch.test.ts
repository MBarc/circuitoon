// Firmware spec 2.7: the first Run's download reports determinate progress, refuses a file whose hash
// is not the pinned one, and lets the next Run retry after a failure; once it succeeds it is not repeated.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import PY from '../pyManifest.json'
import { prefetchPy } from './prefetch.ts'

const BASE = 'https://example.test/py/'
const serve = (tamper: boolean) => {
  const calls: string[] = []
  const fetchFn = (async (url: string) => {
    calls.push(url)
    const bytes = new Uint8Array(readFileSync(`node_modules/pyodide/${url.slice(BASE.length)}`))
    if (tamper && url.endsWith('pyodide.mjs')) bytes[0] ^= 1
    return new Response(bytes)
  }) as unknown as typeof fetch
  return { calls, fetchFn }
}

describe('prefetchPy (spec 2.7)', () => {
  it('refuses a changed file, retries on the next Run, then fetches once with progress to the total', async () => {
    await expect(prefetchPy(() => {}, serve(true).fetchFn, BASE)).rejects.toThrow('pyodide.mjs is not the file this version expects; reload the page')
    const good = serve(false)
    const seen: [number, number][] = []
    const py = await prefetchPy((l, t) => seen.push([l, t]), good.fetchFn, BASE)
    const total = PY.files.reduce((s, f) => s + f.bytes, 0)
    expect(seen.at(-1)).toEqual([total, total])
    expect(seen.every(([l], i) => i === 0 || l >= seen[i - 1][0])).toBe(true)
    expect(py).toEqual({ indexURL: BASE, lock: readFileSync('node_modules/pyodide/pyodide-lock.json', 'utf8') })
    expect(good.calls).toEqual(PY.files.map((f) => BASE + f.name))
    expect(await prefetchPy(() => {}, good.fetchFn, BASE)).toBe(py)
    expect(good.calls.length).toBe(PY.files.length)
  })
})
