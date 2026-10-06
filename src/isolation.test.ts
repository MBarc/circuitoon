// Firmware spec 2.5 and 2.6: cross-origin isolation on GitHub Pages through coi-serviceworker 0.1.7
// (require-corp, quiet, a reload that never drops an unsaved diagram), loaded first in <head>; the
// code worker's script gets the CSP (ruling R19); Vite sets the same headers for dev and preview.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import config, { CODE_WORKER_CSP, codeWorkerCsp } from '../vite.config.ts'

const html = readFileSync('index.html', 'utf8')
const sw = readFileSync('public/coi-serviceworker.js', 'utf8')

/** The service worker half of the file, run in a fake worker scope; returns the response headers for a URL. */
async function swHeaders(url: string): Promise<Headers> {
  const listeners: Record<string, (e: unknown) => void> = {}
  const self = { addEventListener: (t: string, f: (e: unknown) => void) => void (listeners[t] = f) }
  vm.runInNewContext(sw, { self, fetch: async () => new Response('x', { status: 200 }), Headers, Response, Request, URL, console })
  let answer: Promise<Response> | undefined
  listeners.fetch({ request: { url, cache: 'default', mode: 'same-origin' }, respondWith: (p: Promise<Response>) => void (answer = p) })
  return (await answer!).headers
}

/**
 * The page half with the inline config from index.html, loaded at `start`; before the (asynchronous)
 * reload fires, the app clears the share link's hash as EditorApp does. Resolves to the URL the page
 * reloads at, or null when it does not reload.
 */
async function pageReload(unsaved: boolean, start = 'https://mbarc.github.io/circuitoon/#/editor?d=abc'): Promise<string | null> {
  const config = /<script>(window\.coi[\s\S]*?)<\/script>/.exec(html)![1]
  let reloadedAt: string | null = null
  const registration = { active: {}, addEventListener() {} }
  const location = { href: start, reload: () => void (reloadedAt = location.href) }
  const window: Record<string, unknown> = {
    crossOriginIsolated: false, isSecureContext: true, __circuitoonUnsaved: unsaved, location,
    history: { replaceState: (_s: unknown, _t: string, url: string) => void (location.href = new URL(url, location.href).href) },
    document: { currentScript: { src: '/circuitoon/coi-serviceworker.js' } },
  }
  const navigator = { serviceWorker: { controller: null, register: async () => registration } }
  const ctx = vm.createContext({ window, navigator, console })
  vm.runInContext(config, ctx)
  vm.runInContext(sw, ctx)
  location.href = 'https://mbarc.github.io/circuitoon/#/editor'
  await new Promise((r) => setTimeout(r, 0))
  return reloadedAt
}

describe('cross-origin isolation (spec 2.5)', () => {
  it('loads the config and the service worker first in <head>, before the theme script and the app', () => {
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m.index!)
    const coi = html.indexOf('<script src="/circuitoon/coi-serviceworker.js"></script>')
    expect(coi).toBeGreaterThan(0)
    expect(html.indexOf('<script>window.coi')).toBe(scripts[0])
    expect(coi).toBe(scripts[1])
    expect(html.indexOf("localStorage.getItem('circuitoon.theme')")).toBeGreaterThan(coi)
  })
  it('configures require-corp, quiet, and a reload guarded by the unsaved flag', () => {
    expect(html).toMatch(/coepCredentialless:\s*\(\)\s*=>\s*false/)
    expect(html).toMatch(/quiet:\s*true/)
  })
  it('reloads to take control, but never over an unsaved diagram', async () => {
    expect(await pageReload(false)).not.toBeNull()
    expect(await pageReload(true)).toBeNull()
  })
  it('reloads at the URL the page loaded with, so a share link the app already cleared survives', async () => {
    expect(await pageReload(false)).toBe('https://mbarc.github.io/circuitoon/#/editor?d=abc')
  })
  it('serves require-corp and same-origin, and the CSP on the code worker script only', async () => {
    const page = await swHeaders('https://mbarc.github.io/circuitoon/index.html')
    expect(page.get('Cross-Origin-Embedder-Policy')).toBe('require-corp')
    expect(page.get('Cross-Origin-Opener-Policy')).toBe('same-origin')
    expect(page.get('Content-Security-Policy')).toBeNull()
    const worker = await swHeaders('https://mbarc.github.io/circuitoon/assets/codeWorker-Ab12Cd.js')
    expect(worker.get('Content-Security-Policy')).toBe(CODE_WORKER_CSP)
    expect(CODE_WORKER_CSP).toBe("default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'")
  })
  it('sets COOP and COEP in Vite dev and preview, and the CSP on the worker path', () => {
    for (const s of [config.server, config.preview]) expect(s?.headers).toMatchObject({ 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' })
    const use: ((req: { url?: string }, res: { setHeader(k: string, v: string): void }, next: () => void) => void)[] = []
    const plugin = codeWorkerCsp() as { configureServer: (s: unknown) => void }
    plugin.configureServer({ middlewares: { use: (f: (typeof use)[number]) => use.push(f) } })
    const headers = (url: string) => {
      const set: Record<string, string> = {}
      use[0]({ url }, { setHeader: (k, v) => void (set[k] = v) }, () => {})
      return set
    }
    expect(headers('/circuitoon/src/run/browser/codeWorker.ts?worker_file&type=module')['Content-Security-Policy']).toBe(CODE_WORKER_CSP)
    expect(headers('/circuitoon/assets/codeWorker-Ab12Cd.js')['Content-Security-Policy']).toBe(CODE_WORKER_CSP)
    expect(headers('/circuitoon/index.html')['Content-Security-Policy']).toBeUndefined()
  })
})
