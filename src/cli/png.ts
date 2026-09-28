// PNG output for the CLI (agent toolkit spec 4.1): the standalone SVG screenshotted by an installed
// Chrome or Edge in headless mode, with a throwaway profile so it never touches a running browser.
// The spec's playwright-core route is replaced by driving the browser directly (Ruling T1, amendment
// A16): a plugin install has no node_modules, and this needs none. No browser found is an environment
// problem (exit 3) with install guidance and --svg offered.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Longest PNG side, in px; a larger sheet is rendered at a smaller scale. */
export const PNG_MAX_SIDE = 8000
export const NO_BROWSER =
  'No Chrome or Edge found for PNG output. Install Google Chrome (https://www.google.com/chrome/) or Microsoft Edge, or set CIRCUITOON_BROWSER to the browser executable; or use --svg <file> for SVG output, which needs no browser.'

type Env = Record<string, string | undefined>

/** Where Chrome and Edge install on this platform, most likely first. */
export function browserCandidates(env: Env, platform: string = process.platform): string[] {
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter((r): r is string => !!r)
    return roots.flatMap((r) => [join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'), join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')])
  }
  if (platform === 'darwin')
    return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable']
}

/** CIRCUITOON_BROWSER when set (null when that file is missing), else the first installed candidate. */
export function findBrowser(env: Env, platform: string = process.platform): string | null {
  const own = env.CIRCUITOON_BROWSER
  if (own !== undefined) return own && existsSync(own) ? own : null
  return browserCandidates(env, platform).find((p) => existsSync(p)) ?? null
}

/** Width and height from a PNG's IHDR; null when the bytes are not a PNG. */
function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/**
 * Screenshots the SVG at `scale` (lowered so no side passes PNG_MAX_SIDE) into `out`. The size
 * reported is the one the PNG's header states, never a computed guess.
 */
export function writePng(svg: { svg: string; width: number; height: number }, scale: number, out: string, env: Env): { ok: true; width: number; height: number } | { ok: false; message: string } {
  const browser = findBrowser(env)
  if (!browser) return { ok: false, message: NO_BROWSER }
  const s = Math.min(scale, PNG_MAX_SIDE / Math.max(svg.width, svg.height))
  const dir = mkdtempSync(join(tmpdir(), 'circuitoon-png-'))
  try {
    const page = join(dir, 'sheet.html')
    writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:#ffffff}svg{display:block}</style></head><body>${svg.svg}</body></html>`)
    mkdirSync(dirname(out), { recursive: true })
    rmSync(out, { force: true })
    const r = spawnSync(
      browser,
      [
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
        `--user-data-dir=${join(dir, 'profile')}`, `--force-device-scale-factor=${s}`, `--window-size=${svg.width},${svg.height}`,
        `--screenshot=${out}`, pathToFileURL(page).href,
      ],
      { timeout: 120_000, stdio: 'ignore' },
    )
    const size = existsSync(out) ? pngSize(readFileSync(out)) : null
    if (!size) {
      rmSync(out, { force: true })
      return { ok: false, message: `${browser} did not write ${out} (${r.error?.message ?? `exit ${r.status}`}). Try again, or use --svg <file>.` }
    }
    return { ok: true, ...size }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
