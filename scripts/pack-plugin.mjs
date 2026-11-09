/**
 * Builds the installable plugin tarball and its checksum, the artifact a one-line install consumes:
 *
 *   pnpm pack:plugin
 *   dsh plugin --profile <name> add "file:<abs>/dist/dsh-superagent-<version>.tgz"
 *
 * The tarball is what `files` in package.json lists - lib, prompts, skills, locale, cordis.patch.yml,
 * README - so a git-less install still carries the built client, the team prompt defaults and the bundle
 * patch. `dist/checksums.json` accumulates every version built here, which is what the release gate and a
 * manual install compare against.
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version
const dist = join(root, 'dist')
mkdirSync(dist, { recursive: true })

// Build first: a tarball of a stale lib/ is what a git install would serve, only worse because it is pinned.
// `pnpm pack` names a scoped package `scope-name-version.tgz`; the artifact name, the docs and the release
// gate all use the unscoped name, so pack fresh and rename it back rather than changing every citation.
const name = `dsh-superagent-${version}.tgz`
const tarball = join(dist, name)
const packed = join(dist, `${pkg.name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`)
rmSync(tarball, { force: true })
rmSync(packed, { force: true })
execSync('pnpm build', { cwd: root, stdio: 'inherit' })
execSync('pnpm pack --pack-destination dist', { cwd: root, stdio: 'inherit' })
if (existsSync(packed)) renameSync(packed, tarball)
if (!existsSync(tarball)) {
  const found = readdirSync(dist).filter(file => file.endsWith('.tgz'))
  throw new Error(`expected ${name}, found: ${found.join(', ') || '(none)'}`)
}
const digests = createHash('sha256').update(readFileSync(tarball)).digest('hex')
writeFileSync(`${tarball}.sha256`, `${digests}  ${name}\n`)
const ledgerPath = join(dist, 'checksums.json')
const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : {}
ledger[version] = { file: name, sha256: digests }
writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n')
console.log(`\n${name}\n  sha256 ${digests}\n  ${ledgerPath}`)
