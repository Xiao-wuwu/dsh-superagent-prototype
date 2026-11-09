// Portability guard: nothing in this repository may name one developer's machine.
//
// The product is published for other people's computers, so tracked text files must not contain absolute paths or user
// names from the machine it was developed on. The machine-specific values are derived at run time, so the gate keeps
// working after a checkout moves or changes hands; only the rules are written down here.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { extname, join, relative } from 'node:path'
import { expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
// `local/` and `AGENTS.md` are deliberately not part of the published tree (they are gitignored).
const SKIP = new Set(['node_modules', '.git', '.artifacts', 'local', 'coverage', 'dist'])
const SKIP_FILES = new Set(['AGENTS.md'])
// `.css` and extensionless files (`LICENSE`, `NOTICE`, `scripts/dsh-superagent`) are text too.
const TEXT = /\.(md|ts|tsx|js|mjs|cjs|json|ya?ml|ps1|cmd|sh|css|txt)$/
const BINARY = /\.(png|ico|jpg|jpeg|webp|zip|zst|zstd|exe|dll|pak|dat|bin|pdf)$/

const USER = userInfo().username
const HOME = homedir()
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Absolute paths and names that only exist on the machine this checkout runs on. */
export const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: 'developer home directory', pattern: new RegExp(escape(HOME), 'i') },
  { name: 'developer user name', pattern: new RegExp(`(?:^|[^A-Za-z0-9_])${escape(USER)}(?:$|[^A-Za-z0-9_])`, 'i') },
  { name: 'windows user path', pattern: new RegExp(`C:[\\\\/]{1,2}Users[\\\\/]{1,2}${escape(USER)}\\b`, 'i') },
  { name: 'repository checkout path', pattern: new RegExp(escape(ROOT), 'i') },
]

export interface Finding {
  name: string
  line: number
}

/** Every forbidden rule that matches `text`, with the 1-based line of each match. */
export function scanText(text: string, patterns: { name: string; pattern: RegExp }[] = FORBIDDEN): Finding[] {
  const found: Finding[] = []
  for (const { name, pattern } of patterns) {
    const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'
    const global = new RegExp(pattern.source, flags)
    for (const match of text.matchAll(global)) found.push({ name, line: text.slice(0, match.index).split('\n').length })
  }
  return found
}

/** A file is text when it is not a known binary and either has a text extension or no extension at all. */
export function isTextFile(name: string): boolean {
  if (BINARY.test(name)) return false
  return extname(name) ? TEXT.test(name) : true
}

/** Every text file below the repository root, including the committed `lib/` build output. */
function textFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (SKIP.has(entry) || (directory === ROOT && SKIP_FILES.has(entry))) continue
    const full = join(directory, entry)
    const info = statSync(full)
    if (info.isDirectory()) { textFiles(full, found); continue }
    if (!isTextFile(entry)) continue
    found.push(full)
  }
  return found
}

/** The repository's text files and every rule they break. */
export function scanRepository(): { files: string[]; offenders: string[] } {
  const files = textFiles(ROOT)
  const offenders = files.flatMap(file => scanText(readFileSync(file, 'utf8'))
    .map(({ name, line }) => `${relative(ROOT, file).replace(/\\/g, '/')}:${line} — ${name}`))
  return { files, offenders }
}

it('never names the development machine, so another computer can use the repository as is', () => {
  const { files, offenders } = scanRepository()
  // Scanning nothing is not a pass: the walk itself has to find the tree.
  expect(files.length).toBeGreaterThan(0)
  // The committed build output is what an install serves, so it is in scope as well.
  expect(files.map(file => relative(ROOT, file).replace(/\\/g, '/'))).toEqual(expect.arrayContaining([
    'lib/index.js', 'src/client/client.css', 'scripts/dsh-superagent', 'LICENSE', 'NOTICE',
  ]))
  expect(offenders).toEqual([])
})

it('catches a planted home directory, so the scanner is not passing by blindness', () => {
  const planted = `notes: ${homedir()}${join('APP', 'repository')}`
  expect(scanText(planted).map(finding => finding.name)).toContain('developer home directory')
})

it('catches the user name in both Windows path spellings', () => {
  for (const separator of ['\\', '/']) {
    const planted = `path: C:${separator}Users${separator}${userInfo().username}${separator}state`
    expect(scanText(planted).map(finding => finding.name), planted).toContain('windows user path')
  }
})

it('leaves a clean file alone, so the gate does not fail on placeholders', () => {
  expect(scanText('stateDir: C:/Users/<you>/.dsh/state/superagent\ncheckout: <checkout>\n')).toEqual([])
})
