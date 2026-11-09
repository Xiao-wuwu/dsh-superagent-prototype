# 012 Watchdog：官方设计的第五个模块

> 依据：官方《Super-agent 设计探索》§6。这也是原型（与本适配版）此前**完全缺失**的一块。

## 1. 为什么主系统管不了自己

文章说得很直接：长期在线的分布式系统很难靠主系统内部逻辑保证可靠，需要在主系统**之外**引入独立的控制回路（Control Loop）。而且对 Agent 系统来说，传统的"进程存活探测/监控脚本"不够——很多异常不是进程崩了，而是**模型陷入无效循环或偏离目标**，从系统内部看，一个"空转的 Worker"和一个"忙碌的 Worker"长得一模一样。

所以 Watchdog 要同时管两件事：

| 关注点 | 谁来判断 | 例子 |
|---|---|---|
| 基础设施 | 确定性代码即可 | 某个 part 进 `error`、队列排不出去、接口报错 |
| 任务进展 | **必须由模型判断** | Worker 在跑但长时间没有实质推进；方向偏离了原始请求 |

## 2. 本项目的实现

| 设计要点（文章） | 本实现 | 位置 |
|---|---|---|
| 主系统**之外**的独立 Control Loop Session | 独立 Session `watchdog-<stateDir key>`，不是 Router，不收 Trigger、不接工单、不回复人 | `src/app/runtime.ts` `startWatchdog()` |
| 由**定时消息**驱动 | `setInterval` 每 `watchdogMinutes` 分钟投一条 digest（`prompt(..., 'queue')`），`unref()` 不拖住进程 | `WatchdogLoop` in `src/app/watchdog.ts` |
| 具备**完整工具能力** | Session 用 bundle 的 `dsh-superagent-worker` preset（fs/shell/jobs 全量），不带任何工具限制 | 复用 `Sessions.ensure(..., 'worker')` |
| 能在自然语言下**修正系统行为** | digest 里给出本地管理 API 与必需 header，Watchdog 用 shell + curl 调 `POST tickets/<id>/retry|stop`、`POST executor/pause`、`PUT settings/...` | digest 文本 |
| 只管"值不值得介入" | 明确的静默规则：健康时不报告、不总结、"all clear" 一律不发 | digest 末段 |

配置项（`Machine`）：

这些参数现在都在 **设置 → 执行（Execution settings）→ 控制回路（Watchdog）** 里（见 `docs/009`），不再写在机器配置里；机器配置只保留启动接线（`stateDir`、`configPath`）。

| 设置项 | 默认 | 含义 |
|---|---|---|
| `watchdogMinutes` | 30 | 摘要间隔（分钟）；0 关闭控制回路 |
| `watchdogStallMinutes` | 45 | 停滞判定阈值（分钟） |
| `watchdogGuidance` | 空 | 常驻指令，随摘要下发 |

同区块里还有 `routerShards`（Router 分片数，默认 1，**改后需重启生效**）。

## 3. Digest 写了什么

`watchdogDigest(snapshot, interval)` 是一段确定性文本，四段结构：

1. **身份**：你是外部控制回路，不是 Router——不接活、不回复人、不改工单。
2. **现状**：执行器负载、每个未关工单的 Assignment 状态与"安静了多久"、所有非 ready 的 part 及其 detail。
3. **判断顺序**：① 基础设施故障是偶发还是配置问题（配置问题只报告，不绕过）；② 工单是否"在跑但没进展"（读它的 Session，决定 retry 还是 stop）；③ 是否偏离原始请求（说明，由人决定）。
4. **行动方式与静默规则**：管理 API + header；健康时保持安静；已报告过的不重复。

它是**纯函数**（`WatchdogSnapshot` → string），因此可以在测试里逐字断言——这就是 `tests/watchdog.spec.ts` 做的事。

## 4. 与其它模块的边界（重要）

- **不替代 Router**：Watchdog 不参与路由、不分配工单、不代表系统对外说话。
- **不替代 §8.4 的凭据隔离**：它读的是 digest 与本地 API，不接触凭据。
- **不保证存算分离**：进程整体离线时 Watchdog 也会停（§5 未实现），这类故障仍需外部监督；本项目的 `scripts/dsh-superagent status` + 操作系统计划任务可作为更外层的一层。

## 4.1 深化（docs/017 P3）

| 能力 | 做法 | 配置 |
|---|---|---|
| **跨 tick 状态差分** | 记下上一次 digest 的 snapshot；只把"变化"当作新闻（暂停状态、负载、健康项进出故障、新出现的停滞、指令变化） | 自动 |
| **停滞识别** | 有 running/queued Assignment 且 `updatedAt` 超过 `watchdogStallMinutes` 未变 → 该工单标 `STALLED`，即使状态看起来"在跑" | `watchdogStallMinutes`（默认 45） |
| **健康时零唤醒** | 无变化、无异常 part、无新停滞、无指令变化 → digest 返回空串，循环不投递（不消耗模型回合） | 自动 |
| **常驻指令通道** | 操作者的自然语言指引随 digest 下发；改配置即改行为（对应文章"通过自然语言指示修改系统行为"） | `watchdogGuidance` |

实测（1 分钟间隔）：启动后最初两次 digest（健康项从 `starting` 跃迁到 `ready`）之后进入静默；随后 2.1 分钟内**再投递 1 次**。

该实例存在一个 563 分钟未推进的旧工单（`fa569c55…`，Assignment 状态 `ended/running`），它被正确识别为 `STALLED`，
重启后的首个 digest 会带上它；健康项跃迁同样算作「新闻」。因此**静默机制生效，但不是严格的 0 投递**：
只要系统里还有停滞的工单，它就值得被提一次。

**已知不足（下一步）**：digest 目前不说明「这次为什么说话」，导致上面的计数难以归因。后续在 digest 头部加一行触发原因，例如 `reason: stalled t1` 或 `reason: health runtime`，让每次投递都可解释、可验证。

## 5. 已知限制与后续

1. 目前只有"投 digest"，没有把 Ticket 的 Session 内容自动摘要进 digest（模型需自己读）；后续可把最近几轮的关键事件 Inline 进 digest（与 §3.3 一致）。
2. 间隔是静态配置；没有按负载自适应（文章也未要求）。
3. 尚未在 Windows 上做"进程级"守护（Watchdog 与被守护进程同一进程）；跨进程守护由外部计划任务承担，见 `docs/WINDOWS-SETUP.md` 的每小时巡检。
