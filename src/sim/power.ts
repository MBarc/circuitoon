// Boards and modules with electrical.sim.power (Task 11 fills this in).
import type { Diagram, PartInstance } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'
import type { Builder } from './build.ts'

export function powerPart(b: Builder, p: PartInstance, _m: ModuleDef): void {
  b.skip(p.uid, 'power models arrive in Task 11')
}
export function usbLinks(_b: Builder, _d: Diagram): void {}
