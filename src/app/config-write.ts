/**
 * Write-back of panel saves into the instance's own declarative settings file. A panel used to save only to the
 * store, while the file kept winning at startup, so a restart reverted the panel's value. This module patches just
 * the keys a save changed, keeps the rest of the document byte for byte (including hand-written comments in YAML),
 * refuses to write when the file changed outside the service, and replaces the file atomically.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { declarativeFormat, resolveDeclarativePath } from './config-file.ts'
import { parseYaml } from './config-yaml.ts'
import { SettingsSchema } from '../policy.ts'

/** The file is not what this instance last read or wrote: a person edited it. Nothing is written. */
export class DeclarativeConflict extends Error {}
/** The file could not be patched or written: the panel must not report success. */
export class DeclarativeWriteError extends Error {}

/** A file as it was observed: its text and the metadata a conflict check compares. */
export interface FileState {
  mtimeMs: number
  size: number
  text: string
}

/** One changed key and its new value; `path` is a mapping path, never an index into a sequence. */
export interface Change {
  path: string[]
  value: unknown
}

const describe = (error: unknown): string => error instanceof Error ? error.message : String(error)
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const collection = (value: unknown): boolean => Array.isArray(value) || isPlainObject(value)

/** The current state of a file, or `undefined` when it does not exist. */
export function fileState(path: string): FileState | undefined {
  let mtimeMs: number
  let size: number
  try {
    const stat = statSync(path)
    mtimeMs = stat.mtimeMs
    size = stat.size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new DeclarativeWriteError(`The declarative settings file could not be read (${path}): ${describe(error)}`)
  }
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new DeclarativeWriteError(`The declarative settings file could not be read (${path}): ${describe(error)}`)
  }
  return { mtimeMs, size, text }
}

/**
 * The leaf differences between two block values. Objects are compared key by key; arrays and scalars are one value,
 * so a changed list is written as a whole (and a sequence is never edited item by item). Keys present only in `before`
 * are left alone: the panel does not delete configuration keys, and `kind` on a Source is not part of its panel block.
 */
export function declarativeChanges(before: unknown, after: unknown, path: string[] = []): Change[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return []
  if (isPlainObject(before) && isPlainObject(after)) {
    return Object.keys(after).flatMap(key => declarativeChanges(before[key], after[key], [...path, key]))
  }
  return [{ path, value: after }]
}

// ---------------------------------------------------------------------------------------------------------------------
// JSON

const indentOf = (text: string): string => {
  const match = /\n(\t+|[ ]+)(?=["[}\]]|\S)/.exec(text)
  return match?.[1] ?? '  '
}

/** Patch a JSON document: parse, set the changed keys, serialize with the document's own indentation. */
export function patchJson(text: string, changes: Change[]): string {
  let declared: unknown = {}
  if (text.trim()) {
    try { declared = JSON.parse(text) }
    catch (error) { throw new DeclarativeWriteError(`The declarative settings file is not valid JSON: ${describe(error)}; nothing was written`) }
  }
  if (!isPlainObject(declared)) throw new DeclarativeWriteError('The declarative settings file must contain an object; nothing was written')
  for (const { path, value } of changes) {
    let node = declared
    for (const key of path.slice(0, -1)) {
      if (!isPlainObject(node[key])) node[key] = {}
      node = node[key] as Record<string, unknown>
    }
    node[path[path.length - 1]!] = value
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const body = JSON.stringify(declared, null, indentOf(text))
  return body + (text.endsWith('\n') ? eol : '')
}

// ---------------------------------------------------------------------------------------------------------------------
// YAML

interface YLine { raw: string; indent: number; content: string; blank: boolean; comment: boolean; item: boolean }

const linesOf = (raw: string): YLine => {
  let indent = 0
  while (indent < raw.length && raw[indent] === ' ') indent++
  const content = raw.slice(indent)
  return { raw, indent, content, blank: content.trim() === '', comment: content.startsWith('#'), item: content === '-' || content.startsWith('- ') }
}

const split = (text: string): { lines: YLine[]; eol: string } => {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  return { lines: text.split('\n').map(row => linesOf(row.endsWith('\r') ? row.slice(0, -1) : row)), eol }
}

const join = (lines: YLine[], eol: string): string => lines.map(line => line.raw).join(eol)

const padding = (indent: number): string => ' '.repeat(indent)

/** The index of a `#` that starts a comment, or -1. Quotes are honoured, so a `#` inside a value is not a comment. */
function commentAt(text: string): number {
  let quote: string | undefined
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (quote) {
      if (quote === '"' && char === '\\') index++
      else if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '#' && (index === 0 || text[index - 1] === ' ')) return index
  }
  return -1
}

/** The colon ending a key, or -1: a plain key ends at `:` followed by a space or the end of the line. */
function colonOf(content: string): number {
  let quote: string | undefined
  for (let index = 0; index < content.length; index++) {
    const char = content[index]!
    if (quote) {
      if (quote === '"' && char === '\\') index++
      else if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '#' && index === 0) return -1
    else if (char === ':' && (index + 1 === content.length || content[index + 1] === ' ')) return index
  }
  return -1
}

const unkey = (text: string): string => {
  const key = text.trim()
  if (key.length >= 2 && (key[0] === '"' || key[0] === "'") && key.at(-1) === key[0]) {
    return key[0] === "'" ? key.slice(1, -1).replaceAll("''", "'") : JSON.parse(key) as string
  }
  return key
}

interface Entry { at: number; colon: number; rest: string }

/** The entry of `key` in the mapping that starts at `from` and lives at `indent`. */
function findEntry(lines: YLine[], from: number, to: number, indent: number, key: string): Entry | undefined {
  for (let at = from; at < to; at++) {
    const line = lines[at]!
    if (line.blank || line.comment) continue
    if (line.indent < indent) break
    if (line.indent > indent) continue
    if (line.item) break
    const colon = colonOf(line.content)
    if (colon < 0) continue
    if (unkey(line.content.slice(0, colon)) !== key) continue
    const tail = line.content.slice(colon + 1)
    const comment = commentAt(tail)
    return { at, colon, rest: (comment < 0 ? tail : tail.slice(0, comment)).trim() }
  }
  return undefined
}

/** The lines that belong to the value of the entry at `at`: nested lines and same-indent sequence items, without the
 * blank or comment lines that trail the value before the next sibling (they are not the value, so they stay put). */
function valueEnd(lines: YLine[], at: number, indent: number): number {
  let end = at + 1
  let last = end
  while (end < lines.length) {
    const line = lines[end]!
    if (line.blank || line.comment) { end++; continue }
    if (line.indent > indent) { end++; last = end; continue }
    if (line.indent === indent && line.item) { end++; last = end; continue }
    break
  }
  return last
}

const firstContent = (lines: YLine[], from: number, to: number): YLine | undefined => {
  for (let at = from; at < to; at++) {
    const line = lines[at]!
    if (!line.blank && !line.comment) return line
  }
  return undefined
}

const KEY_PLAIN = /^[A-Za-z0-9_.-]+$/
const keyText = (key: string): string => KEY_PLAIN.test(key) ? key : JSON.stringify(key)

const RESERVED = /^(?:true|false|null|~|[-+]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?)$/i
const PLAIN = /^[A-Za-z0-9._/@\\+$~ -]+$/i
/** A scalar that reads back as the same string without quoting. */
const plain = (text: string): boolean => text.length > 0 && !(text.startsWith('-') || text.startsWith('?') || text.startsWith(':'))
  && !text.startsWith(' ') && !text.endsWith(' ') && !RESERVED.test(text)
  && PLAIN.test(text.replace(/:[^\s]/g, 'x'))

/** A scalar as YAML text; strings that are not plainly safe use JSON's double-quoted escaping, which the reader accepts. */
function scalarText(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'string') return plain(value) ? value : JSON.stringify(value)
  return JSON.stringify(String(value))
}

/** Inline text for a scalar or an empty collection; `undefined` when the value needs a block. */
function inlineValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.length ? undefined : '[]'
  if (isPlainObject(value)) return Object.keys(value).length ? undefined : '{}'
  return scalarText(value)
}

/** Block lines for a non-empty collection at `indent`. */
function blockLines(value: unknown, indent: number): string[] {
  const pad = padding(indent)
  if (isPlainObject(value)) {
    return Object.entries(value).flatMap(([key, item]) => {
      const inline = inlineValue(item)
      return inline === undefined ? [pad + keyText(key) + ':', ...blockLines(item, indent + 2)] : [pad + keyText(key) + ': ' + inline]
    })
  }
  if (Array.isArray(value)) {
    return value.flatMap(item => {
      if (!isPlainObject(item)) return [pad + '- ' + scalarText(item)]
      const entries = Object.entries(item)
      if (!entries.length) return [pad + '- {}']
      return entries.flatMap(([key, child], index) => {
        const lead = index === 0 ? pad + '- ' + keyText(key) : pad + '  ' + keyText(key)
        const inline = inlineValue(child)
        return inline === undefined ? [lead + ':', ...blockLines(child, indent + 4)] : [lead + ': ' + inline]
      })
    })
  }
  return [pad + scalarText(value)]
}

/** Lines creating `path` (and its parents) under `indent`, ending with the changed value. */
function newPathLines(path: string[], value: unknown, indent: number): string[] {
  const pad = padding(indent)
  if (path.length === 1) {
    const inline = inlineValue(value)
    return inline === undefined ? [pad + keyText(path[0]!) + ':', ...blockLines(value, indent + 2)] : [pad + keyText(path[0]!) + ': ' + inline]
  }
  return [pad + keyText(path[0]!) + ':', ...newPathLines(path.slice(1), value, indent + 2)]
}

/** Insert `path` at the end of the mapping that spans `from`..`to` (after its last non-blank line). */
function insertUnder(lines: YLine[], from: number, to: number, indent: number, path: string[], value: unknown): void {
  let at = from
  for (let index = from; index < to; index++) {
    const line = lines[index]!
    if (!line.blank && !line.comment) at = index + 1
  }
  lines.splice(at, 0, ...newPathLines(path, value, indent).map(linesOf))
}

/** Replace the value of one entry, keeping its key text and any comment on that line. */
function replaceValue(lines: YLine[], entry: Entry, indent: number, value: unknown): void {
  const line = lines[entry.at]!
  const keyPart = line.content.slice(0, entry.colon)
  const tail = line.content.slice(entry.colon + 1)
  const comment = commentAt(tail)
  // Keep the whitespace that separated the old value from its comment, so the comment stays where the author put it.
  const gap = (tail.slice(0, comment < 0 ? 0 : comment).match(/[ \t]+$/) ?? [' '])[0]
  const suffix = comment < 0 ? '' : gap + tail.slice(comment)
  const pad = padding(indent)
  const inline = inlineValue(value)
  const end = valueEnd(lines, entry.at, indent)
  if (inline === undefined) {
    lines.splice(entry.at, end - entry.at, linesOf(pad + keyPart + ':' + suffix), ...blockLines(value, indent + 2).map(linesOf))
  } else {
    lines.splice(entry.at, end - entry.at, linesOf(pad + keyPart + ': ' + inline + suffix))
  }
}

/** Apply one change to a block-style YAML document, creating missing keys and replacing a sequence as a whole. */
function applyChange(lines: YLine[], path: string[], value: unknown): void {
  let from = 0
  let to = lines.length
  let indent = 0
  for (let index = 0; index < path.length; index++) {
    const key = path[index]!
    const entry = findEntry(lines, from, to, indent, key)
    if (!entry) {
      insertUnder(lines, from, to, indent, path.slice(index), value)
      return
    }
    if (index === path.length - 1) {
      replaceValue(lines, entry, indent, value)
      return
    }
    if (entry.rest === '') {
      const end = valueEnd(lines, entry.at, indent)
      const child = firstContent(lines, entry.at + 1, end)
      if (!child) {
        insertUnder(lines, entry.at + 1, entry.at + 1, indent + 2, path.slice(index + 1), value)
        return
      }
      if (child.indent === indent && child.item) {
        throw new DeclarativeWriteError(`The declarative settings file holds a sequence at "${path.slice(0, index + 1).join('.')}", which a panel save does not edit in place; nothing was written`)
      }
      from = entry.at + 1
      to = end
      indent = child.indent
      continue
    }
    if (/^\{\s*\}$/.test(entry.rest)) {
      const line = lines[entry.at]!
      lines[entry.at] = linesOf(padding(indent) + line.content.slice(0, entry.colon) + ':')
      insertUnder(lines, entry.at + 1, entry.at + 1, indent + 2, path.slice(index + 1), value)
      return
    }
    throw new DeclarativeWriteError(`The declarative settings file uses a flow value at "${path.slice(0, index + 1).join('.')}"; write-back only edits block-style YAML there, nothing was written`)
  }
}

/** Patch a YAML document by changing only the lines of the changed keys. */
export function patchYaml(text: string, changes: Change[]): string {
  const { lines, eol } = split(text)
  const root = firstContent(lines, 0, lines.length)
  if (root && (root.indent > 0 || root.item)) throw new DeclarativeWriteError('The declarative settings file must be a block-style mapping at the left margin; nothing was written')
  for (const { path, value } of changes) applyChange(lines, path, value)
  return join(lines, eol)
}

// ---------------------------------------------------------------------------------------------------------------------
// Write-back

const valueAt = (document: unknown, path: string[]): unknown =>
  path.reduce<unknown>((node, key) => isPlainObject(node) ? node[key] : undefined, document)

/**
 * Writes panel saves back into one instance's declarative file. The instance supplies its own configured path; nothing
 * here can reach another instance or a shared directory. The writer remembers the state it last applied so an external
 * edit (different mtime or text) is reported as a conflict instead of being overwritten.
 */
export class DeclarativeWriteBack {
  private seen: FileState | undefined
  constructor(private readonly configured: string) {}
  /** The file this writer targets, after the same resolution the loader uses. */
  path(): string { return resolveDeclarativePath(this.configured) }
  /** Remember the state the runtime just read and applied. */
  observe(): void { this.seen = fileState(this.path()) }
  /**
   * Patch the instance's file with the changes between `before` and `after` at `base`.
   * @throws DeclarativeConflict when the file changed since this instance last read or wrote it.
   * @throws DeclarativeWriteError when the file cannot be parsed, patched, validated or written.
   */
  write(base: string[], before: unknown, after: unknown): void {
    const path = this.path()
    const current = fileState(path)
    const changed = current === undefined ? this.seen !== undefined
      : this.seen === undefined || current.mtimeMs !== this.seen.mtimeMs || current.size !== this.seen.size || current.text !== this.seen.text
    if (changed) {
      throw new DeclarativeConflict(`The declarative settings file (${path}) changed on disk since this instance last applied it; nothing was written. Reload the panel and retry.`)
    }
    const changes = declarativeChanges(before, after, base)
    if (!changes.length) { this.seen = current; return }
    const text = current?.text ?? ''
    const next = declarativeFormat(path) === 'yaml' ? patchYaml(text, changes) : patchJson(text, changes)
    this.validate(path, next, changes)
    this.replace(path, next)
    this.seen = fileState(path)
  }
  /** Refuse to write a document the loader would not accept, or one that does not contain the intended values. */
  private validate(path: string, text: string, changes: Change[]): void {
    let declared: unknown
    try {
      declared = declarativeFormat(path) === 'yaml' ? parseYaml(text).value : JSON.parse(text)
    } catch (error) {
      throw new DeclarativeWriteError(`The declarative settings file could not be written (${path}): the patched document is not valid (${describe(error)}); nothing was written`)
    }
    if (!isPlainObject(declared)) throw new DeclarativeWriteError(`The declarative settings file could not be written (${path}): the patched document is not an object; nothing was written`)
    const parsed = SettingsSchema.partial().safeParse(Object.fromEntries(Object.entries(declared).filter(([key]) => !key.startsWith('$'))))
    if (!parsed.success) {
      throw new DeclarativeWriteError(`The declarative settings file could not be written (${path}): the patched document is invalid (${parsed.error.issues.map(issue => issue.path.join('.') + ': ' + issue.message).join('; ')}); nothing was written`)
    }
    for (const change of changes) {
      if (JSON.stringify(valueAt(declared, change.path)) !== JSON.stringify(change.value)) {
        throw new DeclarativeWriteError(`The declarative settings file could not be written (${path}): "${change.path.join('.')}" did not receive the saved value; nothing was written`)
      }
    }
  }
  /** tmp + rename, so a reader never sees a half-written file. */
  private replace(path: string, text: string): void {
    const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`
    try {
      writeFileSync(tmp, text, 'utf8')
      renameSync(tmp, path)
    } catch (error) {
      try { unlinkSync(tmp) } catch { /* The write failed before the temporary file existed, or it was already gone. */ }
      throw new DeclarativeWriteError(`The declarative settings file could not be written (${path}): ${describe(error)}`)
    }
  }
}
