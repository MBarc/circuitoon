// The code worker's backstop (firmware spec 2.6). Before user code runs, the network, storage and
// worker constructors leave the worker's global scope and every prototype on its chain
// (WorkerGlobalScope.prototype and its relatives), so even code that reached the real global (it
// should not: jsglobals is curated) would find nothing to call.
export const SANDBOXED = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker'] as const

export function sandbox(scope: object): string[] {
  const removed: string[] = []
  for (let o: object | null = scope; o; o = Object.getPrototypeOf(o))
    for (const name of SANDBOXED) {
      if (!Object.getOwnPropertyDescriptor(o, name)) continue
      if (Reflect.deleteProperty(o, name)) removed.push(name)
      else {
        // Not configurable: shadow it on the scope itself instead.
        Object.defineProperty(scope, name, { value: undefined, configurable: false, writable: false })
        removed.push(name)
      }
    }
  return removed
}
