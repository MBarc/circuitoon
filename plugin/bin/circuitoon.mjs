#!/usr/bin/env node
// The circuitoon CLI (agent toolkit spec 4.1). Checks for Node 22 or newer, then runs the bundled
// CLI in ../dist-cli/circuitoon.mjs (built from src/cli by `npm run build:cli` in the Circuitoon repo).
const major = Number(process.versions.node.split('.')[0])
if (major < 22) {
  process.stderr.write(`circuitoon needs Node 22 or newer; this is Node ${process.versions.node}.\n`)
  process.exit(3)
}
const { run } = await import('../dist-cli/circuitoon.mjs')
process.exitCode = await run(process.argv.slice(2))
