// The Claude Code plugin packaging (spec 9): the repo marketplace lists one plugin whose folder holds
// its manifest, the circuitoon-design skill, the bin and the bundle; the repo-internal skills stay
// out; nothing shipped contains an em or en dash.
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))

describe('plugin packaging', () => {
  it('lists the plugin in the repo marketplace, sourced from plugin/', () => {
    const m = json('.claude-plugin/marketplace.json')
    expect(m.name).toBe('circuitoon')
    expect(m.owner.name).toBe('MBarc')
    expect(m.plugins).toHaveLength(1)
    expect(m.plugins[0]).toMatchObject({ name: 'circuitoon', source: './plugin' })
  })
  it('ships the manifest, the design skill, the bin and the bundle, and nothing repo-internal', () => {
    const p = json('plugin/.claude-plugin/plugin.json')
    expect(p.name).toBe('circuitoon')
    expect(p.version).toBe(json('package.json').version)
    expect(json('.claude-plugin/marketplace.json').plugins[0].version).toBe(p.version)
    expect(readdirSync('plugin/skills')).toEqual(['circuitoon-design'])
    expect(readFileSync('plugin/skills/circuitoon-design/SKILL.md', 'utf8')).toMatch(/^---\r?\nname: circuitoon-design\r?\ndescription: .+\r?\n---\r?\n/)
    for (const f of ['plugin/bin/circuitoon.mjs', 'plugin/dist-cli/circuitoon.mjs']) expect(existsSync(f), f).toBe(true)
  })
  it('has no em or en dashes in anything it ships (the third-party bundle aside)', () => {
    for (const f of [...walk('plugin').filter((f) => !f.includes('dist-cli')), '.claude-plugin/marketplace.json']) {
      const text = readFileSync(f, 'utf8')
      expect(/[\u2013\u2014]/.test(text), f).toBe(false)
    }
  })
})
