import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Served from https://mbarc.github.io/circuitoon/, so every asset URL needs the subpath.
export default defineConfig({
  base: '/circuitoon/',
  plugins: [react()],
  // Correctness tests should not fail because the machine is busy (deploys run the whole suite,
  // often next to other heavy work). Speed is checked separately by the *.perf.test.ts budgets.
  test: { testTimeout: 30_000 },
})
