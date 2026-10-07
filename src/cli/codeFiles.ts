// Code files beside a netlist (firmware spec 7). layout reads each part's `code.path` (relative,
// inside the netlist's folder, no "..", and not out of it through a symlink) and embeds the source;
// `netlist -o` writes each board's code next to the netlist as <designator><ext> and points at it.
import { readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { LANGUAGE_EXT, SOURCE_MAX_BYTES } from '../format/code.ts'
import { isObj } from '../format/module.ts'
import { CliError, EXIT, type Io, writeFile } from './io.ts'

/** The netlist with every `code.path` replaced by the file's source. `file` names the netlist in messages. */
export function embedCode(raw: unknown, dir: string, file: string): unknown {
  if (!isObj(raw) || !Array.isArray(raw.parts)) return raw
  const root = realpathSync(dir)
  return {
    ...raw,
    parts: raw.parts.map((p) => {
      if (!isObj(p) || !isObj(p.code) || typeof p.code.path !== 'string') return p
      const path = p.code.path
      const who = `${file}: ${String(p.ref)}'s code ${path}`
      let real: string
      try {
        real = realpathSync(resolve(dir, path))
      } catch {
        throw new CliError(`${who} cannot be read`, EXIT.input)
      }
      const rel = relative(root, real)
      if (rel.startsWith('..') || rel.includes(`..${sep}`) || resolve(root, rel) !== real) throw new CliError(`${who} leads outside the netlist's folder`, EXIT.input)
      const bytes = readFileSync(real)
      if (bytes.length > SOURCE_MAX_BYTES) throw new CliError(`${who} is over 256 KB`, EXIT.input)
      let source: string
      try {
        source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        throw new CliError(`${who} is not UTF-8 text`, EXIT.input)
      }
      return { ...p, code: { language: p.code.language, source, file: basename(path) } }
    }),
  }
}

/** Writes each part's inline code beside the netlist as <ref><ext> and references it by path. */
export function writeCode(netlist: { parts: Record<string, unknown>[] }, outFile: string, io: Io): void {
  for (const p of netlist.parts) {
    const c = p.code
    if (!isObj(c) || typeof c.source !== 'string' || typeof c.language !== 'string') continue
    const name = `${String(p.ref)}${(LANGUAGE_EXT[c.language] ?? ['.txt'])[0]}`
    writeFile(io, join(dirname(outFile), name), c.source)
    p.code = { language: c.language, path: name }
  }
}
