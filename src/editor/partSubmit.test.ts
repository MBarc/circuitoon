import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { FIELD_IDS, SUBMIT_TEMPLATE, submissionUrl, submitToLibrary } from './partSubmit.ts'

// Windows checkouts may store these files with CRLF line ends; the assertions are about content.
const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
const form = read(`.github/ISSUE_TEMPLATE/${SUBMIT_TEMPLATE}`)

describe('Submit to library', () => {
  it('opens the part submission form with the title, name and maker filled in', () => {
    const url = new URL(submissionUrl('INA219 breakout (CJMCU)', ' Adafruit 904 '))
    expect(url.origin + url.pathname).toBe('https://github.com/MBarc/circuitoon/issues/new')
    expect(Object.fromEntries(url.searchParams)).toEqual({ template: 'part-submission.yml', title: 'Part: INA219 breakout (CJMCU)', 'part-name': 'INA219 breakout (CJMCU)', maker: 'Adafruit 904' })
    expect(new URL(submissionUrl('X')).searchParams.has('maker')).toBe(false)
  })
  it('fills fields the issue form really has, by their ids', () => {
    for (const id of Object.values(FIELD_IDS)) expect(form).toMatch(new RegExp(`\\n    id: ${id}\\n`))
  })
  it('asks for the links and the part JSON, and the MIT licence confirmation', () => {
    const field = (id: string) => form.split(/\n  - type: /).find((b) => b.includes(`\n    id: ${id}\n`)) ?? ''
    expect(field('datasheets')).toMatch(/required: true/)
    expect(field('part-json')).toMatch(/required: true/)
    expect(field('photos')).toMatch(/required: false/)
    expect(field('licence')).toMatch(/MIT licence[\s\S]*required: true/)
    expect(/[–—]/.test(form)).toBe(false)
  })
})

describe('the import skill', () => {
  const skill = read('.claude/skills/circuitoon-import-part/SKILL.md')
  it('never puts submission text on a command line: comments go through a file', () => {
    const commands = [...skill.matchAll(/```bash\n([\s\S]*?)```/g)].flatMap((m) => m[1].split('\n'))
    for (const line of commands) expect(line, line).not.toMatch(/--(comment|body|title)[ =]/)
    expect(commands.some((l) => /gh issue comment \S+ --repo \S+ --body-file /.test(l))).toBe(true)
    expect(commands.some((l) => /^gh issue close /.test(l))).toBe(true)
    expect(skill).toMatch(/Submission text never goes on a command line/)
  })
})

describe('submitToLibrary', () => {
  const setup = (writeText: (t: string) => Promise<void>) => {
    const events: string[] = []
    vi.stubGlobal('window', { open: (url: string) => void events.push(`open ${url}`) })
    vi.stubGlobal('navigator', { clipboard: { writeText: (t: string) => (events.push('copy'), writeText(t)) } })
    vi.stubGlobal('document', { createElement: () => { throw new Error('no DOM') } })
    return events
  }
  afterEach(() => void vi.unstubAllGlobals())

  it('opens the form within the click, before a slow clipboard answers', async () => {
    let resolve = () => {}
    const events = setup(() => new Promise<void>((r) => (resolve = r)))
    const r = submitToLibrary('{"id":"custom-a"}', 'A')
    expect(events[0]).toBe(`open ${submissionUrl('A')}`)
    expect(r.url).toBe(submissionUrl('A'))
    resolve()
    expect(await r.copied).toBe(true)
  })
  it('still opens the form, and says the copy failed, when the clipboard is denied', async () => {
    const events = setup(() => Promise.reject(new Error('NotAllowedError')))
    const r = submitToLibrary('{}', 'A', 'Acme')
    expect(events[0]).toBe(`open ${submissionUrl('A', 'Acme')}`)
    expect(await r.copied).toBe(false)
  })
})
