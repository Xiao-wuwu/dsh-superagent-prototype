# 009 声明式配置（本项目相对上游的增量）

上游把 Sources、Policy、Execution 和 Prompts 都交给面板管理，配置存在 DSH 的 settings 存储里（`orchestrator.sqlite`）。这对一个人试用够用，对**团队**不够：改配置没法 review、没法 diff、换机器要手点一遍、也说不清"上周为什么它不接单"。

这一章描述本项目的增量：**把配置变成一个可以进版本库的 JSON 或 YAML 文件**，启动时应用。

> 这是本适配版 的扩展，不在官方原型里。实现坐标 `src/app/config-file.ts`（加载与合并）与 `src/app/config-yaml.ts`（YAML 子集），并在 `docs/WINDOWS-DELTA.md` 里记为增量项。

## 1. 怎么启用

1. 写一个 JSON 或 YAML 文件，放在你愿意的地方（推荐随仓库：`<checkout>/superagent.settings.json` 或 `superagent.settings.yaml`；**扩展名决定解析器**：`.yaml` / `.yml` 走 YAML，其余按 JSON）。
2. 在 profile 的机器配置里指出它的绝对路径：

```yaml
# ~/.dsh/profiles/superagent/cordis.patch.yml
- id: dsh-superagent
  config:
    stateDir: C:/Users/<you>/.dsh/state/superagent
    configPath: C:/path/to/superagent.settings.json
```

3. 启动服务一次（`configPath` 写在 profile 里，插件安装/升级不会覆盖它；原来的 `install.cmd` 已随外壳移除）。之后改文件即生效：服务会监听这个文件（见 §7 第一条），保存后自动重新应用，不必再重启。

## 2. 文件格式

**JSON 或 YAML，扩展名决定解析器**。`.yaml` / `.yml` 走仓库自带的受限 YAML 子集（`src/app/config-yaml.ts`），其余按 JSON 解析；两种格式都先解析成普通对象，再走**同一条** `mergeDeclarative()` + `SettingsSchema` 校验路径，所以 `$prune` 与所有约束在两种格式下行为一致。

手写解析器而不是引依赖，原因还是同一条：`lib/` 是提交进仓库的构建产物，打包一个 YAML 库会让发布物多出上百 KB，并带来第三方许可证的保留义务。

子集支持：块映射与块序列（含 `- key: value`）、缩进嵌套、行内 `[a, b]` 与 `{a: b}`、单/双引号与转义、`true/false/null/~` 与数字、行尾 `#` 注释、`|` 与 `>` 块标量。**不支持**：tab 缩进、锚点/别名、合并键 `<<`、标签 `!!`、多文档 `---`/`...`、复杂键 `? `、重复键——遇到这些一律报错并给出所在行（`line N, column M`），而不是猜一个结果。

任何键都是可选的——**没写的块保持面板里已存的值**。

```json
{
  "sources": {
    "github": {
      "enabled": true,
      "config": { "repository": "acme/widgets", "cli": "C:/tools/gh/bin/gh.exe" }
    }
  },
  "policy": {
    "sources": { "github": { "allowed": [{ "id": "alice" }, { "id": "bob" }] } }
  },
  "executor": {
    "prepare": "C:/path/to/prepare-ticket.cmd",
    "maxWorkers": 3
  }
}
```

同一份配置的 YAML 写法：

```yaml
sources:
  github:
    enabled: true
    config:
      repository: acme/widgets
      cli: C:/tools/gh/bin/gh.exe
policy:
  sources:
    github:
      allowed:
        - id: alice
        - id: bob
executor:
  prepare: C:/path/to/prepare-ticket.cmd
  maxWorkers: 3
```

字段名与面板/管理 API 完全一致（见 `docs/006-deployment.md` 的 blocks 一节），因为校验复用的是同一份 `SettingsSchema`。

## 3. 合并规则

| 块 | 规则 |
|---|---|
| `sources` | **逐键合并**：只声明 `github` 时，已安装的 `feishu` 保持原样 |
| `policy` | 顶层字段逐字段覆盖；`policy.sources` 逐键合并 |
| `eval` / `executor` | 整块覆盖（该块声明的字段生效，未声明的取 schema 默认值） |

合并结果会再走一次 `SettingsSchema.parse()`，因此跨块约束（例如 Policy 里点名了一个未安装的 Source）仍然会被拦下。

## 4. 时机与优先级（重要取舍）

- 应用时机：`Runtime.initialize()` 里、**setup 之前**。所以文件里的仓库与 CLI 会先于账号检查生效。
- 优先级：**启动时文件 > 面板**。但面板保存现在会**写回同一个文件**（§11），所以正常路径下两者不再分叉；写回失败或冲突时整次保存被拒绝，不会出现"面板显示成功、重启丢失"。

## 5. 失败行为

**fail-open**：文件读不到、不是合法 JSON / YAML、或字段校验失败时，只写一条 warning 日志（`dsh-superagent: The declarative settings file …`），服务继续用已存设置启动。

错误文案带位置：YAML 的解析错误是 `… not valid YAML (<path>): line N, column M: <原因>`；校验失败会回查出错键的行号，形如 `eval.mode (line 4): …`（行号来自解析时记录的 `路径 → 行号`，JSON 文件只报路径，不报行号）。

理由：配置是给人改的，一个逗号不该让整个智能体停机。代价是"改了没生效"——所以排障第一条永远是看日志里那行 warning。面板仍显示实际生效的设置，可与文件对照。

## 6. 它为什么是后续工作的地基

- **多仓库/多账户**：先要能声明 N 个 Source，才谈得上跑 N 个。
- **策略可 review**：允许名单与规则进版本库之后，改动才有 diff 和评审。
- **可观测性对比**：配置是文件，才能把"某次改动 → 接单率变化"对应起来。

## 7. 尚未做

- ~~不支持热加载：改文件需重启服务。~~ → **已支持（2026-11-07）**：服务启动时把该文件的**父目录**挂上 `fs.watch`（`src/app/config-watch.ts`），按文件名过滤、去抖动（一次保存会连发多个事件），命中后重跑一遍本文件的应用逻辑（`Runtime.applyDeclarativeSettings()`），**不需要重启服务、也不需要进面板**。三处细节是刻意的：
  - **监听目录而不是文件**：VS Code / Notepad++ 这类编辑器是「写临时文件再 rename 覆盖」，针对文件句柄的 watch 会在 rename 后失效并静默死掉；监听目录能跨过 rename。**按候选名过滤**：配置路径本身加上同 stem 的 `.yaml` / `.yml`，保存任一都会重载（同名并存时显式 `configPath` 优先，不会悄悄换格式）。
  - **改坏了不留伤**：新内容解析失败时只写 warning，沿用上一次生效的设置（fail-open 不变）。
  - **改实例集合仍重启一次**：Source 的轮询循环随插件挂载，无法在运行中的 pass 下面热插拔；此时日志会写明 `changed the Source instances (a -> b); restarting to mount them`。所以「热加载」的范围是策略/执行/提示词等非实例字段，实例集合的增删仍是一次重启——这不是退步，是把原先「什么都要重启」收窄到「只有这一种要重启」。
- ~~不支持 YAML。~~ → **已支持（2026-11-07）**：扩展名 `.yaml` / `.yml` 走 `src/app/config-yaml.ts` 的受限子集，其余仍按 JSON；两种格式产出普通对象后走同一个 `mergeDeclarative()` + `SettingsSchema` 校验，等价性由 `tests/config-file.spec.ts` 逐字段断言（含 `$prune`）。行号：解析错误由解析器给出 `line/column`，校验失败按「路径 → 行号」回查。不支持锚点/别名/合并键/标签/多文档/复杂键——遇到即报错，不猜。
- ~~不写回：面板改动不会同步进文件（单向：文件 → 存储）。~~ → **已写回（2026-11-07）**：面板保存会把改动的键写进本实例自己的 `configPath`，见 §11。
- ~~未提供 JSON Schema 文件给编辑器自动补全~~ → **已提供（2026-11-07）**：`schema/declarative-settings.schema.json`，由 `SettingsSchema` **生成**（`src/app/config-schema.ts` + `scripts/export-settings-schema.ts`），不是手写的副本。用法见 §10。

## 8. 示例文件

仓库里有一份带占位符的模板：`schema/declarative-settings.example.json`。复制它、填好路径与账号，再把 `configPath` 指向你的副本即可；要用 YAML 就把副本改名为 `.yaml` 并按 §2 的子集重写（同一份配置的两种写法在 §2 各有一份）。

## 9. `$prune`：删除也需要声明

覆盖只能「增/改」，不能「删」。把某个 Source 从文件里去掉，它会继续留在已存设置里——这一点在真实环境里咬过人：删掉第二个实例后服务一直 `paused`，报 `multipleSourcesUnsupported`。

所以文件支持一个指令（**以 `$` 开头的键在校验前被剥离**，不属于 SettingsSchema）：

```json
{
  "$prune": { "sources": ["acme-second"] },
  "sources": { "github": { "enabled": true, "config": { "...": "..." } } }
}
```

- `$prune.sources`：要删除的 Source 实例 id 列表
- 删除先于合并执行，所以同一份文件里既删又改是确定的
- 只在启动时生效，与其它块一致
- **YAML 下完全相同**：`$prune` 是同一个映射里的一个键，解析结果保留键的原始顺序，剥离 `$` 前缀发生校验之前，两条路径共用一份代码

```yaml
$prune:
  sources:
    - acme-second
```

## 执行块新增的运行时段落

`executor` 块现在也承载运行时可调的控制项（面板「执行」页里可改，同样可用本文件的声明式配置覆盖）：

```json
{ "executor": { "watchdogMinutes": 30, "watchdogStallMinutes": 45, "watchdogGuidance": "", "routerShards": 1 } }
```

- `watchdogMinutes`：外部控制回路摘要间隔（0 关闭，默认 30）
- `watchdogStallMinutes`：停滞判定阈值（默认 45）
- `watchdogGuidance`：常驻指令，随摘要下发给 Watchdog
- `routerShards`：Router 分片数（默认 1；**改后需重启**，分片会话在启动时解析）

机器配置（`cordis.patch.yml`）只保留启动接线：`stateDir` 与 `configPath`。把旧键写回机器配置会得到一条明确的报错，提示已移到 Execution settings。

## 10. 编辑器提示（JSON Schema）

在文件第一行加一行 `$schema`，VS Code（内置 JSON 语言服务）就会按块名补全、标错：

```json
{
  "$schema": "./schema/declarative-settings.schema.json",
  "policy": { "...": "..." }
}
```

- **路径是相对的**：`$schema` 按文件自身位置解析。文件若不在仓里，就写 `file:///C:/Users/<你>/APP/repository/dsh-superagent/schema/declarative-settings.schema.json`，或直接引用 schema 里的 `$id`。**另有一个分发侧限制（2026-11-07 实测）**：插件打包白名单（`package.json` 的 `files`）不含 `schema/`，所以 git / tarball / 应用插件页装出来的副本里**没有**这个 schema 文件——相对写法只在 checkout 里成立，装出来的实例请用 `file:///` 绝对路径（指向 checkout）或 `$id`；让安装副本自带 schema 需要把 `schema` 加进 `files`（尚未做）。
- **schema 是生成的**：改了 `SettingsSchema` 里的字段后跑 `node --experimental-transform-types scripts/export-settings-schema.ts` 重新生成。`tests/config-schema.spec.ts` 会比对「仓库里的文件」与「现场重新生成的结果」，忘记重新生成时它**会红**——这样「文件存在」与「文件是当前的」不会被混为一谈。
- **三条约束写进了 schema**：每个块都是可选的（`required` 为空，所以只声明 `policy` 是合法的）；顶层未知键被拒（`policies` 这种拼写错误会在编辑器里报错，而不是悄悄保留已存块）；`$prune` 只有一个合法子键 `sources`。
- **`default` 只是提示**：schema 里保留了字段默认值供补全展示，但 JSON Schema 的 `default` 不参与校验；真正生效的默认值仍由 `SettingsSchema` 在解析时填。
- **YAML 文件没有内置补全**：这份 schema 针对 JSON；VS Code 内置的 YAML 支持不会读 `$schema`，要提示需另装 YAML 扩展并按块名映射，或直接用 JSON 版本。校验本身不受影响——两种格式都走 `SettingsSchema`。

## 11. 面板改动写回（2026-11-07）

之前面板保存只进 `orchestrator.sqlite`，而启动时 `configPath` 的文件优先于存储（§4），所以配了文件的实例重启一次，面板改的值就被文件里的旧值盖回去。现在面板保存（origin `panel`）在提交存储**之前**，先只把这次真正变化的键写回**本实例的**文件（`src/app/config-write.ts`）。

- **只写本实例的文件**：目标由本实例机器配置里的 `configPath` 决定，解析规则与读取完全相同（配置路径不存在时按同 stem 的 `.yaml`/`.yml` 回退）；没有 `configPath` 的实例不写任何文件，面板值照旧只存数据库——这种实例本来就没有文件会在启动时覆盖它。绝不写 bundle/profile 的 `cordis.patch.yml`，也不会碰另一个实例的路径。
- **最小侵入**：只写**这次变化的叶子键**。YAML 走行级补丁：命中键的那一行只换值，其余行（注释、空行、键顺序、缩进）逐字保留，行尾注释连原来的对齐空格一起留下；数组（`policy.rules`、`allowed`、`blockedCommands` 等）视为一个值整体替换；文件里没有的键追加到所属映射末尾。**取舍**：被替换值的子树内部若有注释，会随该值一起被替换；文件其它位置的注释不受影响。JSON 没有注释，按文件自身的缩进重新序列化，键顺序不变。
- **冲突**：写前比对「本实例上次读取/写回时的 mtime + 大小 + 文本」。外部手改过（任一项变了）就抛 `DeclarativeConflict`，HTTP 返回 **409**，**不覆盖**、不丢数据，提示先重载面板再保存。外部文件被热加载应用后，受影响的设置块 revision 会前进（`Store.bumpBlock`），面板拿着旧 revision 保存同样得到 409。
- **原子且可感知**：临时文件 + rename 落盘；解析/校验/写入任一步失败都抛 `DeclarativeWriteError`，HTTP 返回 **500**（消息带路径），且此时存储事务**尚未提交**，面板不会显示成功而磁盘没变。补丁落盘前会重新解析并逐键核对「该键确实等于保存值」，解析器补丁出错也会被拦成失败而不是写坏文件。
- **顺序**：先写文件、后提交存储。文件写失败 → 存储不变；存储失败（极少）→ 文件已是新值，重启按文件生效。
- **只用于面板**：`sync`（外部账号数据同步）与 `tool` 的保存不写回，避免把非面板决定的结果写进用户文件。
- **`pause` 不入文件**：暂停是临时运行状态，不属于声明式配置。
- **不支持在序列内部编辑**：写回把序列当整体替换，因此文件里若在需要修改的路径上出现同缩进序列或非空 flow 值（`{...}`），会明确报错而不是猜着改；`{}` 空映射会被展开成块写法后再插入。

