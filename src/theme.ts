// The colour theme: Light, Dark, or System (follow the device, the default), remembered per browser.
// The choice is applied as data-theme="light" | "dark" on <html> (no attribute for System); the CSS
// reads it alongside prefers-color-scheme. index.html carries a tiny copy of applyTheme that runs
// before first paint, so the page never flashes the wrong theme; keep the two in step (theme.test.ts
// checks the key and colours it uses).
import { useEffect, useState } from 'react'

export type ThemeChoice = 'light' | 'dark' | 'system'
export type Theme = 'light' | 'dark'

export const THEME_KEY = 'circuitoon.theme'
/** The page background of each theme, for the browser's theme-color. */
export const THEME_COLOR: Record<Theme, string> = { light: '#E9EEE6', dark: '#1B1D20' }
const DARK_QUERY = '(prefers-color-scheme: dark)'

/** A stored value as a choice; anything unknown is System. */
export function parseChoice(v: unknown): ThemeChoice {
  return v === 'light' || v === 'dark' ? v : 'system'
}

/** The remembered choice. Storage can fail (private browsing, a disabled API): then System. */
export function loadThemeChoice(): ThemeChoice {
  try {
    return parseChoice(localStorage.getItem(THEME_KEY))
  } catch {
    return 'system'
  }
}

export function saveThemeChoice(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, choice)
  } catch {
    // Storage unavailable: the choice just won't outlast this page.
  }
}

/** Whether the device asks for dark. False where matchMedia is missing. */
export function osPrefersDark(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches
  } catch {
    return false
  }
}

/** The theme actually shown for a choice. */
export function effectiveTheme(choice: ThemeChoice, osDark = osPrefersDark()): Theme {
  return choice === 'system' ? (osDark ? 'dark' : 'light') : choice
}

/** System, then Light, then Dark, then System again: the toolbar button's cycle. */
export function nextChoice(choice: ThemeChoice): ThemeChoice {
  return choice === 'system' ? 'light' : choice === 'light' ? 'dark' : 'system'
}

/**
 * Sets data-theme on <html> (removed for System) and the theme-color metas: a forced theme sets
 * every one to its colour, System restores each to the colour of the scheme its media names.
 */
export function applyTheme(choice: ThemeChoice, doc: Document = document) {
  const root = doc.documentElement
  if (choice === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', choice)
  for (const m of doc.querySelectorAll('meta[name="theme-color"]')) {
    const scheme: Theme = (m.getAttribute('media') ?? '').includes('dark') ? 'dark' : 'light'
    m.setAttribute('content', THEME_COLOR[choice === 'system' ? scheme : choice])
  }
}

export const THEME_LABEL: Record<ThemeChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' }

// One shared store, so every switch on the page (and other tabs, through the storage event) agrees.
const listeners = new Set<() => void>()
let current: ThemeChoice | null = null

function getChoice(): ThemeChoice {
  if (current === null) current = loadThemeChoice()
  return current
}

export function setThemeChoice(choice: ThemeChoice) {
  current = choice
  saveThemeChoice(choice)
  applyTheme(choice)
  for (const l of listeners) l()
}

/**
 * The choice and the theme it shows, kept current when the choice changes (here or in another tab)
 * or when the device switches between light and dark under System.
 */
export function useTheme(): { choice: ThemeChoice; theme: Theme; setChoice: (c: ThemeChoice) => void } {
  const [choice, setChoice] = useState(getChoice)
  const [osDark, setOsDark] = useState(osPrefersDark)
  useEffect(() => {
    const sync = () => setChoice(getChoice())
    listeners.add(sync)
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_KEY && e.key !== null) return
      current = loadThemeChoice()
      applyTheme(current)
      for (const l of listeners) l()
    }
    window.addEventListener('storage', onStorage)
    let mq: MediaQueryList | null = null
    const onOs = () => setOsDark(osPrefersDark())
    try {
      mq = matchMedia(DARK_QUERY)
      mq.addEventListener('change', onOs)
    } catch {
      mq = null
    }
    sync()
    return () => {
      listeners.delete(sync)
      window.removeEventListener('storage', onStorage)
      mq?.removeEventListener('change', onOs)
    }
  }, [])
  return { choice, theme: effectiveTheme(choice, osDark), setChoice: setThemeChoice }
}
