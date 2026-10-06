// The CLI's Python runtime (firmware spec 2.7): the plugin does not ship Pyodide. The first
// `circuitoon run` downloads this build's exact files from the project's own Pages site, checks each
// against the sha256 compiled in (pyManifest.json), and keeps them in the user's cache directory;
// later runs are offline. --py-dir uses a local copy, checked the same way. Requests carry nothing
// about the user (Node's default User-Agent).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import PY from '../pyManifest.json' with { type: 'json' }

export const PAGES_PY = 'https://mbarc.github.io/circuitoon/py/'
export const NO_LONGER_PUBLISHED = "This plugin's Python runtime is no longer published; update the plugin"

/** The user's cache directory for Circuitoon (CIRCUITOON_CACHE overrides). */
export function cacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CIRCUITOON_CACHE) return env.CIRCUITOON_CACHE
  if (process.platform === 'win32') return join(env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'circuitoon', 'cache')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'circuitoon')
  return join(env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'circuitoon')
}

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const good = (dir: string, f: { name: string; sha256: string }) => existsSync(join(dir, f.name)) && sha(readFileSync(join(dir, f.name))) === f.sha256
const ready = (dir: string) => ({ dir, indexURL: dir.endsWith(sep) || dir.endsWith('/') ? dir : `${dir}${sep}`, lock: readFileSync(join(dir, 'pyodide-lock.json'), 'utf8') })

export async function ensurePy(o: { pyDir?: string; cacheDir?: string; fetch?: typeof fetch; base?: string } = {}): Promise<{ dir: string; indexURL: string; lock: string }> {
  if (o.pyDir) {
    const bad = PY.files.filter((f) => !good(o.pyDir!, f)).map((f) => f.name)
    if (bad.length) throw new Error(`--py-dir ${o.pyDir} is not Pyodide ${PY.version}: ${bad.join(', ')} missing or different`)
    return ready(o.pyDir)
  }
  const dir = join(o.cacheDir ?? cacheRoot(), 'py', PY.version)
  mkdirSync(dir, { recursive: true })
  const get = o.fetch ?? fetch
  for (const f of PY.files) {
    if (good(dir, f)) continue
    const url = `${o.base ?? PAGES_PY}${PY.version}/${f.name}`
    let res: Response
    try {
      res = await get(url)
    } catch (e) {
      throw new Error(`could not download ${url} (${e instanceof Error ? e.message : String(e)}); the first run needs the network, or pass --py-dir`)
    }
    if (res.status === 404) throw new Error(NO_LONGER_PUBLISHED)
    if (!res.ok) throw new Error(`could not download ${url} (HTTP ${res.status}); the first run needs the network, or pass --py-dir`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (sha(bytes) !== f.sha256) throw new Error(`${f.name} does not match this plugin's Pyodide ${PY.version} (its sha256 differs); try again later`)
    writeFileSync(join(dir, `${f.name}.part`), bytes)
    renameSync(join(dir, `${f.name}.part`), join(dir, f.name))
  }
  return ready(dir)
}
