// The circuitoon CLI bundle (agent toolkit spec 4.1): an SSR build of src/cli/main.ts into one ES
// module for Node 22+. Everything is bundled (React, react-dom/server, and modules/*.json through
// the same import.meta.glob catalog the site uses, resolved at build time); only Node built-ins stay
// external. Unminified, so the committed file diffs readably. scripts/gen-cli.mjs runs it.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: 'src/cli/main.ts',
    outDir: 'plugin/dist-cli',
    emptyOutDir: false,
    copyPublicDir: false,
    target: 'node22',
    minify: false,
    sourcemap: false,
    rolldownOptions: { output: { format: 'es', entryFileNames: 'circuitoon.mjs', codeSplitting: false } },
  },
})
