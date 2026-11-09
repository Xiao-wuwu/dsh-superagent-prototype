# DSH-Superagent Changelog

## [0.2.0] — 2026-11-09

### Added

- **主对话总管模式（chatRouter，默认关闭）**：新建的普通 DSH 主对话可被剥夺命令、文件写入与子代理等执行工具，只保留派发/状态/只读工具；`forceDispatch` 的 guard 会拒绝越界调用并提示改用 `chat_dispatch`。每个新建主对话独立成为总管，不绑定固定 session id，彼此只共享工单库、不共享对话上下文。
- 派发链路：`chat_dispatch` 把任务写成普通本地收件目录 `.md`（与面板「派一张单」同一条路径）→ Trigger → Ticket → `worker-<ticket id>` **平级独立会话**（独立 cwd / workspace，不是 DSH `subagent`）；worker 结果以限长简报回投发起派发的主对话，完整 transcript 留在 worker。
- 插件面板新增「总管模式」设置分组：总开关、三档工具预设（`strict` / `standard` / `custom`）、自定义逐工具矩阵、强制派发、结果回传、并行工单数；`chatRouter` 同步进入声明式设置块与自动生成的 JSON Schema。

### Changed

- `src/app/sessions.ts` 新增 `decorateChatRouter()`，`src/app/runtime.ts` 注册 host 与简报轮询；既有 Router / Worker / Watchdog 会话行为不变。
- `docs/007-architecture.md` 模块表与测试表、`tests/panel-settings.spec.tsx`、`tests/policy.spec.ts`、`tests/fixtures/panel-server.ts` 同步；新增 `tests/chat-router.spec.ts`（13 例）与 `docs/027-chat-router.md`。

### Notes

- 默认关闭，存量部署零影响；仅对**新建会话**生效，已运行会话沿用创建时的工具白名单。
- 需要启用本地收件目录 Source 才能派单；建单与简报回投目前走 10s / 5s 轮询而非事件驱动。
- `chat_answer` 当前以 `engine.note` 简化，`worker.maxParallel` 尚未接到执行器槽位；真机端到端验收待做。详见 `docs/027-chat-router.md` §7。
- 本版本之前本地误留的 `v0.4.0` tag 与 `dist/` 产物已删除；0.4.0 从未发布到 npm、也没有 GitHub Release。

## [0.1.5] — 2026-11-09

### Changed

- `stateDir` 由必填改为**可选**：未配置时插件按 profile 派生 `<DSH home>/state/<profile>-superagent`（名为 `superagent` 的 profile 与无 profile 上下文沿用历史的 `state/superagent`）；显式配置始终优先，既有部署的数据目录不会移动。「一个 `stateDir` 只允许一个后端」的锁隔离语义原样保留。这消除了新装用户跳过配置步骤时的**静默失败**陷阱（该 entry 非必需、启动审计只警告、桌面端 host 的 stderr 被 Electron 吞进缓冲，用户只见「没有响应」）。
- README（中英）、`docs/006-deployment.md`、`docs/WINDOWS-SETUP.md`、`examples/profile.cordis.patch.yml` 同步改为「可选覆盖 + 派生默认」。
- 新增派生规则测试：`tests/deployment.spec.ts`（`defaultStateDir` 与 `machineOf` 回退、`DSH_HOME` 语义）、`tests/index.spec.ts`（`apply` 按 `profileContext` 派生并记日志）。

## [0.1.4] — 2026-11-09

### Fixed

- 状态目录锁回收（PR #18，已合并）：`Runtime` 在注册 HTTP 之前先对 `stateDir` 加锁，持锁者进程已死时立即回收（`src/app/state-lock.ts`），修复桌面端 `/orchestrator/api/state` 404 与面板「没有响应」的静默失败。新增 `tests/state-lock.spec.ts`。

### Changed

- 模式选择器中两个插件 preset 的显示名去掉「[内部]」前缀：`dsh-superagent 执行器`、`dsh-superagent 主 Session`（`cordis.patch.yml`）。DSH 的 preset 行没有从选择器隐藏的设置，名字不是功能开关；两个 preset 分别被执行器 Session 与主 Session 按 id 引用，用途警示继续由 description 承担。

## [0.1.3] — 2026-11-08

缺陷修复版。0.1.2 在 DeepSeek Harness 桌面端（DSH 0.2.2-rc.1）启动直接失败：`lib/client.js` 的客户端模块注册 id 仍是裸名 `dsh-superagent`，而桌面端按 scoped 包名组合客户端模块，报 `duplicate factory registration for "dsh-superagent"` 与 `1 entry did not activate @reserendipity/dsh-superagent: import failed`。CLI 宿主（0.2.1）容忍这种不一致，所以此前都只在 CLI 或一次性验证里通过。

### Fixed

- `lib/client.js` 的客户端模块注册 id 改为 `@reserendipity/dsh-superagent`；该 id 由 `tsdown.config.ts` 从 `package.json` 的 `name` 派生，不再手写，避免与包名再次漂移。
- 新增 `tests/client-module-id.spec.ts`：断言构建后的客户端注册 id 与 `package.json` 的 `name` 一致，CI 上会拦截回归。

### Docs

- README（中英文）与 CONTRIBUTING 说明 pnpm 的 `minimumReleaseAge` 策略：pnpm 11 起默认开启（默认 1 天），刚发布的版本在成熟前不会被裸包名解析到，需要显式写版本号才能装到。

## [0.1.2] — 2026-11-08

文档修正版，无功能变更。README 里写死「当前 0.1.0」的表述改为版本无关（npm 上已发布的最新版本 / 自 v0.1.0 起建立公开基线），其余文档同步去掉会随下次发版失效的版本锚点。

### Changed

- README（中英文）：安装段的「当前版本」改为「npm 上已发布的最新版本」/「the latest published version on npm」；「公开基线 v0.1.0」改为「自 v0.1.0 起（建立）公开基线」。
- docs/WINDOWS-SETUP.md、docs/WINDOWS-DELTA.md：同一批「公开基线为 0.1.0」改为「自 0.1.0 起为公开基线」。

### Notes

- 无代码、无 `lib/` 变更；功能与 0.1.1 相同。

## [0.1.1] — 2026-11-08

文档修正版，无功能变更。0.1.0 的 npm tarball 内含发布前写的 README（安装段只有 Git 地址、并标注 npm 尚未发布），npm 页面因此显示过期信息；本版只更新文档并重新打包。

### Changed

- README：安装段以 `dsh plugin add "@reserendipity/dsh-superagent"` 为主、Git 地址为备选；发布状态与英文 Honest limits 改为已发布；FAQ 只描述当前包名。
- CONTRIBUTING / CHANGELOG：发布后验证改为比对内容而非字节（npm 打包器与 `pnpm pack` 产出的 tarball 字节不同）。

### Notes

- 无代码、无 `lib/` 变更；功能与 0.1.0 相同。

## [0.1.0] — 2026-11-08

首个公开基线。此前内部迭代的版本记录已随公开基线归档，不再列入本文件。

### Added

- 事件源：GitHub issue / PR / 评论 / CI 结果，本机收件目录，可选飞书群聊。
- 准入与评估：程序层准入（谁能触发、什么算请求）+ 语义层评估；含糊消息交模型，必要时反问。
- 执行：每张工单一个上下文隔离的 DSH 会话，独立工作目录；完成后回贴评论或开 PR；Watchdog 控制回路与 Router 分片按需开启。
- 面板：介绍 / 概览 / 来源 / 评估 / 执行 / 设置；运行判读对应 CLI 退出码；首次打开给三步卡。
- 交付形态：GitHub 派单与本地收件目录；`mode: local` 下 `executor.prepare` 为空时自动建立内置本地工作区（`git init`、基座提交、`agent/<工单短名>` 分支，无远端）。
- 多实例：一个 `stateDir` 只允许一个后端（锁保护）；多 profile / 多 `stateDir` 各自独立。
- 配置：保存即生效的热加载；声明式设置文件；JSON Schema；提示词覆盖层与团队提示词默认值。
- 分发：已发布 npm 包 `@reserendipity/dsh-superagent`；仓库自带 `lib/` 构建产物，同时支持 `git+https` 安装；tarball 由 `pnpm pack:plugin` 产出。

### Notes

- 插件，非官方产品；上游归属与许可见 [NOTICE](NOTICE) 与 [LICENSE](LICENSE)。
- 当前支持 Windows 10/11；macOS / Linux 尚未验证。
- 安装后必须为 profile 配置 `stateDir`（无默认值，避免两个 profile 抢同一把锁）。
- npm 已发布 `@reserendipity/dsh-superagent@0.1.0`；按名字安装与 Git 地址安装并存。npm 包与 Release tarball 内容一致，但由不同打包器生成，字节不同。
