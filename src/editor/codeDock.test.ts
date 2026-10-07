// Firmware spec 2.1, 6.1: the dock's tabs and each tab's status, "Code changed" while a run uses older code.
import { describe, expect, it } from 'vitest'
import { dockTabs, tabStatus } from './CodeDock.tsx'
import { EditorStore } from './store.ts'
import { setPartCode } from './ops.ts'
import { piBlink } from '../run/sheets.testing.ts'

const run = (status: 'starting' | 'running' | 'error', source: string) => ({ status, source, file: 'main.py', serial: [], prompt: null, progress: null, message: null })

describe('the code dock', () => {
  it('says "Code changed" only while a live run uses other code', () => {
    const code = { language: 'python-rpi', source: 'a' }
    expect(tabStatus(undefined, code)).toEqual({ key: 'idle', text: 'Not running' })
    expect(tabStatus(run('running', 'a'), code).key).toBe('running')
    expect(tabStatus(run('running', 'b'), code)).toEqual({ key: 'changed', text: 'Code changed' })
    expect(tabStatus(run('starting', 'b'), code).key).toBe('changed')
    expect(tabStatus(run('error', 'b'), code).key).toBe('error')
  })
  it('has a tab per coded board, plus the board being written', () => {
    const s = new EditorStore(piBlink())
    expect(dockTabs(s.getState())).toEqual(['u1'])
    s.commit(setPartCode(s.getState().diagram, 'u1', undefined))
    expect(dockTabs(s.getState())).toEqual([])
    s.setDock({ tab: 'u1' })
    expect(dockTabs(s.getState())).toEqual(['u1'])
    s.setDock({ tab: 'gone' })
    expect(dockTabs(s.getState())).toEqual([])
  })
  it('keeps the tab of a board still running after its code is removed, so it can be stopped', () => {
    const s = new EditorStore(piBlink())
    s.commit(setPartCode(s.getState().diagram, 'u1', undefined))
    s.setBoardRun('u1', run('running', 'a'))
    expect(dockTabs(s.getState())).toEqual(['u1'])
    s.setBoardRun('u1', { status: 'stopped' })
    expect(dockTabs(s.getState())).toEqual([])
  })
  it('forgets the board being written when another sheet is opened', () => {
    const s = new EditorStore(piBlink())
    const plain = setPartCode(s.getState().diagram, 'u1', undefined)
    s.setDock({ tab: 'u1' })
    s.load(plain)
    expect(dockTabs(s.getState())).toEqual([])
  })
})
