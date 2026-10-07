// Firmware spec 2.3, 3.1, 4.1, 5.3: run state lives in the store but never in the sheet: no undo
// entry, the file not marked changed. Code edits are undoable commits and typing coalesces. Serial
// keeps the last 5,000 lines. The solve key follows run pin states, and run-state solves continue
// during a drag; the netlist part of the key is cached by diagram identity.
import { describe, expect, it } from 'vitest'
import { EditorStore, SERIAL_MAX } from './store.ts'
import { setPartCode } from './ops.ts'
import { followStore, solveKey } from './simulation.ts'
import { runOrAsk } from './running.ts'
import { piBlink } from '../run/sheets.testing.ts'
import { clipText, copySelection, parseClip, pasteClip } from './clipboard.ts'

const code = { language: 'python-rpi', source: 'print(1)\n', file: 'main.py' }

describe('run state in the editor store', () => {
  it('keeps run state out of the sheet: no undo entry, not marked changed', () => {
    const s = new EditorStore(piBlink())
    s.setRun({ pins: { u1: { GPIO17: 'high' } }, seq: { u1: 3 } })
    s.setBoardRun('u1', { status: 'running', source: 'x', file: 'blink.py', serial: [], prompt: null, progress: null, message: null })
    expect([s.canUndo, s.dirty]).toEqual([false, false])
    expect(s.getState().run.pins).toEqual({ u1: { GPIO17: 'high' } })
    expect(s.activeRuns).toEqual(['u1'])
    s.setBoardRun('u1', null)
    expect(s.getState().run.boards).toEqual({})
  })
  it('keeps the last 5,000 Serial lines', () => {
    const s = new EditorStore(piBlink())
    s.setBoardRun('u1', { status: 'running', source: '', file: 'main.py', serial: [], prompt: null, progress: null, message: null })
    for (let i = 0; i < 6; i++) s.appendSerial('u1', Array.from({ length: 1000 }, (_, k) => ({ text: `${i * 1000 + k}`, stream: 'out' as const })))
    const serial = s.getState().run.boards.u1.serial
    expect(serial).toHaveLength(SERIAL_MAX)
    expect(serial[0].text).toBe('1000')
  })
  it('makes code edits undoable, typing coalescing into one step', () => {
    const s = new EditorStore(piBlink())
    const d0 = s.getState().diagram
    s.commit(setPartCode(d0, 'u1', { ...code, source: 'a' }), 'code:u1')
    s.commit(setPartCode(s.getState().diagram, 'u1', { ...code, source: 'ab' }), 'code:u1')
    expect(s.getState().diagram.parts.find((p) => p.uid === 'u1')?.code?.source).toBe('ab')
    s.undo()
    expect(s.getState().diagram).toBe(d0)
    expect(setPartCode(d0, 'u1', d0.parts.find((p) => p.uid === 'u1')!.code)).toBe(d0)
    const removed = setPartCode(d0, 'u1', undefined)
    expect('code' in removed.parts.find((p) => p.uid === 'u1')!).toBe(false)
  })
  it('remembers a link with code until the first Run is confirmed', () => {
    const s = new EditorStore(piBlink(), { linkCode: true })
    expect(s.getState().linkCode).toBe(true)
    s.confirmLinkCode()
    expect(s.getState().linkCode).toBe(false)
  })
  it("asks before any Run of code from a link, the Inspector's as the dock's (spec 2.6)", async () => {
    const s = new EditorStore(piBlink(), { linkCode: true })
    s.setDock({ open: false })
    runOrAsk(s, 'run', 'u1')
    expect(s.getState().dock).toMatchObject({ open: true, tab: 'u1', ask: { action: 'run', uid: 'u1' } })
    await new Promise((r) => setTimeout(r, 300))
    // The controller was never asked: it would have given the board a run view.
    expect(s.getState().run.boards).toEqual({})
    // Another tab or collapsing drops the question.
    s.setDock({ open: false })
    expect(s.getState().dock.ask).toBeNull()
  })
})

describe('the simulation follows run pin states (spec 2.3, 4.1)', () => {
  it('changes the solve key with run pin states and servo motion only', () => {
    const d = piBlink()
    expect(solveKey(d, null, { pins: { u1: { GPIO17: 'high' } }, moving: [], seq: {} })).not.toBe(solveKey(d, null, { pins: { u1: { GPIO17: 'low' } }, moving: [], seq: {} }))
    expect(solveKey(d, null, { pins: {}, moving: ['m1'], seq: {} })).not.toBe(solveKey(d, null, { pins: {}, moving: [], seq: {} }))
    // A re-setup alone (a new code sequence) re-solves: spec 4.4's read after setup waits for a result solved through that sequence.
    expect(solveKey(d, null, { pins: {}, moving: [], seq: { u1: 2 } })).not.toBe(solveKey(d, null, { pins: {}, moving: [], seq: { u1: 1 } }))
    expect(solveKey(d, null)).toBe(solveKey(d, null, { pins: {}, moving: [], seq: {} }))
  })
  it('requests a solve for a run-state change even mid-drag, and not for a plain drag frame', () => {
    const s = new EditorStore(piBlink())
    s.setSimulate(true)
    const calls: unknown[] = []
    const stop = followStore(s, (_d, _h, run) => calls.push(run.pins))
    expect(calls).toHaveLength(1)
    const base = s.begin()
    s.preview({ ...base, parts: base.parts.map((p) => (p.uid === 'd1' ? { ...p, x: p.x + 10 } : p)) })
    expect(calls).toHaveLength(1)
    s.setRun({ pins: { u1: { GPIO17: 'high' } } })
    expect(calls).toEqual([{}, { u1: { GPIO17: 'high' } }])
    s.end()
    stop()
  })
  it('requests a solve for a code sequence change alone, with the same pins (pre-flight C5)', () => {
    const s = new EditorStore(piBlink())
    s.setSimulate(true)
    s.setRun({ pins: { u1: { GPIO17: 'low' } }, seq: { u1: 1 } })
    const calls: { seq: Record<string, number>; moving: string[] }[] = []
    const stop = followStore(s, (_d, _h, run) => calls.push({ seq: run.seq, moving: run.moving }))
    s.setRun({ seq: { u1: 2 } })
    s.setRun({ moving: ['m1'] })
    expect(calls).toEqual([{ seq: { u1: 1 }, moving: [] }, { seq: { u1: 2 }, moving: [] }, { seq: { u1: 2 }, moving: ['m1'] }])
    stop()
  })
})

describe('copy, paste and duplicate keep a board\'s code (spec 3.1)', () => {
  it('carries the code key through the clip text into the pasted part', () => {
    const d = piBlink()
    const clip = parseClip(clipText(copySelection(d, { parts: ['u1'], wires: [] })!))!
    const { diagram, selection } = pasteClip(d, clip, 10, 10)
    expect(diagram.parts.find((p) => p.uid === selection.parts[0])?.code).toEqual(d.parts.find((p) => p.uid === 'u1')!.code)
  })
})
