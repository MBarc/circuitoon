import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/** The code worker's policy (firmware spec 2.6). public/coi-serviceworker.js sets the same on the built site. */
export const CODE_WORKER_CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'"
/** Cross-origin isolation for dev and preview (spec 2.5), so neither depends on the service worker. */
const ISOLATION = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }

/** Adds CODE_WORKER_CSP to the code worker's script in dev (`codeWorker.ts?worker_file`) and preview (`assets/codeWorker-<hash>.js`). */
export function codeWorkerCsp(): Plugin {
  const add = (req: { url?: string }, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    if (/\/codeWorker[^/?]*\.(js|ts)(\?|$)/.test(req.url ?? '')) res.setHeader('Content-Security-Policy', CODE_WORKER_CSP)
    next()
  }
  return {
    name: 'circuitoon-code-worker-csp',
    configureServer: (server) => void server.middlewares.use(add),
    configurePreviewServer: (server) => void server.middlewares.use(add),
  }
}

// Served from https://mbarc.github.io/circuitoon/, so every asset URL needs the subpath.
export default defineConfig({
  base: '/circuitoon/',
  plugins: [react(), codeWorkerCsp()],
  server: { headers: ISOLATION },
  preview: { headers: ISOLATION },
  // Correctness tests should not fail because the machine is busy (deploys run the whole suite,
  // often next to other heavy work). Speed is checked separately by the *.perf.test.ts budgets.
  test: { testTimeout: 30_000 },
})
