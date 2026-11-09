# 017 独立实现层：做官方描述了但没做的部分

> 依据：官方《Super-agent 设计探索》。`docs/011` 已经逐条对照过"本项目 vs 官方"。本文换一个方向：
> **文章里明确描述了、但原型没有实现或没有开放的机制**，本项目独立实现，**不 fork 上游、不改上游语义**。

## 1. 原则

1. **不 fork**：所有能力通过插件自身的模块、DSH 已有的接口（Session/工具/事件）与配置实现；上游升级时照常合并。
2. **显式 opt-in**：每项能力默认关闭或默认不改变行为，配置开启；不改变上游部署的既有语义。
3. **可验证**：每项都要有"真实运行证据"，不能只有单测。
4. **不臆造**：文章没写清的地方，按文章的原则做最小合理推断，并在文档里标明"这是推断"。

## 2. 缺口清单（文章 → 上游状态 → 本项目能做什么）

| 章节 | 文章要求 | 上游/本项目现状 | 可独立实现？ | 价值 |
|---|---|---|---|---|
| **§4.1** | 耗时**子任务**工具调用也异步：立即返回 Started、完成后以事件投递、可主动终止 | 命令侧已异步（5 秒转后台）；**子任务仍同步**，`dsh-tool-subagent` 未开放后台模式 | ✅ 插件内自建"后台子会话 + 结果回投 + 取消"工具 | 高：直接补齐"高效"特征 |
| **§2.1** | Router 层规模扩大时可**多层过滤或水平分片**，并明确这是连续性/吞吐的权衡 | 单 Router Session，未实现分片 | ✅ 可做 opt-in 分片：按 Thread 哈希分到 N 个 Router，带去重 | 中高：是文章给的扩容路径 |
| **§6** | Watchdog 不只看存活，要判断**实质进展/方向偏离**，并能在**自然语言指示**下修正系统行为 | 本项目已实现 digest + 定时驱动（`docs/012`）；进展判断仍交给模型每轮重新判断 | ✅ 可深化：跨 tick 状态差分自动识别"停滞"、提供"常驻指令"通道 | 中：让 Watchdog 更省 token、更可靠 |
| **§5** | 计算/状态/环境分离；执行环境留在原地由轻量 daemon 对接 | 单机一体化（原型简化） | ⚠️ 部分：需要 DSH 支持状态外置；本项目只能做**接口预留 + 状态目录可迁移** | 低（现阶段）：成本远大于收益 |
| **§3.4** | 投机执行：根据环境信号在后台提前尝试，有价值才交付 | 原型有"静默复现并修复"策略形态 | ⚠️ 已基本具备，缺"结果价值判定"的通用化 | 低：更像是策略而非机制 |

## 3. 实施顺序与验收

### P1 · 异步子任务（§4.1 缺失的右半边）— ✅ 已接线（默认关闭）

**已完成**：`src/app/subagents.ts` 的生命周期层（无 DSH/插件依赖，全部注入）——
`start()` 立即返回带 id 的 record（Started 语义）、子任务在独立 Session 运行、
`finish()` 把结果作为**一条事件消息**投回父 Session 且**只投一次**、
`cancel()` 之后不再投递、超长结果按 §3.3 **Spill**（保留续读提示）、完成的 record 按保留期回收。
5 个用例覆盖上述行为（`tests/subagents.spec.ts`）。

**接线已完成**：`asyncSubagents`（默认 `false`）；开启后 `Sessions.decorate` 注册 `subagent_background` /
`subagent_cancel` 两个工具；`ctx.on('agent/status')` 的 idle 取子会话最后一条助手消息（`assistantResult`）驱动
`finish()`；子会话 cwd 取工单执行目录、无工单取 `stateDir`。

**仍未做**：真实并发验收（慢子任务运行期间父 Session 仍能响应新消息）——需要一次真实模型回合，留给下一轮。

**前置已确认**：`ctx.on('agent/status')` 与 `agent/disposed` 可用，因此判定子任务结束不依赖上游。

**做法**（不改上游）：在 bundle 里新增一个插件自带的工具（形如 `subagent_background`），worker/router preset 里可选用。行为：

1. 调用立即返回 `Started`（含后台子任务 id），模型可继续；
2. 子任务在独立 Session 里跑；
3. 结束时把结果**作为一条事件消息**投回父 Session（与文章一致）；
4. 支持 `cancel`（对应文章"可主动终止"）；
5. 结果超长时走 Spill（与 §3.3 一致）。

**验收**：
- 单测：调用返回 Started 而非结果；完成后父 Session 收到一条消息；cancel 后不再投递。
- 真跑：worker Session 里发起一个慢子任务，期间仍能响应新消息（这是文章 §4.1 的核心断言）。

### 2.1 修复：分片会话改为按需创建

**缺陷（由一次真实使用暴露）**：分片会话原先是启动时**预置**的。这样一个闲置分片会出现在 DSH 界面的会话列表里，
用户打开它时 DSH 会把 preset 选成 `standard`；而 DSH 在会话首轮之后拒绝再改 preset，于是这个会话带着
standard 的全套工具（含 `edit`、`subagent`）留在那里，既没有本项目的工具限制，也没有本项目的提示段。
会话日志里的 preset 序列可以证明：`standard → dsh-superagent-router（本项目的重选）→ standard（+79 秒，被 UI 切走）`。

**修复**：不再预置。分片 Router 会话改为**首次投递时创建**（`ensureRouterSession`），健康项如实报告
`<live> of <configured> Router Sessions (…; a shard starts on its first delivery)`。

**实测**：`routerShards: 2` 重启后健康显示 `1 of 2 Router Sessions (sharded by Thread; a shard starts on its first delivery)`，
且会话目录里**没有**新增分片会话（重启前后都是 1 个，即历史上遗留的那个）。

**遗留**：那次测试留下的 `orchestrator-…-shard-1` 会话仍存在于 `~/.dsh/sessions`，里面含有用户的测试对话，
未经同意不删除。

### P2 · Router 分片（§2.1 未实现的扩容路径）— 放置与预置已完成，分发待接线

**做法**：设置里的 `routerShards`（执行设置 → 控制回路；默认 1，**改后需重启生效**）。按 `threadKey` 哈希把 Trigger 分给 N 个 Router Session；全局记忆仍在 Router 层（文章说分片会削弱连续性，所以用 Thread 亲和性把同一 Thread 固定到一个分片，避免跨分片上下文断裂）。

**进度**：①放置规则 `src/app/shards.ts`（FNV-1a，Thread 亲和性，4 个测试）✅；②分片 Session 预置与
Router 待遇（`SocketHost.routerIds()`、`decorate` 对每个 Router 生效、`router` 健康项）✅，实测
`routerShards: 2` 时健康显示 `2 Router Sessions (sharded by Thread)` 且磁盘上出现 `orchestrator-…-shard-1`。
**分发已接线**：候选卡片按 Trigger 的 Thread 投递到对应分片（`MasterAssessor.deliver` 增加 `thread` 参数，运行时 `routerFor(thread)` 解析）；无 Thread 或无工单的消息仍进主 Router。
**验收状态：已通过真实事件验收（2026-11-01 15:29）**。另一个账号在 `<maintainer>/<repo>` 的 issue #3
发了一条**不带 @** 的评论（名单内、未点名 → 语义候选），实测得到：

| 预期 | 实测 |
|---|---|
| 触发被接收且 Thread 为 `github:3` | ✅ `trigger 07:29:06 threads=[{github, id:3}]` |
| `github:3` 哈希到 shard 1 | ✅ 放置函数计算一致 |
| 分片会话**按需创建** | ✅ 健康项 `1 of 2` → `2 of 2 Router Sessions`，会话目录 `orchestrator-…-shard-1` 出现 |
| 候选落 shard 1、主 Router 不接 | ✅ shard-1 会话里 `LICENSE` 出现 88 次、`orchestrator_eval` 46 次；主 Router 里 `LICENSE` **0 次** |
| 语义层产出决策 | ✅ `decision 07:30:14 thread=github:3 kind=ignore reason=said`（带模型给的判断文本） |

**发现的两处非缺陷事实**（记录以免重复踩坑）：① 带 @ 的名单内消息走 `explicitRouted` Fast Path，直接进工单/worker，
不经过 Router，因此不该用这类事件验分片；② 不带 @ 的评论只有在 `observeComments` 开启或 Thread 已订阅时才被轮询到，
且观察游标从开启时刻往后算。

**可选补验**：同一 Thread 的第二条事件仍落同一分片（放置函数已有单元测试覆盖，真实事件只验了一条）。

### P3 · Watchdog 深化（§6）— ✅ 已实现（watchdogStallMinutes / watchdogGuidance / 空 digest 不投递）

**做法**：跨 tick 的**状态差分**（Assignment 状态 + quiet 时间 + 最近事件计数）自动识别"停滞候选"，只在差分异常时才唤醒模型；新增"常驻指令"通道（管理 API 写入一段指引，随 digest 一起下发），对应文章"用自然语言指示修改系统行为"。

**验收**：停滞 3 个 tick 的工单会被点出；健康系统不产生任何唤醒（token 成本≈0）。

### P4 · 存算分离接口预留（§5）— 只做预留

`stateDir` 已可迁移；预留"状态存储适配器"接口（本地 sqlite 为默认实现），不实现远端后端。文章说这是分布式系统的经典取舍，等 DSH 提供能力再落地。

## 4. 与上游的关系

- 这些能力**全部是新增**（新模块、新工具、新配置项），不改上游的既有行为；
- 上游若将来实现了同名能力，优先切回上游实现，删掉本项目的模块（`docs/WINDOWS-DELTA.md` 的差量清单会记录每项）；
- 混合部署仍然安全：未开启这些配置时，行为与现在完全一致。

## 5. 风险

1. **异步子任务**会引入新的 Session 生命周期（创建/取消/回收），如果回收不干净会漏 Session；
2. **Router 分片**会削弱全局连续性（文章自己也强调这一权衡），必须默认关闭；
3. 两项都改变"谁能给谁发消息"，需要防止消息死循环（例如子任务结果又触发新的子任务）。

## 6. 最终状态（收尾整理）

| 项 | 实现 | 测试 | 真实运行证据 | 待人工验收 |
|---|---|---|---|---|
| P1 异步子任务 | ✅ 生命周期 + 接线（`asyncSubagents`，默认关闭） | `tests/subagents.spec.ts`（6 例） | 线上实例已开启、工具在构建产物中、服务健康 | ✅ 需在窗口按发布检查清单的人工项复验 |
| P2 Router 分片 | ✅ 放置 + 预置 + 分发接线（`routerShards`，默认 1） | `tests/shards.spec.ts`（4 例） | `routerShards: 2` 时健康显示 `2 Router Sessions`，分片 Session 落盘 | ✅ 需另一账号发一条真实事件 |
| P3 Watchdog 深化 | ✅ 差分 / 停滞 / 静默 / 常驻指令 | `tests/watchdog.spec.ts`（5 例） | 1 分钟间隔实测：启动期 2 次投递后静默；563 分钟未推进的旧工单被标 STALLED | — |
| P4 状态存储接缝 | ✅ 接口 + 本地适配器 + 真实调用点 | `tests/state-store.spec.ts`（3 例） | 行为零变化（同一批键、同一前缀语义） | — |

两项待人工验收的原因相同：都需要**参考环境之外的动作**（另一账号发事件；人在窗口里对话）。这两条不是实现缺口，是验证缺口，已分别写成可复制步骤。

## 7. 重要更正：上游可能已经支持后台子代理

用户的实测截图显示：一条「用 subagent_background 跑 25 秒慢任务」的对话里，**父会话 14 秒就回复了**，
25 秒后收到完成通知，结果 5050 正确。

但会话日志解压核对后，**实际被调用的是 DSH 自带的 `subagent` 工具**（`subagent` 出现 5 次，
本项目的 `subagent_background` 出现 0 次），子代理是一个 UUID 命名的 DSH 子会话（内含 `pwsh` / `send_message`）。
worker preset 里确实同时装了 `@deepseek-ai/dsh-tool-subagent` 与 `@deepseek-ai/dsh-tool-subagent-control`。

**结论**：`docs/013`/`docs/017` 之前写的「上游 `dsh-tool-subagent` 没有暴露后台模式」**是错的**——当时的判断
依据只是 grep 包里有没有 `background` 字样，没有验证真实行为。

**处置（已执行）**：会话日志显示那个 `orchestrator-…-shard-1` 会话用的是 **standard preset 全套工具**
（`edit`、`subagent`、`subagent_fork`、`create_goal`…），既没有 `MASTER_TOOLS` 限制，也没有本项目的提示段——
也就是说它**根本没被 dsh-superagent 接管**。既然它跑的是 standard preset，而 standard/worker preset 都带
`dsh-tool-subagent`，上游的后台子代理在本环境**已可用**。

因此按 §4 的规则：**P1 已退役**——删除 `src/app/subagents.ts`、`tests/subagents.spec.ts`、两个工具、
`asyncSubagents` 配置项与相关接线；`docs/007`、`WINDOWS-DELTA` 同步更新。
