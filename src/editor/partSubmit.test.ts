import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { FIELD_IDS, SUBMIT_TEMPLATE, submissionUrl } from './partSubmit.ts'

const form = readFileSync(`.github/ISSUE_TEMPLATE/${SUBMIT_TEMPLATE}`, 'utf8')

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
