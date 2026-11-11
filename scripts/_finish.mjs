// 一次性收尾脚本：修断言、登记文档、加测试。跑完即删。
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = 'D:/AI_Workspace/Tools/dsh-superagent-local'
const read = p => readFileSync(`${ROOT}/${p}`, 'utf8').replace(/^/, '')
const write = (p, text) => { writeFileSync(`${ROOT}/${p}`, text.replace(/^/, ''), 'utf8'); console.log(`wrote ${p}`) }
const must = (hay, needle, label) => { if (!hay.includes(needle)) throw new Error(`anchor not found: ${label}`) }

// ---- 1) release-invariants：homepage 指向本分支；去掉重复断言 ----
let inv = read('tests/release-invariants.spec.ts')
must(inv, "  expect(String(pkg.homepage)).toContain(BUILD)", 'homepage assert')
inv = inv.replace("  expect(String(pkg.homepage)).toContain(BUILD)",
  '  // The homepage is where a reader lands from the package page, so it names this branch.\n  expect(String(pkg.homepage)).toContain(BRANCH)')
const dup = `  expect(String(pkg.description)).toMatch(/适配版|adaptation/i)
  // The install contract is the package id: the profile resolves the plugin by this name, and the patch inserts
  // entries with it. It stays the adaptation's id because that is what an existing install already uses.
  expect(pkg.name).toBe('@reserendipity/dsh-superagent')
  // This branch is a branch of upstream, so its own repository must be reachable from the metadata too.
  expect(JSON.stringify(pkg.repository)).toContain(BRANCH)`
must(inv, dup, 'metadata block')
inv = inv.replace(dup, `  expect(String(pkg.description)).toMatch(/适配版|adaptation/i)
  // The install contract is the package id: the profile resolves the plugin by this name, and the patch inserts
  // entries with it. It stays the adaptation's id because that is what an existing install already uses.
  expect(pkg.name).toBe('@reserendipity/dsh-superagent')`)
write('tests/release-invariants.spec.ts', inv)

// ---- 2) 007 架构文档：Modules 表 + Tests 表登记新模块，并修正那句插件描述 ----
let arch = read('docs/007-architecture.md')
const inboxRow = '| `src/sources/inbox.ts` | The Mode A inbox kind and plugin entry, exported as `./inbox-watch`: task files in a local directory become Triggers, the archive move is the cursor, and replies append to a file under `done/` |'
must(arch, inboxRow, 'inbox module row')
arch = arch.replace(inboxRow, `${inboxRow}
| \`src/sources/filewatch.ts\` | The file-watch kind and plugin entry, exported as \`./filewatch-watch\`: one \`fs.watch\` handle per configured directory, the four event names reported as one signal shape, the settled state re-checked after the debounce window, and the matching experiences attached before thinking |
| \`src/experience/store.ts\` | The experience layer: one JSON file under the state directory, the record shape shared with \`scripts/experience.mjs\`, matcher semantics (an empty list means any), and the use counter that orders several habits |`)

const oldSentence = '`src/sources/github.ts`, `src/sources/feishu.ts` and `src/sources/inbox.ts` are also the entries of the three Source plugins, built by `tsdown.config.ts` and exported in `package.json` as `./github-watch`, `./feishu-watch` and `./inbox-watch`. The bundle\'s `cordis.patch.yml` inserts the four plugins, with Feishu and the inbox disabled.'
must(arch, oldSentence, 'source entries sentence')
arch = arch.replace(oldSentence, '`src/sources/github.ts`, `src/sources/feishu.ts`, `src/sources/inbox.ts` and `src/sources/filewatch.ts` are also the entries of the four Source plugins, built by `tsdown.config.ts` and exported in `package.json` as `./github-watch`, `./feishu-watch`, `./inbox-watch` and `./filewatch-watch`. The bundle\'s `cordis.patch.yml` inserts all five plugins: **GitHub, Feishu and the inbox are disabled, the file watch is enabled**, because this branch exists for the local signal loop and needs no account and no network. A disabled entry stays in the patch rather than being deleted, so an operator re-enables it with one line in the profile patch (`- id: dsh-superagent-github` / `disabled: false`) and an upgrade still lands on the same file set as upstream.')

const inboxTestRow = '| `tests/inbox.spec.ts` | The inbox Source on a `SourceContext`: file translation and stable ids, poll rounds with archiving, name'
must(arch, inboxTestRow, 'inbox test row prefix')
const cut = arch.indexOf('\n', arch.indexOf(inboxTestRow))
arch = arch.slice(0, cut) + '\n| `tests/filewatch.spec.ts` | The file-watch Source: name and event filters, the state machine of `classify`, signal ids and the experience line, the schema defaults, and a real `fs.watch` round that reports one dropped file |' + arch.slice(cut)
write('docs/007-architecture.md', arch)

console.log('done')
