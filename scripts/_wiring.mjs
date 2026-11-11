// 一次性接线脚本：给 dsh-superagent-local 加 filewatch 源与经验层。
// 用 node 改 JSON/YAML，避免 PowerShell 内联转义与 BOM 问题。跑完即可删。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const ROOT = 'D:/AI_Workspace/Tools/dsh-superagent-local'
// A BOM would break JSON.parse here and Node's loader in the host, so strip it on read and never write one.
const read = p => readFileSync(`${ROOT}/${p}`, 'utf8').replace(/^\uFEFF/, '')
const write = (p, text) => { writeFileSync(`${ROOT}/${p}`, text.replace(/^\uFEFF/, ''), 'utf8'); console.log(`wrote ${p}`) }

// ---- 1) package.json：加 exports、放宽 peer 到宿主真实范围、加 scripts 入口 ----
const pkg = JSON.parse(read('package.json'))
pkg.exports['./filewatch-watch'] = './lib/filewatch-watch.js'
// 宿主是 0.2.2-rc.1，cordis ~4.1.0 / schemastery 3.18.5；精确钉版会被兼容性闸门整条 denial。
pkg.peerDependencies['@deepseek-ai/cordis'] = '>=4.0.5-alpha.1 <5'
pkg.peerDependencies['@deepseek-ai/schemastery'] = '>=3.18.5-alpha.1 <4'
pkg.engines.dsh = '>=0.2.1-alpha.2 <0.3.0'
pkg.scripts['experience'] = 'node scripts/experience.mjs'
// 本分支的署名：仓库指向用户 fork，上游与本构建都留在 description/contributors 里。
pkg.repository = { type: 'git', url: 'git+https://github.com/Xiao-wuwu/dsh-superagent-prototype.git' }
pkg.homepage = 'https://github.com/Xiao-wuwu/dsh-superagent-prototype/tree/local-filewatch'
pkg.contributors = [
  { name: 'DeepSeek Harness Team', url: 'https://github.com/deepseek-ai/dsh-superagent-prototype' },
  { name: 'ReSerendipity (Windows adaptation)', url: 'https://github.com/ReSerendipity' },
  { name: 'Check-mj (prior Windows port)', url: 'https://github.com/Check-mj' },
]
pkg.author = { name: 'Xiao-wuwu', url: 'https://github.com/Xiao-wuwu' }
pkg.description = '（非官方产品）本地优先的 Super-agent：在官方 dsh-superagent-prototype 与其 Windows 适配版之上，加入真事件文件监听（file.created/changed/renamed/deleted 四种同形信号）与经验库（ReActive：信号来了先查经验再思考行动）。默认 local 模式，不配 GitHub 也能跑。上游 https://github.com/deepseek-ai/dsh-superagent-prototype（MIT, Copyright (c) 2026 DeepSeek Harness Team）；Windows 适配 https://github.com/ReSerendipity/dsh-superagent；本分支 https://github.com/Xiao-wuwu/dsh-superagent-prototype'
write('package.json', `${JSON.stringify(pkg, null, 2)}\n`)

// ---- 2) cordis.patch.yml：github 源默认关掉、feishu 保持关、加 filewatch 源（默认开）----
let patch = read('cordis.patch.yml')
const githubBlock = `    - id: dsh-superagent-github
      name: '@reserendipity/dsh-superagent/github-watch'`
if (!patch.includes(githubBlock)) throw new Error('patch: github source block not found as expected')
patch = patch.replace(githubBlock, `${githubBlock}
      disabled: true`)
const inboxAnchor = `    # Mode A Source: a local inbox directory whose files become tickets, so one GitHub account suffices. Enable it in a profile.
    - id: dsh-superagent-inbox
      name: '@reserendipity/dsh-superagent/inbox-watch'
      disabled: true`
if (!patch.includes(inboxAnchor)) throw new Error('patch: inbox source block not found as expected')
const filewatchBlock = `${inboxAnchor}
    # Local-first signal source: real fs.watch events, one shape for created/changed/renamed/deleted. On by default,
    # because this branch exists for the file-watch loop; it needs no account and no network.
    - id: dsh-superagent-filewatch
      name: '@reserendipity/dsh-superagent/filewatch-watch'`
patch = patch.replace(inboxAnchor, filewatchBlock)
write('cordis.patch.yml', patch)

// ---- 3) 测试：包名断言改为真实安装 id；署名断言加本分支 ----
let inv = read('tests/release-invariants.spec.ts')
inv = inv.replace("const BUILD = 'ReSerendipity/dsh-superagent'",
  "const BUILD = 'ReSerendipity/dsh-superagent'\n// This branch is published as a branch of the upstream repository under the operator's account.\nconst BRANCH = 'Xiao-wuwu/dsh-superagent-prototype'")
inv = inv.replace("  expect(pkg.name).toBe('@reserendipity/dsh-superagent')",
  '  // The install contract is the package id: the profile resolves the plugin by this name, and the patch inserts\n' +
  "  // entries with it. It stays the adaptation's id because that is what an existing install already uses.\n  expect(pkg.name).toBe('@reserendipity/dsh-superagent')\n" +
  '  // This branch is a branch of upstream, so its own repository must be reachable from the metadata too.\n' +
  '  expect(JSON.stringify(pkg.repository)).toContain(BRANCH)')
inv = inv.replace("  expect(JSON.stringify(pkg.repository)).toContain(BUILD)",
  `  expect(JSON.stringify(pkg.repository)).toContain(BRANCH)`)
write('tests/release-invariants.spec.ts', inv)

// ---- 4) 默认声明式配置：local 模式 + 监听下载目录，开箱即用 ----
const example = `# Local-first defaults for this branch: no GitHub Source, tickets come from file events and the inbox.
# Copy to <stateDir>/config.json (or point configPath at it) and edit the watched directories.
{
  "$comment": "Sources, Policy and Execution blocks follow src/policy.ts SettingsSchema.",
  "sources": {
    "filewatch": {
      "enabled": true,
      "config": {
        "dirs": [{ "path": "CHANGE ME: an absolute directory to watch" }],
        "recursive": true,
        "events": ["file.created", "file.renamed"],
        "patterns": [],
        "previewText": true,
        "scanOnStart": false
      }
    },
    "inbox": { "enabled": true, "config": { "inboxDir": "", "actor": "local", "pollSeconds": 10 } }
  },
  "policy": {
    "sources": {
      "filewatch": { "allowed": [{ "id": "filewatch", "name": "文件监听" }] },
      "inbox": { "allowed": [{ "id": "local", "name": "本机" }] }
    }
  },
  "executor": {
    "root": "",
    "prepareCommand": ""
  }
}
`
write('examples/local-filewatch.config.json', example)

console.log('done')
