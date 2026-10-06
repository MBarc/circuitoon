// Firmware spec 2.7: the CLI fetches the exact Pyodide files from the project's Pages site once,
// checks each against the sha256 compiled in, and runs offline afterwards; --py-dir is checked the
// same way; a version that is no longer published says so in the spec's words.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import PY from './pyManifest.json' with { type: 'json' }
import { NO_LONGER_PUBLISHED, PAGES_PY, ensurePy } from './node/pyCache.ts'

/** A fake Pages site serving node_modules/pyodide; `calls` lists every URL asked for. */
function site(o: { missing?: boolean; tamper?: string } = {}) {
  const calls: string[] = []
  const fetch = (async (url: string) => {
    calls.push(url)
    if (o.missing) return new Response('not found', { status: 404 })
    const name = url.split('/').pop()!
    const bytes = new Uint8Array(readFileSync(join('node_modules/pyodide', name)))
    if (o.tamper === name) bytes[0] ^= 1
    return new Response(bytes, { status: 200 })
  }) as typeof globalThis.fetch
  return { calls, fetch }
}

describe('the CLI Python runtime (spec 2.7)', () => {
  it('downloads each file once from the Pages site, then runs offline', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'py-cache-'))
    const s = site()
    const a = await ensurePy({ cacheDir, fetch: s.fetch })
    expect(s.calls).toEqual(PY.files.map((f) => `${PAGES_PY}${PY.version}/${f.name}`))
    expect(a.dir).toBe(join(cacheDir, 'py', PY.version))
    expect(JSON.parse(a.lock).info.python).toBe(PY.python)
    const offline = site({ missing: true })
    await ensurePy({ cacheDir, fetch: offline.fetch })
    expect(offline.calls).toEqual([])
  })
  it('says the runtime is no longer published on a 404', async () => {
    await expect(ensurePy({ cacheDir: mkdtempSync(join(tmpdir(), 'py-cache-')), fetch: site({ missing: true }).fetch })).rejects.toThrow(NO_LONGER_PUBLISHED)
    expect(NO_LONGER_PUBLISHED).toBe("This plugin's Python runtime is no longer published; update the plugin")
  })
  it('refuses a file whose hash differs, and keeps nothing of it', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'py-cache-'))
    await expect(ensurePy({ cacheDir, fetch: site({ tamper: 'pyodide.asm.wasm' }).fetch })).rejects.toThrow(/pyodide\.asm\.wasm does not match this plugin's Pyodide/)
  })
  it('checks --py-dir the same way', async () => {
    expect((await ensurePy({ pyDir: 'node_modules/pyodide' })).dir).toBe('node_modules/pyodide')
    const bad = mkdtempSync(join(tmpdir(), 'py-dir-'))
    writeFileSync(join(bad, 'pyodide.mjs'), 'x')
    await expect(ensurePy({ pyDir: bad })).rejects.toThrow(`is not Pyodide ${PY.version}`)
  })
})
