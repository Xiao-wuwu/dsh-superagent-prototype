// Release invariants: the promises a published build makes, checked mechanically.
//
// Attribution is a hard requirement of this adaptation, and the repository is public: upstream and its licence must stay
// visible, and no credential may ever land in a tracked file. These checks run with the normal test suite so a release
// cannot quietly lose either. The built `lib` is checked the same way because an install route can lose it silently: a
// plugin installed as a linked directory is given no dependencies, so anything left outside the bundle fails to load.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')
const UPSTREAM = 'deepseek-ai/dsh-superagent-prototype'
const BUILD = 'ReSerendipity/dsh-superagent'
const BINARY = /\.(png|ico|jpg|jpeg|webp|gif|zip|gz|zst|zstd|exe|dll|pak|dat|bin|pdf)$/i

/** Credential shapes that must never appear in a tracked file. */
export const SUSPICIOUS: { name: string; pattern: RegExp }[] = [
  { name: 'GitHub personal access token', pattern: /ghp_[A-Za-z0-9]{20,}/ },
  { name: 'GitHub fine-grained token', pattern: /github_pat_[A-Za-z0-9_]{20,}/ },
  { name: 'provider API key shape', pattern: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
]

/** Every credential shape `text` contains. */
export function scanCredentials(text: string): string[] {
  return SUSPICIOUS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name)
}

/** Every tracked file that is not a known binary, so the scan covers src/, prompts/, docs/, scripts/, lib/ and locale/. */
export function trackedTextFiles(): string[] {
  return execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8' })
    .split('\0').filter(Boolean).filter(file => !BINARY.test(file))
}

it('keeps the upstream attribution visible in every place a reader looks', () => {
  const license = read('LICENSE')
  expect(license).toContain('MIT License')
  expect(license).toContain('DeepSeek Harness Team')

  const notice = read('NOTICE')
  expect(notice).toContain(UPSTREAM)
  expect(notice).toContain('DeepSeek Harness Team')

  const readme = read('README.md')
  expect(readme).toContain(UPSTREAM)
  expect(readme).toContain(BUILD)
  expect(readme).toContain('DeepSeek Harness Team')
  // The upstream disclaimer itself must survive: this is not an official DeepSeek product.
  expect(readme).toMatch(/非官方产品|not an official DeepSeek product/i)

  for (const locale of ['locale/zh.json', 'locale/en.json']) {
    const text = read(locale)
    expect(text, locale).toContain(UPSTREAM)
    expect(text, locale).toContain(BUILD)
    expect(text, locale).toContain('DeepSeek Harness Team')
  }
  // The committed build output is what the plugin actually serves, so it carries the same promises.
  // A source-only check passed while lib/client.js still named the previous build repository and called
  // the project a fork; the panel kept showing that until someone ran a build. The copyright line lives
  // in the locale files and package metadata, not in this bundle, so only the two repository names are
  // asserted here.
  const built = read('lib/client.js')
  expect(built).toContain(UPSTREAM)
  expect(built).toContain(BUILD)
  expect(built, 'lib/ is stale: rebuild before committing attribution changes').not.toMatch(/Check-mj\/dsh-superagent-windows/)
})

it('points the package metadata at this repository while crediting upstream', () => {
  const pkg = JSON.parse(read('package.json')) as Record<string, unknown>
  expect(pkg.license).toBe('MIT')
  // The repository field is what a package page and a clone-from-metadata use, so it names this build;
  // upstream stays credited through the description and the contributors list instead.
  expect(JSON.stringify(pkg.repository)).toContain(BUILD)
  expect(JSON.stringify(pkg.contributors)).toContain('DeepSeek Harness Team')
  expect(String(pkg.description)).toContain(UPSTREAM)
  expect(String(pkg.homepage)).toContain(BUILD)
  expect(String(pkg.description)).toMatch(/适配版|adaptation/i)
  // The install contract is the package id, scope included: a profile resolves the plugin by this name.
  expect(pkg.name).toBe('@reserendipity/dsh-superagent')
})

it('has a changelog with the published version', () => {
  const changelog = read('CHANGELOG.md')
  expect(changelog).toMatch(/^## \[0\.\d+\.\d+\]/m)
  expect(changelog).toContain('DSH-Superagent')
})

it('never trades in a credential', () => {
  const files = trackedTextFiles()
  // An empty enumeration is not a pass: the scan has to see the repository.
  expect(files.length).toBeGreaterThan(0)
  const offenders = files.flatMap(file => scanCredentials(readFileSync(join(ROOT, file), 'utf8'))
    .map(name => `${file}: ${name}`))
  expect(offenders).toEqual([])
})

it('the credential scanner catches a planted token, so it is not passing by blindness', () => {
  const planted = `token = "${'ghp_'}${'a'.repeat(36)}"`
  expect(scanCredentials(planted)).toContain('GitHub personal access token')
  expect(scanCredentials('this file carries no credential')).toEqual([])
})

const HOST_PACKAGE = /^@deepseek-ai\//
// The panel bundle runs in the renderer, where the application already provides React.
const PANEL_PACKAGES = new Set(['react', 'react-dom'])
// `node:sqlite` is importable from 22.13 on, but stays out of `builtinModules` while it is marked
// experimental, so a Node-version-dependent list would fail the gate on some runners and pass on
// others. Name it explicitly rather than making the verdict depend on the runner's build.
const BUILTINS = new Set([...builtinModules.flatMap(name => [name, `node:${name}`]), 'node:sqlite'])
/** A specifier without its subpath, so `node:fs/promises` and `@scope/pkg/x` compare against their package. */
const packageOf = (id: string): string => {
  const cut = id.indexOf('/', id.startsWith('@') ? id.indexOf('/') + 1 : 0)
  return cut < 0 ? id : id.slice(0, cut)
}

/** The bare specifiers a built file asks for from outside - what some runtime would have to resolve. */
function externalIds(source: string): string[] {
  const found = new Set<string>()
  for (const pattern of [/from\s*['"]([^'".][^'"]*)['"]/g, /import\s*\(\s*['"]([^'".][^'"]*)['"]\s*\)/g, /require\s*\(\s*['"]([^'".][^'"]*)['"]\s*\)/g, /import\s+['"]([^'".][^'"]*)['"]/g])
    for (const match of source.matchAll(pattern)) found.add(match[1]!)
  return [...found].sort()
}
const unresolved = (name: string, source: string): string[] => externalIds(source).filter(id =>
  !HOST_PACKAGE.test(id) && !BUILTINS.has(packageOf(id)) && !(name === 'client.js' && PANEL_PACKAGES.has(packageOf(id))))

it('ships a build that resolves nothing beyond the host, node builtins and itself', () => {
  const files = readdirSync(join(ROOT, 'lib')).filter(name => name.endsWith('.js'))
  // An empty lib is not a pass: the build has to have run.
  expect(files.length).toBeGreaterThan(0)
  // Report the offending specifier next to its file: "a file has something" is not actionable on
  // a runner whose Node build differs from the maintainer's.
  const offenders = files.flatMap(name => unresolved(name, read(join('lib', name))).map(id => `${name}: ${id}`))
  expect(offenders).toEqual([])
  // The scanner is the gate, so prove it sees the two packages this replaced rather than passing by blindness.
  expect(unresolved('index.js', 'import { z } from "zod"\nimport lockfile from "proper-lockfile"')).toEqual(['proper-lockfile', 'zod'])
  // What the host really does provide must not be flagged, and the React allowance must not leak to the node bundle.
  expect(unresolved('index.js', 'import { a } from "@deepseek-ai/cordis"\nimport fs from "node:fs/promises"')).toEqual([])
  expect(unresolved('client.js', 'require("react/jsx-runtime")')).toEqual([])
  expect(unresolved('index.js', 'require("react/jsx-runtime")')).toEqual(['react/jsx-runtime'])
  // Nothing is left to install for them either, which is what makes a linked local directory work at all.
  const pkg = JSON.parse(read('package.json'))
  expect(pkg.dependencies ?? {}).toEqual({})
  expect(Object.keys(pkg.devDependencies)).toEqual(expect.arrayContaining(['zod', 'proper-lockfile']))
})
