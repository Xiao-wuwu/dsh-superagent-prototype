# 015 多实例：§8.3「一个上下文边界一个实例」的落法

> 依据：官方《Super-agent 设计探索》§8.3——**需要共享上下文的范围共用一个实例，需要隔离的范围则各自独立配备**。
> 本文说明在本适配版 上如何跑多个实例，以及为什么这不是"再做一个多仓库功能"。

## 1. 为什么是实例而不是多仓库

`docs/011` 记录了那次方向修正。一句话：一个进程 = 一份 Router 记忆 + 一套策略 + 一个凭据边界。把两个不该共享上下文的仓库塞进同一个进程，等于让它们共享这三样东西——与 §8.3 相反。正确做法是**多实例**：隔离由进程与状态目录天然实现，不需要在每个子系统里做实例切分。

实例的守卫已恢复：配置多个 GitHub Source 时 setup 会报 `multipleSourcesUnsupported`，并指引按边界多起实例。

## 2. 一个实例的完整边界

| 组成 | 每实例独立 | 说明 |
|---|---|---|
| DSH profile | ✅ | `$DSH_HOME/profiles/<name>`，profile 名决定 `dsh-<profile>` 的 tmux/pidfile 命名 |
| 状态目录 `stateDir` | ✅ | 数据库、锁、worker 垫片、git 配置、工单目录、**实例级 gh 配置目录** |
| 声明式配置 | ✅ | 每实例一份 `superagent.settings.json`（见 `docs/009`） |
| Watchdog | ✅ | 每实例一个 Control Loop Session，间隔独立（见 `docs/012`） |
| 端口 | ✅ | 每个 profile 的 `webserver.port` 不同（或用覆盖层自动分配） |
| 仓库与账号 | 按边界 | 同一实例内的仓库必须共享记忆与凭据；跨边界就再起一个实例 |

## 3. 怎么跑第二个实例（当前可用的做法）

1. **复制一份 profile**（不要复用正在用的那个）：

   ```powershell
   dsh.cmd team-b --from-default-profile web --dump-config > $null
   dsh.cmd plugin --profile team-b add "link:D:/path/to/dsh-superagent"
   ```

2. **给新 profile 一份机器配置**（`$DSH_HOME/profiles/team-b/cordis.patch.yml`），关键是**不同的 `stateDir` 与端口**（0.1.5 起 `stateDir` 也可不写：插件按 profile 派生 `state/team-b-superagent`，隔离同样成立；下面的显式写法用于沿用旧目录或自定义命名）：

   ```yaml
   - id: webserver
     config: { host: 127.0.0.1, port: 3083 }
   - id: dsh-superagent
     config:
       stateDir: <you>/.dsh/state/team-b
       configPath: <you>/dsh-superagent/team-b.settings.json
   ```

3. **跑起来**：

   ```powershell
   node "$env:APPDATA/npm/node_modules/@deepseek-ai/dsh/lib/bin.js" --profile team-b --no-open
   ```

4. **验证隔离**：两个实例的 `GET /orchestrator/api/state` 各自返回自己的 `stateDir`；两边数据库、锁、游标互不影响；任一实例的账号失效不影响另一个（这是 §8.3 的直接收益）。

## 4. 实测（这一版）

在参考环境同时运行两个实例（同一仓库、同一账号，仅 `stateDir` 与端口不同）：

| 实例 | stateDir | 端口 | 结果 |
|---|---|---|---|
| A（桌面外壳，已移除） | `.../state/superagent` | 应用自动分配 | `setup: null`、`runtime: ready` |
| B（命令行） | `.../state/superagent-b` | 3083 | `setup: null`、`runtime: ready`，账号解析为 `Check-mj` |

- 两者各自持有独立的 `orchestrator.sqlite`、`worker-gitconfig`、`gh-config`、`.lock`
- 互不阻塞、无锁冲突（这正是多仓库方案当年反复踩的坑）
- 停止 B 不影响 A

### 由此发现的一条运维前提（重要）

新实例的 `<stateDir>/gh-config` 是**空的**，因此它的第一次 setup 会以 `agentCliSignedOut` 失败——这是 §8.4 凭据边界正确工作的表现，不是缺陷。**每个实例都需要一次性把智能体账号登进自己的配置目录**：

```powershell
set "GH_CONFIG_DIR=%USERPROFILE%\.dsh\state\<instance>\gh-config"
gh auth login
```

如果同一账号的多个实例共用凭据（只读场景常见），把已有实例的 `gh-config\{config.yml,hosts.yml}` 复制过去即可（这一版就是这样验证的）。

结论：§8.3 在本适配版 上**可落地**——多上下文 = 多实例，隔离由状态目录承担，凭据边界随之天然分离。

## 5. 尚未做（后续）

1. **桌面应用的多实例管理（原由外壳承担，外壳已移除）**：原来的「实例列表 / 新建 / 启停 / 打开窗口」由桌面外壳的实例窗口与 `instances.ps1` 提供，随 `windows-app/` 于 2026-11-07 移除。当前做法是命令行起第二实例（§3）；跨实例只读总览仍可用本节第 2 条的聚合器。
2. **实例级 Watchdog 的统一视图** —— **已做（2026-11-07）**：新增只读聚合器 `src/app/instances-view.ts`（独立入口
   `lib/instances-view.js --instances-status [--json]`，不属于任何单实例）。数据只来自实例注册表 `config/instances.json`（其所在目录由 `--install-root` / `SUPERAGENT_INSTALL_ROOT` 指定）、
   各 `<stateDir>/instance-status.json`（Runtime 每 10 s 发布：内容变化才以临时文件 + rename 原子重写，未变化只
   `utimesSync` 刷新 mtime 作为心跳；`schema: 1` 版本化，读者以 mtime 判活）与 `<stateDir>.lock` 的 stat 加 pid 存活
   检查；不读日志、不打开实例 sqlite、不抢锁、不启停实例；仅当 status 缺失时，才对记录里的 `port` 做一次只读
   `GET state` 回退。产出 `InstanceReport[]`（健康/负载/暂停/工单计数/锁与心跳年龄），可直接供跨实例健康汇总与实例
   管理 UI 复用；各实例自己的 Watchdog 决策逻辑未改动。单测 `tests/instances-view.spec.ts`；两个探针实例（一活一死）
   聚合前后 `.lock` mtime、sqlite-wal mtime、目录文件清单与 PID 集合均不变。
3. **端口冲突** —— **原实现随外壳移除（2026-11-07）**：桌面外壳启动时会先探测钉住的端口（实例记录 `port`
   或 `SUPERAGENT_PORT`），被占则把 overlay 写成 `0`（系统分配）并在日志/启动页说明；判定与探测在
   `windows-app/port-probe.js`，`main.js` 的 `resolveOverlayPort()` 负责写 overlay。这些文件已随 `windows-app/`
   删除，**该自动探测能力不再存在，原来的单测与证据也不再可复跑**。当前做法：在每个实例的 overlay 里直接写
   不同的 `webserver.port`；不想手工分配就写 `0`，让内核在 bind 时挑端口（实际端口见 DSH 启动日志）。
4. **workspace 列表跨实例串台** —— **已做（2026-11-07）**：`workspaceRegistry` 与 Session 列表原来都读 DSH 共享的
   `<DSH_HOME>/storages/workspace.json` 与 `<DSH_HOME>/sessions`，所以第二个实例的侧栏会列出别的实例建的
   workspace。现在根按实例解析，规则只有一处：`src/app/instance-roots.ts` 的 `instanceRoots`。
   - **默认实例（单实例）不变**：`stateDir` 等于 profile 默认的 `<DSH_HOME>/state/superagent` 时，仍读
     `<DSH_HOME>/storages` 与 `<DSH_HOME>/sessions`，路径解析结果与改前逐字相同。
   - **其它 stateDir**：改读 `<stateDir>/storages` 与 `<stateDir>/sessions`，两个实例各看各的。
   - 组合层读不到 `stateDir`（`!!js` 沙箱只有 `process` 与 `dshHomePath`），所以 `cordis.patch.yml` 用环境变量
     `SUPERAGENT_DATA_HOME` 作为同一规则的开关：未设置时表达式就是原来的 `dshHomePath('storages')` /
     `dshHomePath('sessions')`；第二实例启动时把它设成自己的 `stateDir`。若 stateDir 非默认而该变量缺失或
     与 stateDir 不一致，Runtime 启动时会打一条警告并给出修复写法。
   - **怎么起第二实例**：同一 profile 再起一个进程，用自己的 overlay 指定 `webserver.port` 与
     `dsh-superagent.stateDir`，并在启动前设置 `$env:SUPERAGENT_DATA_HOME = '<stateDir>'`（退役壳的
     `--instance` 参数已不存在）。示例：

     ```powershell
     $env:SUPERAGENT_DATA_HOME = '<you>\.dsh\state\team-b'
     node "$env:APPDATA\npm\node_modules\@deepseek-ai\dsh\lib\bin.js" --profile superagent --patch .\team-b.yml --no-open
     ```
   - **迁移（老 workspace 怎么归位）**：旧 workspace 与旧 Session 仍在 `~/.dsh/storages/workspace.json` 与
     `~/.dsh/sessions/`。单实例继续读那里，**不需要迁移**。要让某个新实例带上旧 workspace：先停掉该实例，
     在它的 stateDir 下建好 `storages/` 与 `sessions/`，再把 `workspace.json`（或按需合并其中的条目）与对应
     会话目录复制过去；**不要两个同时运行的实例写同一份文件**。旧文件在新实例不再读它之后仍可保留作回退，
     确认不需要回退再删。
   - 验收：`tests/instance-roots.spec.ts` 锁定默认实例的逐字结果与非默认实例的根；真机两个探针实例
     （`stateDir` 分别为临时目录下的 a、b）：不设变量时两者写同一份 `<临时 DSH_HOME>/storages/workspace.json`
     （串台复现），设变量后各写各自的 `<stateDir>/storages/workspace.json`，互不包含；单实例探针的根仍是
     `<临时 DSH_HOME>/storages`。
