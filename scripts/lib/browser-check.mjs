// Shared by the browser checks (check-link-ui, check-annotations-ui, check-examples): serve the built
// site with `vite preview`, launch the locally installed Chrome through playwright-core (never the
// shared Playwright MCP browser), read flags, and count failures.
import { execSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)

/** The value after `name` on the command line, or `fallback`. */
export function flagOf(name, fallback) {
  const i = args.indexOf(name)
  return i < 0 ? fallback : args[i + 1]
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json', '.zip': 'application/zip' }

/**
 * Serves `dist/` under `/circuitoon/` on 127.0.0.1 only. By default it sends NO isolation headers and
 * no CSP, as GitHub Pages does, so the service worker is what isolates the page. `override(rel, req)`
 * (may be async) maps a request path under `/circuitoon/` to another file, or returns null to serve
 * `dist/<rel>`. With `{ pages: true }` it stands in for Pages plus the worker's headers in one, with
 * no service worker in the way (so DevTools network emulation reaches every fetch): COOP/COEP on every
 * response, the code worker's CSP, and .wasm, .mjs and .json sent gzip-compressed (level 6) with
 * Content-Encoding: gzip, as Pages sends them (ruling R15); everything else as is.
 */
export async function startStatic(port, override = () => null, { pages = false } = {}) {
  if (!existsSync('dist/index.html')) {
    console.error('No build found. Run `npm run build` first.')
    process.exit(2)
  }
  // Compressed up front, so no request waits on gzip (Pages serves its compressed files at once).
  const gzipped = new Map()
  if (pages) for (const f of readdirSync('dist', { recursive: true })) if (/\.(wasm|mjs|json)$/.test(f)) gzipped.set(join('dist', f), gzipSync(readFileSync(join('dist', f)), { level: 6 }))
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    // Encoded separators (..%2f) survive URL normalisation: refuse anything that climbs.
    if (!path.startsWith('/circuitoon/') || path.includes('..') || path.includes('\\')) return void res.writeHead(404).end()
    const rel = path.slice('/circuitoon/'.length) || 'index.html'
    const file = (await override(rel, req)) ?? join('dist', rel)
    if (!existsSync(file) || !statSync(file).isFile()) return void res.writeHead(404).end()
    const headers = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' }
    let body = readFileSync(file)
    if (pages) {
      Object.assign(headers, { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' })
      if (/\/codeWorker[^/]*\.js$/.test(path)) headers['Content-Security-Policy'] = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'"
      if (/\.(wasm|mjs|json)$/.test(file) && /gzip/.test(req.headers['accept-encoding'] ?? '')) {
        if (!gzipped.has(file)) gzipped.set(file, gzipSync(body, { level: 6 })) // an override's file
        body = gzipped.get(file)
        Object.assign(headers, { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' })
      }
    }
    res.writeHead(200, { ...headers, 'Content-Length': body.length })
    res.end(body)
  })
  await new Promise((ok, fail) => server.once('error', fail).listen(port, '127.0.0.1', ok)).catch((e) => {
    console.error(`Port ${port} is already in use (${e.code}). Stop that server or pass --port.`)
    process.exit(3)
  })
  return { base: `http://127.0.0.1:${port}/circuitoon/`, close: () => server.close() }
}

/** The command line asks for the header-less server (`--sw`), so the service worker isolates pages. */
export const underSw = args.includes('--sw')

/**
 * Starts `vite preview` on `port` (stopped when the process exits) and waits until it answers. With
 * `--sw` on the command line it starts the header-less `startStatic` server instead.
 */
export async function startPreview(port) {
  if (underSw) return startStatic(port)
  if (!existsSync('dist/index.html')) {
    console.error('No build found. Run `npm run build` first.')
    process.exit(2)
  }
  const base = `http://localhost:${port}/circuitoon/`
  // With --strictPort a busy port stops the new server, and the check would run against whatever
  // already answers there (maybe an older build), so refuse instead.
  if (await fetch(base).then(() => true, () => false)) {
    console.error(`Port ${port} is already in use. Stop that server or pass --port.`)
    process.exit(3)
  }
  const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { shell: true, stdio: 'ignore' })
  process.on('exit', () => {
    try {
      if (process.platform === 'win32') execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' })
      else server.kill('SIGTERM')
    } catch {
      // already gone
    }
  })
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(base)).ok) break
    } catch {
      // not up yet
    }
    if (i === 60) {
      console.error(`vite preview did not answer on ${base}`)
      process.exit(3)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return { base }
}

export const launchChrome = () => chromium.launch({ channel: 'chrome', headless: true })

/** `check(ok, what)` prints each result; `done()` exits 1 when any failed. */
export function checker() {
  const failures = []
  return {
    check(ok, what) {
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
      if (!ok) failures.push(what)
    },
    done() {
      if (failures.length) {
        console.error(`${failures.length} check(s) failed`)
        process.exit(1)
      }
      console.log('all checks passed')
      // Exit explicitly: the preview server is a child process and would keep Node alive.
      process.exit(0)
    },
  }
}

/**
 * Removes `window.showSaveFilePicker` from every document `target` (a page or a context) loads, so
 * Export JSON names the file in the editor's own dialog and downloads it. Headless Chrome has the
 * picker but closes its Save As dialog at once (an AbortError), which would save nothing.
 */
export const noSavePicker = (target) =>
  target.addInitScript(() => {
    delete window.showSaveFilePicker
  })

/** A File menu entry of the editor toolbar: `.click()` opens the menu, then chooses the item. */
export const fileItem = (page, name) => ({
  async click() {
    await page.getByRole('button', { name: 'File', exact: true }).click()
    await page.getByRole('menuitem', { name, exact: true }).click()
  },
})

/**
 * Exports through the toolbar's Export JSON and the naming dialog (see `noSavePicker`), typing
 * `name` as the file name when given, and returns the download.
 */
export async function exportDownload(page, name) {
  await fileItem(page, 'Export JSON').click()
  const dialog = page.getByRole('dialog', { name: 'Export JSON' })
  if (name !== undefined) await dialog.getByLabel('File name').fill(name)
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Export', exact: true }).click()])
  return download
}
