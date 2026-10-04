// A strict reader for KiCad's S-expression netlist (.net, version "E"), standing in for kicad-cli,
// which is not installed here. Tokens follow KiCad's DSN lexer: "(" and ")", quoted strings (with
// \" \\ and \n escapes; KiCad writes every value quoted) and bare symbols. Anything else (an
// unterminated string, a stray ")", text after the closing parenthesis) is an error. `checkKicadNetlist`
// then checks the tree against what Pcbnew's KICAD_NETLIST_PARSER reads (pcbnew/netlist_reader/
// kicad_netlist_reader.cpp): the sections, each component's ref, value, footprint (a "Lib:Name" id),
// sheetpath and tstamps, and each net's code, name and nodes. Test helper.

export type Sexpr = string | Sexpr[]
/** A quoted string keeps its quotes off but is marked, so `(ref "R1")` and `(ref R1)` can be told apart. */
export class Quoted extends String {}

export function parseSexpr(text: string): Sexpr[] {
  const stack: Sexpr[][] = [[]]
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (/\s/.test(c)) {
      i++
    } else if (c === '(') {
      const list: Sexpr[] = []
      stack[stack.length - 1].push(list)
      stack.push(list)
      i++
    } else if (c === ')') {
      if (stack.length === 1) throw new Error(`unbalanced ")" at offset ${i}`)
      stack.pop()
      i++
    } else if (c === '"') {
      let s = ''
      i++
      for (;;) {
        if (i >= text.length) throw new Error('unterminated string')
        const ch = text[i]
        if (ch === '\\') {
          const next = text[i + 1]
          if (next === '"' || next === '\\') s += next
          else if (next === 'n') s += '\n'
          else throw new Error(`unknown escape \\${next} at offset ${i}`)
          i += 2
        } else if (ch === '"') {
          i++
          break
        } else if (ch === '\n') {
          throw new Error(`line break inside a string at offset ${i}`)
        } else {
          s += ch
          i++
        }
      }
      stack[stack.length - 1].push(new Quoted(s) as unknown as string)
    } else {
      const m = /^[^\s()"]+/.exec(text.slice(i))!
      stack[stack.length - 1].push(m[0])
      i += m[0].length
    }
  }
  if (stack.length !== 1) throw new Error(`${stack.length - 1} unclosed "("`)
  return stack[0]
}

const isList = (x: Sexpr): x is Sexpr[] => Array.isArray(x)
const head = (x: Sexpr): string | undefined => (isList(x) && typeof x[0] === 'string' ? String(x[0]) : undefined)
const children = (x: Sexpr[], name: string): Sexpr[][] => x.filter((c): c is Sexpr[] => isList(c) && head(c) === name)
/** The one value of `(name "value")` inside `x`, which must be a quoted string. */
function value(x: Sexpr[], name: string, at: string): string {
  const found = children(x, name)
  if (found.length !== 1) throw new Error(`${at}: expected one (${name} ...), found ${found.length}`)
  const v = found[0]
  if (v.length !== 2 || !(v[1] instanceof Quoted)) throw new Error(`${at}: (${name} ...) must hold one quoted string`)
  return String(v[1])
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** LIB_ID::Parse: a nickname, a colon and a name, no spaces or quotes. */
const LIB_ID = /^[^\s:"]+:[^\s:"]+$/

export interface ParsedNetlist {
  comps: { ref: string; value: string; footprint: string; lib: string; part: string; uuid: string }[]
  nets: { code: number; name: string; nodes: { ref: string; pin: string; pinfunction: string; pintype: string }[] }[]
  libparts: { lib: string; part: string; pins: string[] }[]
}

/** Parses and checks a KiCad netlist; throws naming the first thing Pcbnew would refuse or misread. */
export function checkKicadNetlist(text: string): ParsedNetlist {
  const top = parseSexpr(text)
  if (top.length !== 1 || head(top[0]) !== 'export') throw new Error('the file must be one (export ...)')
  const root = top[0] as Sexpr[]
  if (value(root, 'version', 'export') !== 'E') throw new Error('version must be "E"')
  for (const c of root.slice(1)) {
    const h = head(c)
    if (!h || !['version', 'design', 'components', 'libparts', 'libraries', 'nets'].includes(h)) throw new Error(`export: unexpected ${h ?? JSON.stringify(c)}`)
  }
  const sections = (name: string) => {
    const s = children(root, name)
    if (s.length !== 1) throw new Error(`export: expected one (${name} ...), found ${s.length}`)
    return s[0]
  }
  const comps: ParsedNetlist['comps'] = []
  for (const c of sections('components').slice(1)) {
    if (head(c) !== 'comp') throw new Error(`components: unexpected ${head(c)}`)
    const comp = c as Sexpr[]
    const ref = value(comp, 'ref', 'comp')
    const at = `comp ${ref}`
    const footprint = value(comp, 'footprint', at)
    if (!LIB_ID.test(footprint)) throw new Error(`${at}: footprint "${footprint}" is not a "Lib:Name" id`)
    const lib = children(comp, 'libsource')
    if (lib.length !== 1) throw new Error(`${at}: expected one libsource`)
    const sheet = children(comp, 'sheetpath')
    if (sheet.length !== 1 || value(sheet[0], 'names', at) !== '/' || value(sheet[0], 'tstamps', at) !== '/') throw new Error(`${at}: sheetpath must be (names "/") (tstamps "/")`)
    const ts = children(comp, 'tstamps')
    if (ts.length !== 1 || ts[0].length !== 2 || !UUID.test(String(ts[0][1]))) throw new Error(`${at}: tstamps must hold one UUID`)
    for (const f of children(comp, 'fields')[0]?.slice(1) ?? [])
      if (head(f) !== 'field' || !(isList(f) && f.length === 3 && f[2] instanceof Quoted)) throw new Error(`${at}: a field is (field (name "...") "value")`)
    comps.push({ ref, value: value(comp, 'value', at), footprint, lib: value(lib[0], 'lib', at), part: value(lib[0], 'part', at), uuid: String(ts[0][1]) })
  }
  const libparts: ParsedNetlist['libparts'] = sections('libparts').slice(1).map((c) => {
    if (head(c) !== 'libpart') throw new Error(`libparts: unexpected ${head(c)}`)
    const lp = c as Sexpr[]
    const pins = children(lp, 'pins')[0]?.slice(1) ?? []
    return { lib: value(lp, 'lib', 'libpart'), part: value(lp, 'part', 'libpart'), pins: pins.map((p) => value(p as Sexpr[], 'num', 'libpart pin')) }
  })
  const nets: ParsedNetlist['nets'] = sections('nets').slice(1).map((c) => {
    if (head(c) !== 'net') throw new Error(`nets: unexpected ${head(c)}`)
    const net = c as Sexpr[]
    const code = Number(value(net, 'code', 'net'))
    const name = value(net, 'name', `net ${code}`)
    if (!Number.isInteger(code) || code < 1) throw new Error(`net ${name}: code must be a whole number from 1 (Pcbnew skips a net coded 0)`)
    const nodes = children(net, 'node').map((n) => ({ ref: value(n, 'ref', `net ${name}`), pin: value(n, 'pin', `net ${name}`), pinfunction: value(n, 'pinfunction', `net ${name}`), pintype: value(n, 'pintype', `net ${name}`) }))
    return { code, name, nodes }
  })
  // Cross-checks: what Pcbnew relies on to place each footprint and give each pad its net.
  const refs = new Set<string>()
  for (const c of comps) {
    if (refs.has(c.ref)) throw new Error(`reference ${c.ref} is used twice`)
    refs.add(c.ref)
  }
  if (new Set(comps.map((c) => c.uuid)).size !== comps.length) throw new Error('two components share a tstamps UUID')
  if (new Set(nets.map((n) => n.code)).size !== nets.length) throw new Error('two nets share a code')
  if (new Set(nets.map((n) => n.name)).size !== nets.length) throw new Error('two nets share a name')
  const padNet = new Map<string, string>()
  for (const n of nets)
    for (const node of n.nodes) {
      if (!refs.has(node.ref)) throw new Error(`net ${n.name}: node ${node.ref} is no component`)
      const k = `${node.ref} ${node.pin}`
      if (padNet.has(k)) throw new Error(`pad ${k} is on two nets (${padNet.get(k)} and ${n.name})`)
      padNet.set(k, n.name)
    }
  return { comps, nets, libparts }
}
