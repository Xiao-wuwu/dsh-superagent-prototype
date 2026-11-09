# 架构 — DSH-Superagent

> 治理定位：`delivery=tool`、`lifecycle=active`、`visibility=private`、`distribution=none`（`ReSerendipity/.github` 的 `governance/desired-state.json`）。
> 本文只描述本仓内部结构；治理规范正文只在 `.github/governance`，不在此复述。

## 1. 定位

把官方研究原型 `deepseek-ai/dsh-superagent-prototype` 变成 Windows 上可日常使用的插件：事件源进来 → 两级过滤 → 建单 → 隔离会话执行 → 结果回到原处。给单人或小团队自用，不是官方产品，也不承载多租户 SaaS。

## 2. 组件与依赖方向

```text
src/infra ──→ src/core ←──┐          上游（不依赖任何本仓上层）
   ↑   └──→ src/sources ──┤          src/core 零外部导入（实测 grep 为空）
   │        src/executor ─┤          src/app 不导入 src/client
   └──→ src/app ──────────┘          src/sources 不导入 src/app
              ↑
        src/client  ── HTTP ──→  src/app/http.ts
```

| 组件 | 目录 | 职责 | 是否入库 |
|---|---|---|---|
| 领域引擎 | `src/core/` | Ticket/Assignment/Thread/Mandate 状态机与端口定义；**与上游逐字节相同** | 是 |
| 平台与授权 | `src/policy.ts`、`src/admission.ts`、`src/deployment.ts`、`src/setup.ts` | 门（gate）、准入表、部署解析、启动自检 | 是 |
| 运行时服务 | `src/app/` | 编排、Sessions、投递（`outbox.ts`/`delivery.ts`）、评估、面板 HTTP API（`http.ts` + `views/`）、提示词组装（`prompts.ts`/`prompt-presets.ts`/`context.ts`）、声明式配置（`config-file.ts`/`config-watch.ts`）、Watchdog 与分片（`watchdog.ts`/`shards.ts`）、工具面（`tools/`） | 是 |
| 事件源 | `src/sources/` | 插件契约 `kind.ts`、注册表 `registry.ts`、GitHub / 飞书 / 本地收件目录各自一个文件 | 是 |
| 执行器 | `src/executor/` | 为每张工单起隔离 DSH 会话并接管其生命周期 | 是 |
| 基础设施 | `src/infra/` | 命令调用（含 Windows `.cmd` 经 shell 的约束）、环境、路径、文本 | 是 |
| 面板 | `src/client/` | React 页面（7 个页签）、双语字典 `locales.ts`、草稿与路由 | 是（源码）+ `lib/client.js`（产物） |
| 提示词资产 | `prompts/` | 内置段落、`team/`（团队三段默认）、`presets/`（风格预设样式层） | 是 |
| 运维 skill | `skills/` | 给智能体读的 SKILL.md | 是 |
| 构建产物 | `lib/` | tsdown 输出；**故意入库**，让 git 安装无需构建 | 是（例外，见 §5） |
| 历史外壳（已移除） | `windows-app/` | 便携 Electron 外壳，2026-11-07 从仓库删除；历史见 git 与 `CHANGELOG` | 否（已不存在） |
| 命令行工具 | `scripts/` | Python 服务管理器、`.cmd` 垫片、guard/watchdog PowerShell、发布闸门 `release-check.ps1`、`pack-plugin.mjs`、`a9-check.js` | 是 |

一处**已知的反向边**：`src/infra/` 有文件导入 `src/sources/host.ts`，所以 infra 不是严格最底层。改 `sources/host.ts` 的接口时必须同时核对 `infra/`。

## 3. 数据流

1. 输入：`src/sources/<kind>.ts` 轮询（GitHub 通知 / 飞书消息）或读取收件目录 `stateDir/inbox/*.md`，产出 Trigger。
2. 处理：`src/policy.ts` 的门先按名单与准入表判 admissible/strength；放行的再交 `src/app/assessment.ts` 做语义评估（接单模式与规则决定是否 accept）；`src/core/engine.ts` 建 Ticket 与 Assignment。
3. 执行：`src/executor/dsh.ts` 在 `stateDir/work/<ticket>` 的独立工作树里起 worker Session，工具面由角色决定（主 Session 只读、执行器全量）。
4. 输出 / 持久化：`src/app/outbox.ts` 记账，`src/app/delivery.ts` 走各来源的 Channel —— GitHub 评论 / 飞书消息 / 把回信写进 `stateDir/inbox/done/<file>.reply.md`；状态持久化在 `stateDir/orchestrator.sqlite`（`src/app/store.ts` + `versions.ts`），单实例锁是 `<stateDir>.lock` 目录。

## 4. 外部依赖

| 依赖 | 用途 | 缺失或不可用时的行为 |
|---|---|---|
| `@deepseek-ai/*`（peer，由宿主应用提供） | Cordis 装载、Session/工具/WebServer 接口 | 加载期失败，插件不激活；profile 的 `node_modules` 里出现这些包反而是错的 |
| `zod`、`proper-lockfile` | 配置校验、状态目录锁 | 已打进 `lib`（`tsdown` 的 `deps.alwaysBundle`），安装期不再需要；漏打会在 `link:` 目录安装时 `ERR_MODULE_NOT_FOUND`，由 `tests/release-invariants.spec.ts` 拦 |
| `node:sqlite` | 工单/收件/历史存储 | Node 需 `^22.19.0 \|\| >=24`，否则启动失败关闭 |
| `gh` CLI | GitHub 读写与账号核验 | `setup.problem` 置位，概览判读转「等待配置」，不轮询不派单 |
| `git` | 工单工作树与交付 | 同上；`mode: local` 下只用于本地提交 |
| Python ≥3.8 | 仅命令行服务管理器 `scripts/dsh-superagent` | 报 `needs Python 3.8 or later on PATH`；插件运行期不受影响 |
| `lark` CLI | 飞书来源 | 飞书默认关闭，仅该来源报错，不影响其他来源 |

## 5. 边界与非目标

- 不改领域引擎语义：`src/core/**` 与上游逐字节相同，上游同名机制实现后按 `docs/WINDOWS-DELTA.md` 删本项目的版本切回上游。
- 不把工具集做成面板可配置项（主 Session 只读 / 执行器全量是产品保证）。
- 不承载：密钥与 token（只走环境变量与 `gh` 凭据目录）、`local/` 与 `AGENTS.md`（仅本地）、构建产物以外的生成物（`dist/`、`__pycache__/`）。
- `lib/` 入库是**有意例外**：git 安装路线要求产物随仓库走，否则装机即失败。
- Mode B（第二 GitHub 账号的团队语义）搁置；社区 Source 依赖的 `inject: ['orchestrator']` 未接。
- 与相邻仓分工：`<maintainer>/<repo>` 是 Mode A 首单验证的目标仓库，不含插件代码；`windows-app/` 是已移除的历史外壳，与插件运行期无关。

## 6. 变更影响面

| 改什么 | 必须同步 | 由谁校验 |
|---|---|---|
| `src/**` 任何代码 | `pnpm build` 后提交 `lib/` | `release:check` 的「committed lib matches a fresh build」 |
| `package.json` 依赖 | `tsdown.config.ts` 的 `alwaysBundle` 清单 + `pnpm-lock.yaml` | `tests/release-invariants.spec.ts` 扫 `lib/*.js` 的外部说明符 |
| `src/policy.ts` / `src/admission.ts` 语义 | `docs/002-authorization.md`、面板人话三组表单措辞 | `tests/policy.spec.ts`、`tests/admission-plain.spec.ts`、`tests/panel-eval.spec.tsx` |
| `src/client/**` 文案 | `locales.ts` 中英两份占位符一致 | `tests/locales.spec.ts` |
| `prompts/**` 默认文本 | 角色提示词预算、`FLOOR` 底线短语 | `tests/model-surface.spec.ts`、`tests/prompt-presets.spec.ts` |
| 版本号 | `package.json` + `CHANGELOG.md` 同版；tag 只在发布时打 | `release:check` 的 changelog 检查 |
| 文档路径 | 根只留 README/CHANGELOG/LICENSE；其余在 `docs/`，链接按仓根相对 | `tests/docs.spec.ts` |
