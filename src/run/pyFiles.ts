// The Python stand-ins as text (plan ruling R22): the host imports them (Vite bundles them into the
// site's run chunk and the CLI) and posts them to the worker, which writes them into Pyodide.
const raw = import.meta.glob('./py/**/*.py', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
export const PY_FILES: Record<string, string> = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.slice('./py/'.length), v]))
