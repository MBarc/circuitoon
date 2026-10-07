// The first Run's download (firmware spec 2.7): each pinned Pyodide file fetched with a streamed fetch
// (determinate progress over the manifest's bytes), checked against its sha256, which also warms the
// HTTP cache the worker's loadPyodide then reads from. Once per page; a failure lets the next Run retry.
import PY from '../pyManifest.json'

export const pyBase = (): string => new URL(`${import.meta.env.BASE_URL}py/${PY.version}/`, location.href).href

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
let once: Promise<{ indexURL: string; lock: string }> | null = null

export function prefetchPy(onProgress: (loaded: number, total: number) => void, fetchFn: typeof fetch = fetch, base: string = pyBase()): Promise<{ indexURL: string; lock: string }> {
  once ??= (async () => {
    const total = PY.files.reduce((s, f) => s + f.bytes, 0)
    let loaded = 0
    let lock = ''
    for (const f of PY.files) {
      const res = await fetchFn(base + f.name)
      if (!res.ok || !res.body) throw new Error(`could not load ${f.name} (HTTP ${res.status})`)
      const chunks: Uint8Array[] = []
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        loaded += value.length
        onProgress(Math.min(loaded, total), total)
      }
      const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
      let at = 0
      for (const c of chunks) (bytes.set(c, at), (at += c.length))
      if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== f.sha256) throw new Error(`${f.name} is not the file this version expects; reload the page`)
      if (f.name === 'pyodide-lock.json') lock = new TextDecoder().decode(bytes)
    }
    return { indexURL: base, lock }
  })()
  once.catch(() => (once = null))
  return once
}
