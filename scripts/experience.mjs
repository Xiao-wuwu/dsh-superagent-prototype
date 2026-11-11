#!/usr/bin/env node
/**
 * Experience CLI: read, teach, and retire habits from any shell, with no dependency on this package's build output, on
 * TypeScript support in the local Node, or on any other plugin. The main Session calls it through its own shell tool;
 * the operator can call it the same way.
 *
 *   node scripts/experience.mjs list
 *   node scripts/experience.mjs add --when "..." --then "..." --event file.created --pattern "*.pdf" [--dir D:/Downloads] [--note "..."]
 *   node scripts/experience.mjs match file.created D:/Downloads/report.pdf
 *   node scripts/experience.mjs show exp-...   |   enable exp-... false   |   forget exp-...   |   path
 *
 * The record shape here is the one `src/experience/store.ts` reads and writes; `tests/experience-cli.spec.ts` asserts
 * that a file written by either side is read unchanged by the other, so the two cannot drift silently.
 * @module
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const args = process.argv.slice(2)
const command = args[0] ?? 'list'
/** `--key value` and bare `--flag`; a repeated key keeps the first value, which is all the options below need. */
function options(rest) {
  const out = {}
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]
    if (!token?.startsWith('--')) continue
    const key = token.slice(2)
    const next = rest[i + 1]
    if (next === undefined || next.startsWith('--')) { out[key] = true; continue }
    if (out[key] === undefined) out[key] = next
    i++
  }
  return out
}
const opts = options(args.slice(1))

/** The bundle's own rule: `<DSH home>/state/superagent`, or `state/<profile>-superagent` for any other profile name. */
function defaultStateDir() {
  const profile = process.env.DSH_SUPERAGENT_PROFILE ?? ''
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'state', !profile || profile === 'superagent' ? 'superagent' : `${profile}-superagent`)
}
const stateDir = resolve(String(opts.state ?? process.env.DSH_SUPERAGENT_STATE ?? defaultStateDir()))
const file = join(stateDir, 'experiences.json')

const fail = message => { console.error(`experience: ${message}`); process.exit(1) }
const split = value => String(value).split(',').map(item => item.trim()).filter(Boolean)
const now = () => new Date().toISOString()
const normalize = item => ({
  ...item,
  when: String(item.when ?? ''), then: String(item.then ?? ''),
  events: Array.isArray(item.events) ? item.events.map(String) : [],
  dirs: Array.isArray(item.dirs) ? item.dirs.map(String) : [],
  patterns: Array.isArray(item.patterns) ? item.patterns.map(String) : [],
  from: item.from === 'agent' ? 'agent' : 'operator',
  createdAt: item.createdAt ?? now(), updatedAt: item.updatedAt ?? now(),
  uses: Number.isFinite(item.uses) ? item.uses : 0, enabled: item.enabled !== false,
})
const load = () => {
  if (!existsSync(file)) return []
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(parsed.items)) fail(`${file} has no items array`)
  return parsed.items.map(normalize)
}
const save = items => {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${process.pid}`
  writeFileSync(temporary, `${JSON.stringify({ version: 1, items }, null, 2)}\n`, 'utf8')
  renameSync(temporary, file)
}
const patternHit = (pattern, name) => {
  const p = pattern.trim().toLowerCase(), n = name.toLowerCase()
  if (!p) return false
  if (p.startsWith('*.')) return n.endsWith(p.slice(1))
  if (p.endsWith('.*')) return n.startsWith(p.slice(0, -1))
  return n === p || n.includes(p)
}

try {
  switch (command) {
    case 'list': {
      const items = load()
      console.log(JSON.stringify({ file, count: items.length, items }, null, 2))
      break
    }
    case 'add': {
      if (!opts.when || !opts.then) fail('add needs --when and --then')
      const items = load()
      const at = now()
      const item = {
        id: `exp-${Date.now().toString(36)}-${items.length}`,
        when: String(opts.when).trim(), then: String(opts.then).trim(),
        ...(opts.note ? { note: String(opts.note).trim() } : {}),
        events: opts.event ? split(opts.event) : [], dirs: opts.dir ? split(opts.dir) : [],
        patterns: opts.pattern ? split(opts.pattern) : [],
        from: opts.from === 'agent' ? 'agent' : 'operator',
        createdAt: at, updatedAt: at, uses: 0, enabled: true,
      }
      save([...items, item])
      console.log(JSON.stringify(item, null, 2))
      break
    }
    case 'match': {
      const positional = args.slice(1).filter(token => !token.startsWith('--'))
      const [event, path] = positional
      if (!event || !path) fail('match needs an event and a path, e.g. match file.created D:/Downloads/a.pdf')
      const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
      const dir = slash >= 0 ? path.slice(0, slash + 1) : ''
      const name = slash >= 0 ? path.slice(slash + 1) : path
      const lowerDir = dir.replace(/\\/g, '/').toLowerCase()
      const matched = load()
        .filter(item => item.enabled)
        .filter(item => !item.events.length || item.events.some(e => e.toLowerCase() === event.toLowerCase()))
        .filter(item => !item.dirs.length || item.dirs.some(d => lowerDir.includes(d.replace(/\\/g, '/').toLowerCase())))
        .filter(item => !item.patterns.length || item.patterns.some(p => patternHit(p, name)))
        .sort((a, b) => b.uses - a.uses || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      console.log(JSON.stringify({ event, path, matched: matched.map(({ id, when, then }) => ({ id, when, then })) }, null, 2))
      break
    }
    case 'show': {
      const id = args.slice(1).find(token => !token.startsWith('--'))
      if (!id) fail('show needs an experience id')
      const item = load().find(entry => entry.id === id)
      if (!item) fail(`no experience ${id}`)
      console.log(JSON.stringify(item, null, 2))
      break
    }
    case 'enable': {
      const [id, value] = args.slice(1).filter(token => !token.startsWith('--'))
      if (!id) fail('enable needs an experience id and true|false')
      const items = load()
      const found = items.find(entry => entry.id === id)
      if (!found) fail(`no experience ${id}`)
      found.enabled = String(value).toLowerCase() !== 'false'
      found.updatedAt = now()
      save(items)
      console.log(JSON.stringify(found, null, 2))
      break
    }
    case 'forget': {
      const id = args.slice(1).find(token => !token.startsWith('--'))
      if (!id) fail('forget needs an experience id')
      const items = load()
      const kept = items.filter(entry => entry.id !== id)
      if (kept.length === items.length) fail(`no experience ${id}`)
      save(kept)
      console.log(JSON.stringify({ forgotten: id, remaining: kept.length }))
      break
    }
    case 'path': console.log(file); break
    default: fail(`unknown command ${command}; use list | add | match | show | enable | forget | path`)
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
