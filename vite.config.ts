import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Served from https://mbarc.github.io/circuitoon/, so every asset URL needs the subpath.
export default defineConfig({
  base: '/circuitoon/',
  plugins: [react()],
})
