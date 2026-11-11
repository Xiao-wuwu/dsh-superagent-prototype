/**
 * Experience store (ReActive `experience layer`): one JSON file per deployment, written by the operator or by the agent,
 * read before thinking so a repeated situation reuses what worked last time instead of reasoning from scratch.
 *
 * The file lives under `stateDir` and the format is plain JSON, so the CLI in `scripts/experience.mjs` and this module
 * share one record shape without either depending on a memory plugin, a database, or the network.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** One habit: `when` names the situation, `then` says what to do about it. */
export interface Experience {
  /** Stable id, `exp-<base36>`; ids are never reused. */
  id: string
  /** Situation in one line, e.g. `file.created in D:/Downloads matching *.pdf`. */
  when: string
  /** The action that worked, in one line. */
  then: string
  /** Why it holds, or a limit worth remembering; optional. */
  note?: string
  /** Event paths this habit applies to (`file.created`, …); empty means any event. */
  events: string[]
  /** Directory prefixes this habit applies to; empty means any watched directory. */
  dirs: string[]
  /** Filename patterns this habit applies to, `*.pdf` or an exact name; empty means any file. */
  patterns: string[]
  /** Who wrote it: the operator's own instruction, or the agent after a successful action. */
  from: 'operator' | 'agent'
  createdAt: string
  updatedAt: string
  /** How many times a signal matched it; a tie-breaker when several habits apply. */
  uses: number
  /** Set to false instead of deleting a habit the operator wants kept but not applied. */
  enabled: boolean
}

export interface ExperienceFile { version: 1; items: Experience[] }

/** The one file every part of this feature reads and writes. */
export const experiencePath = (stateDir: string): string => join(stateDir, 'experiences.json')

/** Read the store; a missing file is an empty store, an unreadable file is reported to the caller rather than swallowed. */
export function loadExperiences(stateDir: string): Experience[] {
  const path = experiencePath(stateDir)
  if (!existsSync(path)) return []
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ExperienceFile>
  if (!Array.isArray(parsed.items)) throw new Error(`experience file has no items array: ${path}`)
  return parsed.items.map(normalize)
}

/** Fill fields an older or hand-edited record may lack, so one bad line cannot break every later read. */
function normalize(item: Experience): Experience {
  const now = new Date().toISOString()
  return {
    ...item,
    when: String(item.when ?? ''),
    then: String(item.then ?? ''),
    ...(item.note === undefined ? {} : { note: String(item.note) }),
    events: Array.isArray(item.events) ? item.events.map(String) : [],
    dirs: Array.isArray(item.dirs) ? item.dirs.map(String) : [],
    patterns: Array.isArray(item.patterns) ? item.patterns.map(String) : [],
    from: item.from === 'agent' ? 'agent' : 'operator',
    createdAt: item.createdAt ?? now,
    updatedAt: item.updatedAt ?? now,
    uses: Number.isFinite(item.uses) ? item.uses : 0,
    enabled: item.enabled !== false,
  }
}

/** Replace the file atomically: a crash mid-write leaves the previous store intact. */
export function saveExperiences(stateDir: string, items: readonly Experience[]): void {
  const path = experiencePath(stateDir)
  mkdirSync(dirname(path), { recursive: true })
  const file: ExperienceFile = { version: 1, items: [...items] }
  const temporary = `${path}.tmp-${process.pid}`
  writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
  renameSync(temporary, path)
}

/** A new habit; the caller supplies the situation, the action, and the matchers. */
export function addExperience(stateDir: string, input: {
  when: string; then: string; note?: string; events?: string[]; dirs?: string[]; patterns?: string[]; from?: 'operator' | 'agent'
}): Experience {
  const items = loadExperiences(stateDir)
  const at = new Date().toISOString()
  const item: Experience = {
    id: `exp-${Date.now().toString(36)}-${items.length}`,
    when: input.when.trim(),
    then: input.then.trim(),
    ...(input.note ? { note: input.note.trim() } : {}),
    events: input.events ?? [], dirs: input.dirs ?? [], patterns: input.patterns ?? [],
    from: input.from ?? 'operator', createdAt: at, updatedAt: at, uses: 0, enabled: true,
  }
  if (!item.when || !item.then) throw new Error('an experience needs both `when` and `then`')
  saveExperiences(stateDir, [...items, item])
  return item
}

/** One filename pattern, `*.pdf` or exact, against a path's own name. */
export function matchPattern(pattern: string, name: string): boolean {
  const p = pattern.trim().toLowerCase(); const n = name.toLowerCase()
  if (!p) return false
  if (p.startsWith('*.')) return n.endsWith(p.slice(1))
  if (p.endsWith('\\*') || p.endsWith('/*')) return n.startsWith(p.slice(0, -1).replace(/[\\/]/, ''))
  return n === p || n.includes(p.replace(/^\*\.\./, ''))
}

/**
 * The habits that apply to one signal: an empty matcher list means "any", and every non-empty list must match.
 * Sorted by use count then recency so the most practiced habit is read first.
 */
export function matchExperiences(items: readonly Experience[], signal: { event: string; dir: string; name: string }): Experience[] {
  const name = signal.name.toLowerCase()
  const dir = signal.dir.replace(/\\/g, '/').toLowerCase()
  return items.filter(item => {
    if (!item.enabled) return false
    if (item.events.length && !item.events.some(e => e.toLowerCase() === signal.event.toLowerCase())) return false
    if (item.dirs.length && !item.dirs.some(d => dir.includes(d.replace(/\\/g, '/').toLowerCase()))) return false
    if (item.patterns.length && !item.patterns.some(p => matchPattern(p, name))) return false
    return true
  }).sort((a, b) => b.uses - a.uses || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}

/** Count one use; the write is best effort - a lost counter is not worth failing a signal over. */
export function markUsed(stateDir: string, ids: readonly string[]): void {
  if (!ids.length) return
  try {
    const items = loadExperiences(stateDir)
    const hit = new Set(ids)
    saveExperiences(stateDir, items.map(item => hit.has(item.id) ? { ...item, uses: item.uses + 1 } : item))
  } catch { /* the signal matters more than the counter */ }
}
