// Firmware spec 5.3, 6.1, 6.2, 6.4: uploads are refused with the reason (over 256 KB, not UTF-8, an
// extension that does not fit the language); downloads are named <file> or <designator>.py; Write
// code starts from a short starter comment; traceback lines link to the script's own lines; Serial
// announces new lines (throttled by the panel).
import { describe, expect, it } from 'vitest'
import { SOURCE_MAX_BYTES } from '../format/code.ts'
import { announcement, downloadName, lineRef, readCodeFile, starterCode } from './codeFile.ts'

const enc = (s: string) => new TextEncoder().encode(s)

describe('code files (spec 6.2)', () => {
  it('reads a .py file as UTF-8 and keeps its name', () => {
    expect(readCodeFile('blink.py', enc('print("hé")\n'), 'python-rpi')).toEqual({ ok: true, code: { language: 'python-rpi', source: 'print("hé")\n', file: 'blink.py' } })
  })
  it('refuses with the reason', () => {
    expect(readCodeFile('blink.ino', enc('void setup(){}'), 'python-rpi')).toEqual({ ok: false, why: 'blink.ino is not Raspberry Pi Python code: it needs a .py file' })
    expect(readCodeFile('big.py', new Uint8Array(SOURCE_MAX_BYTES + 1), 'python-rpi')).toEqual({ ok: false, why: 'big.py is over 256 KB' })
    expect(readCodeFile('bad.py', new Uint8Array([0xff, 0xfe, 0x41]), 'python-rpi')).toEqual({ ok: false, why: 'bad.py is not UTF-8 text' })
  })
  it('names downloads after the file, else the designator', () => {
    expect(downloadName({ language: 'python-rpi', source: '', file: 'blink.py' }, 'U1')).toBe('blink.py')
    expect(downloadName({ language: 'python-rpi', source: '' }, 'U1')).toBe('U1.py')
  })
  it('starts Write code from a comment that says what works', () => {
    const s = starterCode('U1', 'Raspberry Pi 4 Model B')
    expect(s.split('\n').every((l) => l === '' || l.startsWith('#'))).toBe(true)
    expect(s).toContain('from gpiozero import LED')
  })
})

describe('Serial (spec 5.3, 6.4)', () => {
  it('finds the script line a traceback names, and only the script\'s', () => {
    expect(lineRef('  File "blink.py", line 12, in <module>', 'blink.py')).toEqual({ before: '  ', ref: 'File "blink.py", line 12', line: 12, after: ', in <module>' })
    expect(lineRef('  File "/lib/x.py", line 3', 'blink.py')).toBeNull()
  })
  it('announces the lines since the last announcement, at most the last three', () => {
    const lines = ['a', 'b', 'c', 'd'].map((text) => ({ text, stream: 'out' as const }))
    expect(announcement(lines, 0)).toBe('b. c. d')
    expect(announcement(lines, 3)).toBe('d')
    expect(announcement(lines, 4)).toBe('')
  })
})
