// Shared by the browser checks (check-link-ui, check-annotations-ui, check-examples): serve the built
// site with `vite preview`, launch the locally installed Chrome through playwright-core (never the
// shared Playwright MCP browser), read flags, and count failures.
import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)

/** The value after `name` on the command line, or `fallback`. */
export function flagOf(name, fallback) {
  const i = args.indexOf(name)
  return i < 0 ? fallback : args[i + 1]
}

/** Starts `vite preview` on `port` (stopped when the process exits) and waits until it answers. */
export async function startPreview(port) {
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

/**
 * Exports through the toolbar's Export JSON and the naming dialog (see `noSavePicker`), typing
 * `name` as the file name when given, and returns the download.
 */
export async function exportDownload(page, name) {
  await page.getByRole('button', { name: 'Export JSON' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export JSON' })
  if (name !== undefined) await dialog.getByLabel('File name').fill(name)
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Export', exact: true }).click()])
  return download
}
