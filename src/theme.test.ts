import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { THEME_COLOR, THEME_KEY, applyTheme, effectiveTheme, loadThemeChoice, nextChoice, parseChoice, saveThemeChoice, type ThemeChoice } from './theme.ts'

const g = globalThis as { localStorage?: unknown }
function fakeStorage() {
  const m = new Map<string, string>()
  g.localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
  return m
}
afterEach(() => {
  delete g.localStorage
})

/** A stand-in for <html> and its theme-color metas, enough for applyTheme. */
function fakeDoc() {
  const attrs = (init: Record<string, string>) => {
    const a = new Map(Object.entries(init))
    return {
      a,
      getAttribute: (k: string) => a.get(k) ?? null,
      setAttribute: (k: string, v: string) => void a.set(k, v),
      removeAttribute: (k: string) => void a.delete(k),
    }
  }
  const root = attrs({})
  const light = attrs({ name: 'theme-color', media: '(prefers-color-scheme: light)', content: THEME_COLOR.light })
  const dark = attrs({ name: 'theme-color', media: '(prefers-color-scheme: dark)', content: THEME_COLOR.dark })
  const doc = { documentElement: root, querySelectorAll: () => [light, dark] } as unknown as Document
  return { doc, root: root.a, light: light.a, dark: dark.a }
}

describe('theme choice', () => {
  it('parses stored values, anything unknown being System', () => {
    expect(parseChoice('light')).toBe('light')
    expect(parseChoice('dark')).toBe('dark')
    for (const v of ['system', null, undefined, '', 'Dark', 'blue', 1]) expect(parseChoice(v)).toBe('system')
  })
  it('is System by default, remembers Light and Dark, and forgets on System', () => {
    const m = fakeStorage()
    expect(loadThemeChoice()).toBe('system')
    saveThemeChoice('dark')
    expect(m.get(THEME_KEY)).toBe('dark')
    expect(loadThemeChoice()).toBe('dark')
    saveThemeChoice('light')
    expect(loadThemeChoice()).toBe('light')
    saveThemeChoice('system')
    expect(m.has(THEME_KEY)).toBe(false)
    expect(loadThemeChoice()).toBe('system')
  })
  it('never throws when storage is missing or refuses', () => {
    expect(loadThemeChoice()).toBe('system')
    g.localStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('full') }, removeItem: () => { throw new Error('denied') } }
    expect(loadThemeChoice()).toBe('system')
    expect(() => saveThemeChoice('dark')).not.toThrow()
  })
  it('System follows the device; Light and Dark ignore it', () => {
    expect(effectiveTheme('system', true)).toBe('dark')
    expect(effectiveTheme('system', false)).toBe('light')
    expect(effectiveTheme('light', true)).toBe('light')
    expect(effectiveTheme('dark', false)).toBe('dark')
    // No matchMedia (Node): System is light.
    expect(effectiveTheme('system')).toBe('light')
  })
  it('cycles System, Light, Dark', () => {
    const seen: ThemeChoice[] = ['system']
    for (let i = 0; i < 3; i++) seen.push(nextChoice(seen[seen.length - 1]))
    expect(seen).toEqual(['system', 'light', 'dark', 'system'])
  })
})

describe('applyTheme', () => {
  it('sets data-theme and every theme-color for a forced theme, and restores both for System', () => {
    const { doc, root, light, dark } = fakeDoc()
    applyTheme('dark', doc)
    expect(root.get('data-theme')).toBe('dark')
    expect([light.get('content'), dark.get('content')]).toEqual([THEME_COLOR.dark, THEME_COLOR.dark])
    applyTheme('light', doc)
    expect(root.get('data-theme')).toBe('light')
    expect([light.get('content'), dark.get('content')]).toEqual([THEME_COLOR.light, THEME_COLOR.light])
    applyTheme('system', doc)
    expect(root.has('data-theme')).toBe(false)
    expect([light.get('content'), dark.get('content')]).toEqual([THEME_COLOR.light, THEME_COLOR.dark])
  })
})

describe('index.html keeps in step with theme.ts', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  // The theme script, not the isolation config that comes first in <head> (src/isolation.test.ts).
  const script = [...html.matchAll(/<script>(.*?)<\/script>/gs)].map((m) => m[1]).find((s) => s.includes('localStorage')) ?? ''
  it('applies the stored choice before the app loads, with the same key and colours', () => {
    expect(html.indexOf(script)).toBeLessThan(html.indexOf('src="/src/main.tsx"'))
    expect(script).toContain(`'${THEME_KEY}'`)
    expect(script).toContain(THEME_COLOR.light)
    expect(script).toContain(THEME_COLOR.dark)
  })
  it('names the same colours in its theme-color metas', () => {
    expect(html).toContain(`content="${THEME_COLOR.light}" media="(prefers-color-scheme: light)"`)
    expect(html).toContain(`content="${THEME_COLOR.dark}" media="(prefers-color-scheme: dark)"`)
  })
  it('runs the inline script against a fake page: the attribute and metas follow the stored choice', () => {
    for (const stored of ['dark', 'light', 'system', null]) {
      const { doc, root, light, dark } = fakeDoc()
      const storage = { getItem: () => stored }
      new Function('localStorage', 'document', script)(storage, doc)
      const forced = stored === 'dark' || stored === 'light' ? stored : null
      expect(root.get('data-theme') ?? null).toBe(forced)
      expect(light.get('content')).toBe(forced ? THEME_COLOR[forced] : THEME_COLOR.light)
      expect(dark.get('content')).toBe(forced ? THEME_COLOR[forced] : THEME_COLOR.dark)
    }
  })
})
