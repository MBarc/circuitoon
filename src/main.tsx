import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './styles.css'
import { applyTheme, loadThemeChoice } from './theme.ts'

// index.html applies the stored theme before first paint; this keeps the page right if it did not run.
applyTheme(loadThemeChoice())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
