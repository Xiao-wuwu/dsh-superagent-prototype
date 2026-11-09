# 010 多仓库 / 多账户：设计与影响面

> 状态：**C2/C3 未采纳**。读完官方《Super-agent 设计探索》§8.3 后，扩展方向改为「一个上下文边界一个实例」，单进程多仓库与官方设计相悖，决定记录在 011《对齐官方设计：一致性审查与路线修正》。
> 本文保留为技术调研：逐实例管线（`deployments` / `problemFor` / `ctx.source` / 状态命名空间）已实装但被守卫挡住，对「多实例管理」与将来「同上下文多仓库」仍有参考价值。

## 1. 结论先行

**推荐方案：单进程、多 Source 实例（instance per repository），每个实例各自持有 deployment（仓库 + 智能体账号）。**

不做的事：不为每个仓库起一个 DSH 进程/profile。理由：多进程会重复模型连接、会话存储、HTTP 面板，运维成本线性增长，而隔离收益可以用实例级作用域拿到。

关键发现：**设置层已经支持多实例**——`settings.sources` 是 `record(id → instance)`（`src/policy.ts:101`），`policy.sources` 同样按 id 记录（`src/policy.ts:81`）。限制不在数据模型，而在下面三处把它当成了单例。

## 2. 现状：把系统锁死在单仓库的三处

| 位置 | 现状 | 为什么挡住多仓 |
|---|---|---|
| `src/sources/registry.ts:43` `kind(id)` | 把 settings 的 key **当作 kind** 查表（key `github` → kind `github`） | 第二个 GitHub Source（如 `acme-widgets`）无法映射到 kind，也就注册不了 |
| `src/app/setup.ts`（`setup.deployment`） | 全局解析**一个** `Deployment`（repository + gh login + noreply） | 一个进程只能服务一个仓库、一个账号 |
| `src/app/runtime.ts:164`、`src/github-watch.ts` 等入口插件 | Source 按 **kind** 挂载：每个 kind 一个 `SourceContext`、一组健康条目（`health: ['github']`） | 第二个实例没有自己的上下文与健康条目，会和第一个共用，导致健康互相覆盖、命令作用域错乱 |
| `src/infra/environment.ts` `agentVariables()` | `GH_CONFIG_DIR` 是 **stateDir 级**常量，worker 环境全局共用 | 多个账号必须各自有 `gh` 配置目录，否则全都用同一个账号 |

其余部分**已经按 Source 作用域设计**，这是方案可行的基础：

- `ctx.deployment` 由 `SourceContext` 提供（`src/sources/github.ts:102`）→ 每个实例的 `DSH_SUPERAGENT_GITHUB_REPOSITORY` 天然不同
- 执行器的 prepare 命令只读环境变量（`DSH_SUPERAGENT_GITHUB_REPOSITORY` / `DSH_SUPERAGENT_DIR` / …），**不需要改**就能服务多仓库
- 工单目录 `stateDir/work/<name>-<ticket>` 与仓库无关，天然不冲突
- `policy.sources`、`settings.sources` 都是 record，按实例 id 记录
- 健康状态目前按 kind 命名（`github`），需要改成按实例（`github:<id>`）

## 3. 目标 / 非目标

**目标**

1. 一个进程同时监听 N 个 GitHub 仓库，每个仓库独立的智能体账号（可共用也可不同）
2. 每个实例独立的 Policy 允许名单与规则
3. 工单明确归属到实例；执行器用该实例的仓库与账号
4. 现有单仓库配置**零改动**继续工作（向后兼容）

**非目标（本期不做）**

- 跨实例的工单迁移
- 实例级独立的模型/预算（仍用 profile 级模型）
- 实例级独立的工作目录根（先共用 `stateDir/work`）
- Feishu 多机器人

## 4. 数据模型改动

### 4.1 settings

```jsonc
{
  "sources": {
    // 旧写法（等价于 kind=github，实例 id 就是 github）——继续有效
    "github": { "enabled": true, "config": { "repository": "acme/widgets", "cli": "…" } },

    // 新写法：显式 kind，实例 id 可任意（^[a-z][a-z0-9-]*$）
    "widgets-b": {
      "kind": "github",                     // 新增字段，缺省 = 实例 id
      "enabled": true,
      "config": { "repository": "acme/widgets-b", "cli": "…" }
    }
  },
  "policy": {
    "sources": {
      "github":    { "allowed": [{ "id": "alice" }] },
      "widgets-b": { "allowed": [{ "id": "bob" }] }   // 已支持
    }
  }
}
```

`sources.<id>.kind` 是唯一新增字段，默认取 id，因此**旧配置解析结果完全不变**。

### 4.2 状态目录

```
<stateDir>/
  worker-bin/                 # 命令垫片（全局，按实例的 gh 包装在 connfig 里区分）
  worker-gitconfig            # git 配置（全局；credential helper 指向 per-instance 包装）
  gh/<instance>/              # 新增：每个实例的 GH_CONFIG_DIR
  work/<ticket>               # 工单目录（不变）
```

### 4.3 工单

工单已带 `channels[].source`（实例 id）与 `origin.triggerId`，**不需要新字段**；但执行器解析 deployment 时必须按 `channel.source` 取，而不是取全局单例。

## 5. 影响面清单（按改动顺序）

| # | 文件 | 改动 | 风险 |
|---|---|---|---|
| 1 | `src/policy.ts` `SourceInstanceSchema` | 增加可选 `kind`，默认 id | 低（纯 schema，旧配置不变） |
| 2 | `src/sources/registry.ts` | `kind(id)` → `kindOfInstance(settings, id)`；`instances()` 输出实例 id + kind | 低 |
| 3 | `src/app/setup.ts` | `deployment` → `deployments: Map<instanceId, Deployment>`；逐实例解析、逐实例记录 setup problem | **中高**：setup 是所有功能的门禁，需逐实例独立成败，一个实例失败不能拖垮其它 |
| 4 | `src/index.ts` / `src/app/runtime.ts` | 把 `Setup.deployment` 的读取点改为按实例取；`pullEndNotices` 等按工单的 source 取 | 中 |
| 5 | `src/infra/environment.ts` | `agentGhConfig(stateDir)` → `agentGhConfig(stateDir, instance)`；`agentVariables(ticket 的 instance)` | 中（涉及 worker 环境） |
| 6 | `src/sources/github.ts` 等 | `ctx.deployment` 改为实例作用域（`SourceContext` 已按 kind 构造，需带上实例 id） | 中 |
| 7 | 健康状态 | `github` → `github:<id>`；`status` 退出码仍按“任一部分失败”聚合 | 低 |
| 8 | 面板/管理 API | Sources 页支持多实例（新增/删除/启停）；`PUT settings/source:<id>` 已按 id 路由，基本可用 | 中（前端工作量大） |
| 9 | `scripts/dsh-superagent` | `status` 的 `errors` 输出按实例名 | 低 |
| 10 | 测试 | 新增多实例解析/健康/策略隔离的用例；现有单实例用例必须全绿 | 中 |

**改动量估计**：核心（1–7）约 400–600 行改动 + 200 行测试；面板（8）另计。

## 6. 兼容与迁移

- 旧配置：`sources.github` 无 `kind` → `kind` 取 id → 行为与现在逐字节一致
- 迁移步骤：在面板复制一份 Source、改 `repository`/`cli`/`id`，再把 Policy 里加一条对应允许名单；无需停机重装
- `worker-gitconfig` 若已存在旧格式：新增 per-instance 包装目录不影响它；setup 会为每个实例写自己的 `gh/<instance>`

## 7. 分阶段实施与验收

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| **P1 核心** | 1–7：schema、registry、per-instance setup/deployment、**入口插件按实例挂载 + 逐实例健康名**、per-instance worker 账号 | 两个 GitHub 实例各自 `setup.problem: null`；各自的信号触发只进自己的工单；A 实例账号失效时 B 仍 `ready` |
| **P2 面板** | 8：Sources 页多实例 CRUD | 面板可新增/删除/启停实例；删除实例不影响其它实例的工单与健康 |
| **P3 收尾** | 9–10 + 文档 | `status` 逐实例报告；`docs/WINDOWS-SETUP.md` 增加多仓章节；契约测试覆盖实例隔离 |

## 8. 风险与回滚

| 风险 | 缓解 |
|---|---|
| setup 改成逐实例后，聚合语义出错导致整个服务被判失败 | 先保留“任实例成功即运行”，失败实例只进 `errors`（退出码 2 语义） |
| worker 环境串号（A 的工单用了 B 的账号） | 环境变量按**工单**构造而非进程级；加一条契约测试：不同实例工单的 `GH_CONFIG_DIR` 不同 |
| 面板改动波及单实例既有流程 | P2 单独提交，可单独回滚 |
| 上游更新冲突面变大 | 改动集中在本文第 5 节列的 7 个热点；`docs/WINDOWS-DELTA.md` 追加一节记录 |

回滚：三个阶段各自独立提交，回滚到 `P1` 之前的 tag 即可恢复单实例行为；数据层无破坏性变更（只新增可选字段）。

## 9. 需要确认的决策（实施前）

1. **实例失败语义**：一个实例的账号失效，服务应继续为其它实例工作（推荐），还是整体停机？
2. **账号复用**：是否允许两个实例共用同一个 `gh` 账号（同一 `GH_CONFIG_DIR`）？推荐允许（只读场景常见），但要在面板上提示。
3. **面板优先级**：P1 完成后是立刻做面板（P2），还是先做可观测性（原第 3 项）？

---

## 10. 实施复盘：挂载层才是真正的边界（2026-11-01）

按第 5 节开始实施后发现的修正，记录在此以免下一轮再低估：

- 第 5 节第 3 行（`setup`）不是最大的一块；**真正的结构边界在挂载层**。Source 由独立 cordis 入口插件（`dsh-superagent/github-watch`）按 kind 挂载，`Runtime.context(kind)` 每次只给一个 kind 建一个上下文，健康条目也是 kind 级的（`health: ['github']`）。
- 因此「两个仓库」必须让**入口插件按实例迭代**，每个实例拿到自己的 `SourceContext`、`Commands`（仓库作用域）与健康条目名（`github:<id>`）。
- 只改 `setup` 而不改挂载层是最坏情况：两个实例共用一套上下文，会**用同一组账号/仓库作用域去处理两个仓库**，产出错仓库的 PR——比现在明确拒绝危险得多。所以 C1 的拒绝是必要的中间态。

修订后的 C2 工作顺序（一次提交完成）：

1. `Setup.deployments: Map<实例, Deployment>` + `deploymentFor(id)` + 逐实例 `problems`
2. 入口插件按 `SourceRegistry.instances()` 迭代挂载，健康条目名带实例后缀
3. `Commands` / `links` / `pullEndNotices` / `ticketEnvironment` 全部按工单或实例的 source 取 deployment
4. 先放行「同账号多仓库」；不同账号留到 C3（`GH_CONFIG_DIR` 按实例）
5. 验收：两仓库各自 `setup: null`、触发互不串、A 账号失效时 B 仍 `ready`

### 实施状态（C2 进行中）

已完成并提交：

- `Setup` 按实例保存 deployments 与 setup problems（`deploymentFor` / `problemFor`）
- `SourceContext` 的 deployment / commands / 健康条目 / setup problem 全部按实例解析
- 入口插件按 `instances()` 为每个实例启动一个循环；健康条目名带实例后缀（`github:<id>`）
- setup 逐个校验实例；**不同账号**明确拒绝（`multiAccountUnsupported`），同账号多仓库放行
- 工单环境变量与合并通知按工单自己的 source 取 deployment
- 声明式配置改变实例集合时自动重启一次

**已知未解决**：第二个实例的健康条目停在 `starting`，即它的轮询循环没有开始回报（首个实例正常）。setup 为 `null`、两个 Source 都列出且状态 `ready`，因此不会串仓库；但第二个实例收不到触发。修复前线上配置保持单实例。

