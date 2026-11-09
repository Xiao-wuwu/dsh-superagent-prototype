/**
 * A deliberately small YAML reader for the declarative settings file.
 *
 * The repository ships no YAML dependency: `lib/` is committed, the release invariant forbids a bare import
 * outside the host packages, and a bundled parser would add a few hundred kilobytes of third-party code to the
 * published plugin. This reader covers what a settings file actually needs — block mappings and sequences, flow
 * collections, quoted and plain scalars, comments, and literal or folded blocks — and refuses everything else
 * with the line it was found on. A loud refusal is the point: a subset that guessed would be a silent way to
 * apply the wrong settings.
 *
 * Every value also records the line its key was written on, so a schema failure can name that line instead of
 * only the path it came from.
 */

/** A refusal the caller can turn into an operator message; `line` is 1-based and `column` counts characters. */
export class YamlError extends Error {
  readonly line: number
  readonly column: number
  constructor(line: number, column: number, message: string) {
    super(message)
    this.name = 'YamlError'
    this.line = line
    this.column = column
  }
}

export type ParsedYaml = { value: unknown; lineAt: (path: string) => number | undefined }

interface SourceLine {
  raw: string
  indent: number
  content: string
  number: number
}

interface Entry {
  key: string
  rest: string
  column: number
}

const BLOCK_HEADER = /^[|>][-+]?$/
const NUMERIC = /^[-+]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/
const FRACTION = /^[-+]?\.[0-9]+$/

/** Drop a trailing `#` comment unless the `#` sits inside a quoted scalar. */
function stripComment(text: string): string {
  let quote: string | undefined
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quote) {
      if (char === quote) {
        if (quote === "'" && text[i + 1] === "'") i++
        else quote = undefined
      }
      continue
    }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '#' && (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\t')) return text.slice(0, i)
  }
  return text
}

/** Folded style joins neighbours with a space and turns empty lines into newlines. */
function folded(lines: string[]): string {
  let text = ''
  let breaks = 0
  for (const line of lines) {
    if (line === '') { breaks++; continue }
    text += text === '' ? '\n'.repeat(breaks) : breaks > 0 ? '\n'.repeat(breaks) : ' '
    text += line
    breaks = 0
  }
  return text
}

/** Holds the pre-split lines and the `path → line` map while one document is read; one instance per parse. */
class Reader {
  private readonly lines: SourceLine[]
  private readonly lineAt = new Map<string, number>()
  private index = 0

  constructor(text: string) {
    this.lines = text.split('\n').map((raw, offset) => {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
      let indent = 0
      while (indent < line.length && line[indent] === ' ') indent++
      return { raw: line, indent, content: line.slice(indent), number: offset + 1 }
    })
  }

  read(): ParsedYaml {
    this.lineAt.set('', 1)
    const first = this.peek()
    if (!first) return { value: null, lineAt: path => this.lineAt.get(path) }
    if (first.indent !== 0) throw new YamlError(first.number, first.indent + 1, 'the document must start at column 1')
    const value = this.node(0, '')
    const trailing = this.peek()
    if (trailing) throw new YamlError(trailing.number, trailing.indent + 1, 'unexpected content after the document')
    return { value, lineAt: path => this.lineAt.get(path) }
  }

  /** The next line that carries structure; blank and comment-only lines are consumed on the way. */
  private peek(): SourceLine | undefined {
    while (this.index < this.lines.length) {
      const line = this.lines[this.index]!
      if (line.content.trim() === '' || line.content.startsWith('#')) { this.index++; continue }
      this.rejectHeader(line)
      return line
    }
    return undefined
  }

  private rejectHeader(line: SourceLine): void {
    const content = line.content
    const column = line.indent + 1
    if (content[0] === '\t') throw new YamlError(line.number, column, 'tabs cannot be used for indentation')
    if (content === '---' || content === '...' || content.startsWith('--- ')) {
      throw new YamlError(line.number, column, 'multiple YAML documents are not supported')
    }
    if (content.startsWith('%')) throw new YamlError(line.number, column, 'YAML directives are not supported')
    if (content.startsWith('? ')) throw new YamlError(line.number, column, 'complex mapping keys are not supported')
  }

  private isItem(content: string): boolean {
    return content === '-' || content.startsWith('- ')
  }

  private node(indent: number, path: string): unknown {
    const line = this.peek()
    if (!line) return null
    return this.isItem(line.content) ? this.sequence(indent, path) : this.mapping(indent, path)
  }

  private mapping(indent: number, path: string): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    while (true) {
      const line = this.peek()
      if (!line || line.indent < indent) break
      if (line.indent > indent) throw new YamlError(line.number, line.indent + 1, 'unexpected indentation')
      if (this.isItem(line.content)) {
        throw new YamlError(line.number, line.indent + 1, 'a sequence item cannot share its indentation with mapping keys')
      }
      const entry = this.splitEntry(line)
      if (entry.key === '<<') throw new YamlError(line.number, line.indent + 1, 'merge keys are not supported')
      if (Object.prototype.hasOwnProperty.call(result, entry.key)) {
        throw new YamlError(line.number, line.indent + 1, 'duplicate key "' + entry.key + '"')
      }
      const child = path ? path + '.' + entry.key : entry.key
      this.lineAt.set(child, line.number)
      this.index++
      result[entry.key] = this.valueOf(entry, indent, child, line)
    }
    return result
  }

  private valueOf(entry: Entry, indent: number, child: string, line: SourceLine): unknown {
    if (entry.rest === '') {
      const next = this.peek()
      if (next && next.indent > indent) return this.node(next.indent, child)
      // A block sequence may sit at the same indentation as the key that owns it.
      if (next && next.indent === indent && this.isItem(next.content)) return this.sequence(indent, child)
      return null
    }
    if (BLOCK_HEADER.test(entry.rest)) return this.block(entry.rest, indent)
    return this.inline(entry.rest, line.number, entry.column, child)
  }

  private splitEntry(line: SourceLine): Entry {
    const content = line.content
    const colon = this.findColon(content)
    const column = line.indent + 1
    if (colon < 0) throw new YamlError(line.number, column, 'expected a "key: value" line')
    const rawKey = content.slice(0, colon).trim()
    if (rawKey === '') throw new YamlError(line.number, column, 'a mapping key cannot be empty')
    const key = this.scalar(rawKey, line.number, column)
    if (typeof key !== 'string') throw new YamlError(line.number, column, 'mapping keys must be strings')
    const tail = content.slice(colon + 1)
    const rest = stripComment(tail).trim()
    const leading = tail.length - tail.trimStart().length
    return { key, rest, column: line.indent + colon + 2 + leading }
  }

  /** Index of the `:` that ends a key, or -1 when the line has none outside quotes and before a comment. */
  private findColon(content: string): number {
    let quote: string | undefined
    for (let i = 0; i < content.length; i++) {
      const char = content[i]!
      if (quote) {
        if (char === quote) {
          if (quote === "'" && content[i + 1] === "'") i++
          else quote = undefined
        }
        continue
      }
      if (char === '"' || char === "'") { quote = char; continue }
      if (char === '#' && (i === 0 || content[i - 1] === ' ')) return -1
      if (char === ':' && (i + 1 === content.length || content[i + 1] === ' ')) return i
    }
    return -1
  }

  private sequence(indent: number, path: string): unknown[] {
    const result: unknown[] = []
    let position = 0
    while (true) {
      const line = this.peek()
      if (!line || line.indent < indent) break
      if (line.indent > indent) throw new YamlError(line.number, line.indent + 1, 'unexpected indentation')
      if (!this.isItem(line.content)) break
      const child = path ? path + '.' + position : String(position)
      this.lineAt.set(child, line.number)
      position++
      const content = line.content
      const afterDash = content === '-' ? '' : content.slice(2)
      if (afterDash.trim() === '') {
        this.index++
        const next = this.peek()
        result.push(next && next.indent > indent ? this.node(next.indent, child) : null)
        continue
      }
      if (this.findColon(afterDash) >= 0) {
        // `- key: value` starts a mapping on the item line; its following keys align under the first key.
        const keyIndent = indent + content.length - afterDash.length
        this.lines[this.index] = { raw: ' '.repeat(keyIndent) + afterDash, indent: keyIndent, content: afterDash, number: line.number }
        result.push(this.mapping(keyIndent, child))
        continue
      }
      this.index++
      if (BLOCK_HEADER.test(afterDash)) result.push(this.block(afterDash, indent))
      else result.push(this.inline(afterDash, line.number, indent + content.length - afterDash.length + 1, child))
    }
    return result
  }

  private inline(text: string, line: number, column: number, path: string): unknown {
    const value = stripComment(text).trim()
    if (value === '') return null
    if (value.startsWith("'")) return this.single(value, line, column)
    if (value.startsWith('"')) return this.double(value, line, column)
    if (value.startsWith('[')) return this.flowSequence(value, line, column, path)
    if (value.startsWith('{')) return this.flowMapping(value, line, column, path)
    return this.scalar(value, line, column)
  }

  private single(text: string, line: number, column: number): string {
    if (text.length < 2 || !text.endsWith("'")) throw new YamlError(line, column, 'an unterminated single-quoted scalar')
    return text.slice(1, -1).replace(/''/g, "'")
  }

  private double(text: string, line: number, column: number): string {
    if (text.length < 2 || !text.endsWith('"')) throw new YamlError(line, column, 'an unterminated double-quoted scalar')
    return this.unicode(text.slice(1, -1), line, column)
  }

  private unicode(text: string, line: number, column: number): string {
    return text.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)/g, (match, escape: string) => {
      const simple: Record<string, string> = { '\\': '\\', '"': '"', '/': '/', n: '\n', t: '\t', r: '\r', '0': '\0', b: '\b', f: '\f' }
      const known = simple[escape]
      if (known !== undefined) return known
      if (/^[xu][0-9a-fA-F]+$/.test(escape)) return String.fromCharCode(parseInt(escape.slice(1), 16))
      throw new YamlError(line, column, 'unsupported escape "\\' + escape + '" in a double-quoted scalar')
    })
  }

  private flowSequence(text: string, line: number, column: number, path: string): unknown[] {
    const parts = this.flowParts(this.flowInner(text, ']', line, column), line, column)
    return parts.map((part, position) => {
      const child = path ? path + '.' + position : String(position)
      this.lineAt.set(child, line)
      return this.inline(part, line, column, child)
    })
  }

  private flowMapping(text: string, line: number, column: number, path: string): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const part of this.flowParts(this.flowInner(text, '}', line, column), line, column)) {
      const colon = this.findFlowColon(part)
      if (colon < 0) throw new YamlError(line, column, 'expected a "key: value" pair inside a flow mapping')
      const key = this.scalar(part.slice(0, colon).trim(), line, column)
      if (typeof key !== 'string') throw new YamlError(line, column, 'mapping keys must be strings')
      if (Object.prototype.hasOwnProperty.call(result, key)) throw new YamlError(line, column, 'duplicate key "' + key + '"')
      const child = path ? path + '.' + key : key
      this.lineAt.set(child, line)
      result[key] = this.inline(part.slice(colon + 1), line, column, child)
    }
    return result
  }

  private flowInner(text: string, close: string, line: number, column: number): string {
    if (!text.endsWith(close)) throw new YamlError(line, column, 'a flow collection must close on the same line')
    return text.slice(1, -1)
  }

  private flowParts(inner: string, line: number, column: number): string[] {
    const parts: string[] = []
    let start = 0
    let depth = 0
    let quote: string | undefined
    for (let i = 0; i < inner.length; i++) {
      const char = inner[i]!
      if (quote) {
        if (char === quote) {
          if (quote === "'" && inner[i + 1] === "'") i++
          else quote = undefined
        }
        continue
      }
      if (char === '"' || char === "'") { quote = char; continue }
      if (char === '[' || char === '{') depth++
      else if (char === ']' || char === '}') {
        depth--
        if (depth < 0) throw new YamlError(line, column, 'unbalanced brackets in a flow collection')
      } else if (char === ',' && depth === 0) {
        parts.push(inner.slice(start, i).trim())
        start = i + 1
      }
    }
    if (quote) throw new YamlError(line, column, 'an unterminated quoted scalar')
    if (depth !== 0) throw new YamlError(line, column, 'unbalanced brackets in a flow collection')
    parts.push(inner.slice(start).trim())
    return parts.filter(part => part !== '')
  }

  private findFlowColon(part: string): number {
    let depth = 0
    let quote: string | undefined
    for (let i = 0; i < part.length; i++) {
      const char = part[i]!
      if (quote) {
        if (char === quote) {
          if (quote === "'" && part[i + 1] === "'") i++
          else quote = undefined
        }
        continue
      }
      if (char === '"' || char === "'") { quote = char; continue }
      if (char === '[' || char === '{') depth++
      else if (char === ']' || char === '}') depth--
      else if (char === ':' && depth === 0) return i
    }
    return -1
  }

  private scalar(text: string, line: number, column: number): string | number | boolean | null {
    const value = text.trim()
    if (value === '' || value === '~' || /^null$/i.test(value)) return null
    if (/^true$/i.test(value)) return true
    if (/^false$/i.test(value)) return false
    if (NUMERIC.test(value) || FRACTION.test(value)) return Number(value)
    if (/^[&*][A-Za-z0-9_]/.test(value)) throw new YamlError(line, column, 'anchors, aliases and merge keys are not supported')
    if (value.startsWith('!!')) throw new YamlError(line, column, 'tags are not supported')
    return value
  }

  /** Collect the indented lines under a `|` or `>` header; `index` already points past the header line. */
  private block(header: string, parentIndent: number): string {
    const fold = header[0] === '>'
    const chomp = header.includes('-') ? 'strip' : header.includes('+') ? 'keep' : 'clip'
    const start = this.index
    let contentIndent = Number.MAX_SAFE_INTEGER
    let end = start
    while (end < this.lines.length) {
      const line = this.lines[end]!
      if (line.content.trim() === '') { end++; continue }
      if (line.indent <= parentIndent) break
      contentIndent = Math.min(contentIndent, line.indent)
      end++
    }
    let last = end - 1
    while (last >= start && this.lines[last]!.content.trim() === '') last--
    const body = this.lines.slice(start, last + 1).map(line =>
      line.content.trim() === '' ? '' : line.raw.slice(Math.min(contentIndent, line.indent)))
    const joined = fold ? folded(body) : body.join('\n')
    const trailing = end - last - 1
    this.index = end
    if (chomp === 'strip') return joined
    return joined + '\n'.repeat(chomp === 'keep' ? trailing + 1 : 1)
  }
}

/** Read a settings document. Throws `YamlError` for anything the subset does not cover. */
export function parseYaml(text: string): ParsedYaml {
  return new Reader(text).read()
}
