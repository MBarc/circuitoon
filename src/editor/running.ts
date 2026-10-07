// What Run needs (firmware spec 2.1, 2.5), and the actions that load the run controller on first use,
// so Pyodide's loader, the workers and RunCore stay out of the main bundle (spec 2.7).
import { RUNNABLE, languageName, languagesOf } from '../format/code.ts'
import { withLibraryData } from '../format/simModel.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { MAX_RUNNING } from '../run/limits.ts'
import type { EditorState, EditorStore } from './store.ts'

export const ISOLATION_OFF = 'Running code needs a browser feature this window has turned off (service workers). Try a normal window.'
export const RELOAD_FIRST = 'Reload the page to run code (save your work first).'
export const capText = (n: number): string => `Stop a board first: at most ${n} run at once`

const browserEnv = () => ({ isolated: globalThis.crossOriginIsolated === true, serviceWorkers: typeof navigator !== 'undefined' && 'serviceWorker' in navigator })

/** Boards on the sheet that have code, in sheet order. */
export const codeBoards = (s: EditorState): string[] => s.diagram.parts.filter((p) => p.code).map((p) => p.uid)

/** Why Run cannot start on `uid` now, in plain words, or null. */
export function runBlocker(s: EditorState, uid: string, env = browserEnv()): string | null {
  if (!env.isolated) return env.serviceWorkers ? RELOAD_FIRST : ISOLATION_OFF
  const part = s.diagram.parts.find((p) => p.uid === uid)
  if (!part?.code) return 'Add code to a board first.'
  const stored = s.diagram.modules[part.module]
  const m = stored && withLibraryData(stored, libraryLookup)
  if (!RUNNABLE.includes(part.code.language) || !languagesOf(m).includes(part.code.language)) return `${part.designator} cannot run ${languageName(part.code.language)}.`
  const others = Object.entries(s.run.boards).filter(([u, b]) => u !== uid && (b.status === 'starting' || b.status === 'running')).length
  return others >= MAX_RUNNING ? capText(MAX_RUNNING) : null
}

type Action = 'run' | 'stop' | 'reset' | 'line' | 'runAll' | 'stopAll'
/** Loads the controller (once) and does `action`. */
export function runAction(store: EditorStore, action: Action, uid = '', line = ''): void {
  void import('./runEngine.ts').then(({ controllerFor }) => {
    const c = controllerFor(store)
    if (action === 'run') void c.run(uid)
    else if (action === 'stop') void c.stop(uid)
    else if (action === 'reset') void c.reset(uid)
    else if (action === 'line') c.sendLine(uid, line)
    else if (action === 'runAll') void c.runAll()
    else void c.stopAll()
  })
}

/** Run or Run all, from the dock or the Inspector: code that came with a link asks first, in the dock (spec 2.6). */
export function runOrAsk(store: EditorStore, action: 'run' | 'runAll', uid: string): void {
  if (store.getState().linkCode) store.setDock({ open: true, tab: uid, ask: { action, uid } })
  else runAction(store, action, uid)
}

/** Stops every board when the editor closes (only if the controller was ever loaded). */
export function disposeRuns(store: EditorStore): void {
  if (store.activeRuns.length || Object.keys(store.getState().run.boards).length) void import('./runEngine.ts').then(({ controllerFor }) => controllerFor(store).dispose())
}
