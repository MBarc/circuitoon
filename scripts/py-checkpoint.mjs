// The Pyodide checkpoint (firmware spec 2.6, 2.7, 9; plan Task 11). Serves the built site with COOP,
// COEP and, on the checkpoint worker, the code worker's CSP; loads the pinned Pyodide in that worker
// with the curated jsglobals; measures load time and heap; reads GitHub Pages' compression rule from
// the live site and computes the served transfer. Prints PASS or FAIL per criterion.
// Usage (after `npm run build`): node scripts/py-checkpoint.mjs [--port 4214]
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { extname, join } from 'node:path'
import { flagOf, launchChrome } from './lib/browser-check.mjs'

const PY = JSON.parse(readFileSync('src/run/pyManifest.json', 'utf8'))
const CSP = /CODE_WORKER_CSP = "([^"]+)"/.exec(readFileSync('vite.config.ts', 'utf8'))[1] // the one definition (Task 2)
const globals = JSON.parse(/PY_JSGLOBALS[^=]*=\s*(\[[^\]]*\])/.exec(existsSync('src/run/limits.ts') ? readFileSync('src/run/limits.ts', 'utf8') : 'PY_JSGLOBALS = []')[1].replace(/'/g, '"'))
const port = Number(flagOf('--port', '4214'))
const WORKER = `
const violations = []
self.addEventListener('securitypolicyviolation', (e) => violations.push(e.violatedDirective + ' ' + e.blockedURI))
self.onmessage = async () => {
  const t0 = performance.now()
  try {
    const { loadPyodide } = await import('/circuitoon/py/${PY.version}/pyodide.mjs')
    const lock = await (await fetch('/circuitoon/py/${PY.version}/pyodide-lock.json')).text()
    const jsglobals = Object.fromEntries(${JSON.stringify(globals)}.map((n) => [n, self[n]]))
    const py = await loadPyodide({ indexURL: '/circuitoon/py/${PY.version}/', lockFileContents: lock, jsglobals })
    const loadMs = performance.now() - t0
    const version = py.runPython('import sys; sys.version.split()[0]')
    py.runPython('import heapq, linecache, traceback, threading, json, inspect\\nx = 0\\nfor i in range(100000): x += i')
    let evalBlocked = false
    try { new Function('return 1') } catch { evalBlocked = true }
    postMessage({ ok: true, loadMs, version, heapMB: py._module.HEAP8.buffer.byteLength / 1048576, evalBlocked, violations })
  } catch (e) {
    postMessage({ ok: false, error: String(e && e.stack || e), violations })
  }
}`
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.zip': 'application/zip', '.css': 'text/css' }
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const head = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }
  if (path === '/circuitoon/checkpoint.html') return void res.writeHead(200, { ...head, 'Content-Type': 'text/html' }).end('<!doctype html><title>checkpoint</title>')
  if (path === '/circuitoon/codeWorker-checkpoint.js') return void res.writeHead(200, { ...head, 'Content-Type': 'text/javascript', 'Content-Security-Policy': CSP }).end(WORKER)
  const file = join('dist', path.replace(/^\/circuitoon\//, ''))
  if (!existsSync(file)) return void res.writeHead(404).end()
  res.writeHead(200, { ...head, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file))
}).listen(port)

let failed = 0
const verdict = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`)
  if (!ok) failed++
}
const browser = await launchChrome()
const page = await (await browser.newContext()).newPage()
await page.goto(`http://localhost:${port}/circuitoon/checkpoint.html`)
const r = await page.evaluate(() => new Promise((res) => {
  const w = new Worker('/circuitoon/codeWorker-checkpoint.js', { type: 'module' })
  w.onmessage = (e) => res(e.data)
  w.onerror = (e) => res({ ok: false, error: e.message, violations: [] })
  w.postMessage('go')
}))
await browser.close()
server.close()
console.log(JSON.stringify(r, null, 2))
verdict(r.ok && r.evalBlocked && !r.violations.length, `1. Pyodide ${PY.version} loads under the CSP without 'unsafe-eval' (eval blocked: ${r.evalBlocked}; violations: ${r.violations?.join('; ') || 'none'})`)
verdict(r.ok && r.version === PY.python, `4. Python ${r.version} is the manifest's ${PY.python}`)

// 2. Served size, from the live site's compression rule (ruling R15).
const enc = {}
for (const [ext, f] of [['.wasm', 'sim/ngspice.wasm'], ['.mjs', 'sim/ngspice.mjs'], ['.json', 'sim/engine.json']]) {
  const res = await fetch(`https://mbarc.github.io/circuitoon/${f}`, { method: 'HEAD', headers: { 'Accept-Encoding': 'gzip' } })
  enc[ext] = res.headers.get('content-encoding') ?? 'identity'
}
let total = 0
for (const f of PY.files) {
  const bytes = readFileSync(join('node_modules/pyodide', f.name))
  const gz = enc[extname(f.name)] === 'gzip'
  const sent = gz ? gzipSync(bytes, { level: 6 }).length : bytes.length
  total += sent
  console.log(`  ${f.name}: ${(sent / 1048576).toFixed(2)} MB ${gz ? 'gzip' : 'raw'}`)
}
verdict(total <= 8 * 1048576, `2. first-Run transfer ${(total / 1048576).toFixed(2)} MB (budget 8 MB; Pages encodings ${JSON.stringify(enc)})`)
const cap = r.heapMB <= 120 ? 4 : 2
console.log(`3. heap ${r.heapMB?.toFixed(1)} MB per board: MAX_RUNNING = ${cap}; cold load ${r.loadMs?.toFixed(0)} ms`)
process.exit(failed ? 1 : 0)
