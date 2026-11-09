# 027 主对话总管模式（chatRouter）

> 依据：官方《Super-agent 设计探索》§2 的 Router/Worker 分层，与 TRAE 宝「全局助理 + 独立执行会话」的产品形态；本仓 2026-11-09 需求。
> 与 `docs/011` 的关系：这篇文章的一致性审查针对插件自己的 Router 主 Session；本文是一个**新增的、作用于普通 DSH 主对话**的可选功能，不改既有 Router 语义。

## 1. 它解决什么

插件原本的输入只有 GitHub / 本地收件目录 `.md` / 面板「派一张单」。普通聊天窗口里说一句「帮我做 X」，插件不接管（`src/app/sessions.ts` 的 `decorate()` 对非 Router、非 Worker 的会话直接返回），于是那个会话用自己全套工具把活干了——上下文与执行混在一个窗口里。

总管模式把**每一个新建的普通主对话**变成一个只负责派发的「总管」：

- 工具按档位剥夺，命令 / 文件写入 / 子代理一律不可见；
- 任务必须通过 `chat_dispatch` 写成收件目录的任务文件，走既有 Trigger → Ticket → `worker-<ticket id>` 链路；
- worker 是**平级独立 Session**，有独立 session id、cwd 与 workspace，不是 DSH `subagent` 父子会话；
- 只有限长简报回投发起派发的那个主对话，完整 transcript 留在 worker。

**与 TRAE 宝的差异**：TRAE 宝的全局助理对话框唯一、不能新建；本功能按需求**允许新建多个主对话**，每个都是独立总管。它们共享 `orchestrator.sqlite` 的工单与产物，但看不到彼此的对话内容。

## 2. 开关与档位（插件面板）

设置 → **总管模式**（`SETTINGS_GROUPS` 的 `chatRouter` 分组，实现在 `src/client/chat-router.tsx`）：

| 控件 | 字段 | 默认 |
|---|---|---|
| 启用总管模式 | `enabled` | `false`（存量部署零影响） |
| 主对话工具档位 | `tools.preset` | `standard` |
| 自定义工具矩阵（`custom` 时展开） | `tools.allow` | `[]` |
| 强制派发 | `forceDispatch` | `true` |
| 结果回传 | `reply.mode` | `brief` |
| 并行工单数 | `worker.maxParallel` | `3` |

三档：

| 档位 | 主对话保留的工具 |
|---|---|
| `strict` | 仅 `chat_dispatch` / `chat_status` / `chat_answer`（零执行工具，对应官方文章最严口径） |
| `standard` | 上述三项 + `orchestrator_read` / `read` / `read_image` / `glob` / `grep` / `skill` |
| `custom` | 上述三项 + 面板逐项勾选的工具（按只读 / 命令 / 写入 / 网络 / 子代理等分组） |

保存走既有 `PUT settings/:block` 与乐观并发 revision；`chatRouter` 已加入 `DECLARATIVE_BLOCK_NAMES`，声明式文件可覆盖，JSON Schema 由 `SettingsSchema` 自动生成。

## 3. 前置条件与生效时机

- **必须启用本地收件目录 Source**（设置 → 来源；Mode A 还需 GitHub Source `disabled: true` 与收件白名单含 `local`）。`chat_dispatch` 写的是普通 `.md` 任务文件，与手动丢文件、面板派单走同一条路；没有启用的 inbox，工具会明确报错而不是静默丢单。
- **只对新建会话生效**：`tools.restrict` 在会话 decorate 时注册，已运行的对话沿用创建时的白名单（与 DSH「Sessions retain the preset selected at creation」一致）。关闭开关后，新建对话恢复原工具集。面板文案已明示这一点。
- 插件自己的 Router（`orchestrator-*`）、执行器（`worker-*`）、Watchdog（`watchdog-*`）会话以及任何子代理，**永远不被接管**。

## 4. 实现坐标

| 位置 | 职责 |
|---|---|
| `src/chat-router/config.ts` | schema、三档预设、`allowedChatTools()`、`briefOf()` |
| `src/chat-router/tool-groups.ts` | 面板自定义矩阵的工具分组（无 zod，供客户端复用） |
| `src/chat-router/match.ts` | 普通会话判据；不绑定固定 session id；`chatThreadKey()` 按主对话隔离 |
| `src/chat-router/tools.ts` | `chat_dispatch` / `chat_status` / `chat_answer` |
| `src/chat-router/submit.ts` | 写 inbox 任务文件，带 `<!-- chat-session: <id> -->` 标记 |
| `src/chat-router/channel.ts` | 扫 `done/*.reply.md`，把限长简报送回发起派发的主对话 |
| `src/chat-router/host.ts` | Runtime 与 `Sessions` 之间的接缝、总管提示词 |
| `src/app/sessions.ts` | `decorateChatRouter()`：注入提示词段、注册工具、`tools.restrict` + `tools.guard` |
| `src/app/runtime.ts` | 构造 host、inbox 根目录解析、简报轮询定时器 |
| `src/policy.ts` / `src/app/settings.ts` / `src/app/views/settings.ts` / `src/app/config-schema.ts` | `chatRouter` 设置块、视图、声明式 schema |
| `src/client/chat-router.tsx` / `route.ts` / `settings.tsx` / `locales.ts` | 面板分组、控件、中英文案 |
| `prompts/chat-router.md` / `tests/chat-router.spec.ts` | 提示词资产 / 契约测试 |

**强制派发是硬约束**：白名单之外工具不可见；`forceDispatch` 再加一层 guard，任何越界调用被拒并提示改用 `chat_dispatch`。提示词只是软约束。注意 `tools.restrict` 只约束从 preset 继承的工具，本地注册的三个派发工具不受影响（与上游 `MASTER_TOOLS` 同一机制）。

## 5. 上下文隔离（对应需求的核心）

```
主对话 A（总管，工具被剥夺） ──chat_dispatch──▶ inbox 任务文件 ──▶ Ticket A ──▶ worker-<A> 独立会话
主对话 B（总管，工具被剥夺） ──chat_dispatch──▶ inbox 任务文件 ──▶ Ticket B ──▶ worker-<B> 独立会话
        ▲                                                                    │
        └────────────────── 限长简报（不含工具输出 / transcript）◀───────────┘
```

- 每个主对话的 thread key 是 `chat:<该会话 id>`，互不干涉；
- `chat_status` 读的是**共享工单库**（`store.tickets.list()`），不是别的主对话的上下文；
- 简报由 `briefOf()` 限长（默认 400 字符），worker 的完整输出、文件内容、工具结果都不进入主对话。

## 6. 验收

1. 面板开启后，新建普通会话的 `request/header.tools` 只剩白名单；`strict` 档下无 `bash` / `pwsh` / `write` / `edit` / `subagent`。
2. 主对话收到任务首轮必调 `chat_dispatch`；越界工具调用被 guard 拒绝。
3. 出现 `worker-<ticket id>` 会话：`session.id` 与主对话不同、`parentSession` 为空、`cwd` 为 `stateDir/work/<ticket>`。
4. 主对话 transcript 不含 worker 的工具输出；简报长度受限。
5. 新建第二个主对话同样被接管，`chatThreadKey` 不同；两者都能读共享工单库。
6. 关闭开关后新建会话恢复原工具集。
7. `pnpm typecheck` / `pnpm vitest run` / `pnpm build` 通过；`lib/` 与 fresh build 一致。

## 7. 已知限制

- 简报回投目前用轻量轮询扫 `done/*.reply.md`（5 秒），而不是订阅 outbox 事件；后续可换成事件驱动，接口不变。
- 派发依赖 inbox Source 的轮询周期（默认 10 秒），不是即时建单。
- `worker.maxParallel` 是面板值，实际并发仍受执行器 worker slot 限制。
- 主对话被剥夺工具后不能自己读文件/跑命令；需要查证的一律由 worker 查完以简报回传，这是设计取舍。
- 面板「应用到当前会话」（对已运行会话重新装饰）尚未实现，当前仅对新建会话生效。

## 8. 与上游的关系

本功能是纯增量：不改 `src/core/**`（与上游逐字节相同），不改既有 Router/Worker 语义，默认关闭。若上游将来实现同名的「主对话工具治理」，按 `docs/WINDOWS-DELTA.md` 的差量清单删除本模块并切回上游。
