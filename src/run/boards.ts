// Which modules run code (firmware spec 3.2, this slice: the Raspberry Pis) and how their pins are
// named: header GPIO pins are holes called GPIO<bcm>.
import type { ModuleDef } from '../format/module.ts'

export type BoardKind = 'pi4' | 'pi5' | 'zero2w'
export const BOARD_KINDS: Record<string, BoardKind> = { 'rpi-4-model-b': 'pi4', 'rpi-5': 'pi5', 'rpi-zero-2-w': 'zero2w' }
export const boardKindOf = (m: ModuleDef | undefined): BoardKind | null => (m && Object.hasOwn(BOARD_KINDS, m.id) ? BOARD_KINDS[m.id] : null)
export const gpioPin = (bcm: number): string => `GPIO${bcm}`
export function bcmOf(pin: string): number | null {
  const m = /^GPIO(\d+)$/.exec(pin)
  return m ? Number(m[1]) : null
}
