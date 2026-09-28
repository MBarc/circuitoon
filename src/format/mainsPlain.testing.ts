// The plain references for the differential tests (see plainPath in mainsGraph.ts): the state analysis
// and rules 2 and 3 as they were before the Task 11 optimisations, over the node lists and edge objects
// directly, with no shortcut. Test-only: importing this module registers them, so the production
// bundle never carries them (final review 4). mains.testing.ts imports it.
import { type Prepared, MAINS_POW, bitOf, find, flow, markBareRoots, plainPath, union } from './mainsGraph.ts'
import { type Acc, CONDS, crossDraft, identityKeys, mark, report, shortDraft } from './mainsRules.ts'
import type { Conductor } from './mainsModel.ts'

/** analyseState without the flattened plan: over the node lists and edge objects directly. The reference for the differential tests. */
function analyseStatePlain(p: Prepared): void {
  const { g } = p
  for (const i of p.relevant) {
    p.parent[i] = p.base[i]
    p.bareParent[i] = p.bareBase[i]
    if (p.anyAbsent) p.fitParent[i] = p.fitBase[i]
  }
  for (const gi of p.groupIdx)
    for (const [a, b] of g.groups[gi].closed[p.groupState[gi]]) {
      if (!p.inRel[a] || !p.inRel[b]) continue
      union(p.parent, a, b)
      union(p.bareParent, a, b)
      if (p.anyAbsent) union(p.fitParent, a, b)
    }
  for (const i of p.relevant) {
    p.root[i] = find(p.parent, i)
    p.bareRoot[i] = find(p.bareParent, i)
    if (p.anyAbsent) p.fitRoot[i] = find(p.fitParent, i)
    p.ident[i] = 0
    p.power[i] = 0
  }
  p.srcRoots.length = 0
  for (const s of p.sources) {
    const put = (nodes: number[], c: Conductor) => {
      for (const x of nodes) {
        const r = p.root[x]
        if (!p.ident[r]) p.srcRoots.push(r)
        p.ident[r] |= bitOf(s.index, c)
      }
    }
    put(s.live, 'L')
    put(s.neutral, 'N')
    put(s.earth, 'PE')
    for (const x of s.live) p.power[p.root[x]] |= (1 << s.index) | MAINS_POW
    for (const x of s.neutral) p.power[p.root[x]] |= (1 << s.index) | MAINS_POW
  }
  for (let changed = true; changed; ) {
    changed = false
    for (const e of p.energy) if (flow(p.root, p.power, e.a, e.b, e.directed)) changed = true
    for (const gi of p.groupIdx) for (const [a, b] of g.groups[gi].leak[p.groupState[gi]]) if (p.inRel[a] && p.inRel[b] && flow(p.root, p.power, a, b, false)) changed = true
  }
  markBareRoots(p)
}

/** Rules 2 and 3 over every source pair of every root: the reference for identityRules (see plainPath). */
function identityRulesPlain(acc: Acc, mask: number) {
  const { p } = acc
  const src = p.sources
  const n = src.length
  const keys = identityKeys(p)
  for (let q = 0; q < p.srcRoots.length; q++) {
    const r = p.srcRoots[q]
    const x = p.ident[r]
    for (let i = 0; i < n; i++) {
      const s = src[i]
      const sb = s.index * 3
      if (!((x >>> sb) & 7)) continue
      if ((x >>> sb) & 1) {
        if ((x >>> (sb + 1)) & 1 && !mark(acc, keys.short[i][0], mask)) report(acc, keys.short[i][0], mask, () => shortDraft(p, r, s, 'N'))
        if ((x >>> (sb + 2)) & 1 && !mark(acc, keys.short[i][1], mask)) report(acc, keys.short[i][1], mask, () => shortDraft(p, r, s, 'PE'))
      }
      for (let j = 0; j < n; j++) {
        const t = src[j]
        if (t.index <= s.index) continue
        const tb = t.index * 3
        if (!((x >>> tb) & 7)) continue
        for (let a = 0; a < 3; a++) {
          if (!((x >>> (sb + a)) & 1)) continue
          for (let b = 0; b < 3; b++) {
            if (!((x >>> (tb + b)) & 1) || (a === 2 && b === 2)) continue
            const key = keys.cross[(i * n + j) * 9 + a * 3 + b]
            if (!mark(acc, key, mask)) report(acc, key, mask, () => crossDraft(p, r, s, CONDS[a], t, CONDS[b]))
          }
        }
      }
    }
  }
}

plainPath.analyseState = analyseStatePlain
plainPath.identityRules = identityRulesPlain
