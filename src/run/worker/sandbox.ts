// The code worker's backstop (firmware spec 2.6). Before user code runs, the network, storage and
// worker constructors leave the worker's global scope and every prototype on its chain
// (WorkerGlobalScope.prototype and its relatives), and site storage (OPFS, which the CSP does not
// cover) leaves navigator, so even code that reached the real global (it should not: jsglobals is
// curated) would find nothing to call.
export const SANDBOXED = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker'] as const

/** Removes `names` from `target` and its prototype chain; a name that will not go is shadowed on `target`. */
function strip(target: object, names: readonly string[]): string[] {
  const removed: string[] = []
  for (let o: object | null = target; o; o = Object.getPrototypeOf(o))
    for (const name of names) {
      if (!Object.getOwnPropertyDescriptor(o, name)) continue
      if (!Reflect.deleteProperty(o, name)) Object.defineProperty(target, name, { value: undefined, configurable: false, writable: false })
      removed.push(name)
    }
  return removed
}

export function sandbox(scope: object): string[] {
  const nav = (scope as { navigator?: object }).navigator
  return [...strip(scope, SANDBOXED), ...(nav ? strip(nav, ['storage']).map((n) => `navigator.${n}`) : [])]
}

/**
 * No code from strings (firmware spec 2.6): a JS function's constructor (Function, and its async and
 * generator relatives) would evaluate text in the worker's global scope. In the browser the CSP
 * refuses it; in Node nothing does, so every one of them throws. Call once Pyodide has loaded.
 */
export function noCodeGeneration(): void {
  const refuse = function () {
    throw new EvalError('Code generation is disabled in the simulator')
  }
  for (const f of [function () {}, async function () {}, function* () {}, async function* () {}])
    Object.defineProperty(Object.getPrototypeOf(f), 'constructor', { value: refuse, writable: false, configurable: false })
}
