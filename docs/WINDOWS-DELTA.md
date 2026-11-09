# WINDOWS-DELTA — 本项目相对上游的改动清单与升级流程

本文件是本适配版的**唯一权威差量清单**。上游（`deepseek-ai/dsh-superagent-prototype`）每次更新后，按本文件核对即可。

设计目标：**上游更新能被低成本吸收，本项目的工作永不丢失。**

---

## 1. 仓库结构

```
upstream   https://github.com/deepseek-ai/dsh-superagent-prototype.git   （只读，官方原型，差量核对的基准）
reference  https://github.com/Check-mj/dsh-superagent-windows.git         （只读，Windows 层的起步来源，不再是上游）
origin     https://github.com/ReSerendipity/dsh-superagent                （本适配版唯一推送目标）
main       本项目的分支 = 官方 main + Check-mj 的 Windows 移植 + 本适配版的后续改动
tag        upstream-base   记录取基线时的官方提交（8c32a9d），一条命令即可看官方新动向
```

升级只有三步：`fetch → merge → 跑契约测试`。详见 §5。

---

## 2. 改动分层（重要）

本项目**绝不整体重写上游代码**，改动按四层组织，每层与上游的耦合度不同：

| 层 | 位置 | 与上游冲突概率 | 说明 |
|---|---|---|---|
| **L1 平台补丁** | `src/deployment.ts`、`src/infra/environment.ts` | 中（仅这几处） | `process.platform === 'win32'` 门控，Linux 分支保持逐字节等价 |
| **L2 新增文件** | `scripts/dsh-superagent.cmd`、`scripts/dsh-service-hook.mjs` | 无 | 纯新增，上游不会有同名文件 |
| **L3 应用壳（已移除）** | `windows-app/`（Electron；2026-11-07 删除） | **零** | 当年完全不 import 上游源码，只通过 CLI 与 HTTP API 交互 |
| **L4 契约测试 + 文档** | `tests/windows-port.spec.ts`、`WINDOWS-SETUP.md`、本文件 | 低 | 测试锁定本项目依赖的行为，文档记录口径 |

`scripts/dsh-superagent` 是**例外**：它是上游文件，本项目做了平台门控修改（L1 级），冲突概率中，但冲突只发生在 tmux 相关函数周围。

---

## 3. L1 逐处清单

### `src/deployment.ts`

| 位置 | 上游行为 | 本项目的改动 | 为什么 |
|---|---|---|---|
| `absolute()` 校验 | `pattern(/^\//)`，只认 `/` 开头的 POSIX 绝对路径 | `pattern(/^(?:[A-Za-z]:[\\/]|\/)/)` | `stateDir: C:/...` 在上游会被 schema 拒绝，插件直接不激活 |
| `workerProbe()` | 用 `['env', 'PATH=…', …argv]` 调外部 `env` 命令 | win32 分支改为通过 subprocess 的 `env` 层传 PATH + `GH_CONFIG_DIR` | Windows 没有 `env` 可执行文件；且账号探针早于 `applyEnvironment()` 执行，必须显式传 `GH_CONFIG_DIR` 否则会读到操作者本人的 gh 账号 |

### `src/infra/environment.ts`

| 位置 | 上游行为 | 本项目的改动 | 为什么 |
|---|---|---|---|
| `agentGhConfig()` | 不存在（上游用 wrapper 脚本选账号） | 新增，指向 `<stateDir>/gh-config`；`agentVariables()` 默认注入 `GH_CONFIG_DIR` | 两种账号模型现在**都支持**：可以直接指向 `gh.exe` + `GH_CONFIG_DIR`（默认、最省事），也可以指向上游文档里的 `.cmd` 包装器（`runAsWorker` 经 `cmd.exe /d /c <prog> <args...>` 启动） |
| `agentVariables()` | 不含 `GH_CONFIG_DIR` | win32 下注入 `GH_CONFIG_DIR` | 让 worker 会话与 git credential helper 都落到智能体账号 |
| `written()` | 按 `\n` 切前两行、精确匹配 `# Written by …` | 按 `/\r?\n/` 切，并剥掉行首 `@REM ` | Windows 垫片是 batch 文件，`#` 注释会被 cmd 当命令执行，标记必须写成 `@REM # Written by …` |
| `writeEnvironment()` shim | 写无扩展名 `#!/bin/sh` 文件 | win32 写 `<name>.cmd`（`@echo off` + `@REM` 标记 + 绝对路径调用 + `%*` + `exit /b`） | 无扩展名文件在 Windows PATH 查找（PATHEXT）里根本不可执行 |
| `writeEnvironment()` 额外 | — | 创建 `<stateDir>/gh-config` 目录 | 给 gh 一个可写的独立配置目录 |
| PATH 剥离 | 垫片把自己从 PATH 里剔除再 exec | Windows 垫片**同样重建 PATH**（`%~dp0` 比对 + `for` 拆分 + `endlocal & set`） | 恢复上游的语义保证：被调用的包装器若按名字解析 `gh`，会落到真实二进制而不是再次进入垫片。已行为验证：自身目录消失、其余条目保留 |

**注意：git 凭据层完全没改。** `credentialHelper()`、`gitQuote()`、`worker-gitconfig` 内容、`verifyEnvironment()` 全部保持上游原样——实测在 Windows 上 `git config -z --show-origin --get-all credential.https://github.com.helper` 的渲染与期望值逐字节相等。

### `scripts/dsh-superagent`

上游是 Python + tmux。本项目在 `os.name == 'nt'` 分支里换成：分离进程启动、pidfile、`OpenProcess` 存活检测、命名管道优雅停止（转成 DSH 已处理的 SIGINT）。**POSIX 分支原样保留**，只额外抽出 `wait_for_health()` 供两侧共用。

---

## 4. 契约测试（升级后必须全绿）

`tests/windows-port.spec.ts` 锁定的是本项目**依赖**的行为，而不是上游的实现细节：

- 垫片以 `<name>.cmd` 写出，首行 `@echo off`、次行带标记，包含绝对 CLI 路径与 `%*`
- `written()` 能认出自己写的 batch 垫片 → 重复调用 `writeEnvironment` 不报 `foreignFile`（这是 setup 每次启动都会跑到的路径）
- 被禁命令写成失败垫片（stderr 提示 + `exit /b 1`），`gh`/`git`/`lark-cli` 永不被禁
- `agentVariables(stateDir).GH_CONFIG_DIR === <stateDir>/gh-config`

`tests/docs.spec.ts` 本项目修了两处 Windows 分隔符假设（`relative()` 返回反斜杠、用 `lastIndexOf('/')` 切文件名）。

**升级判定标准**：`pnpm typecheck && pnpm build` 通过，且 `pnpm vitest run tests/windows-port.spec.ts` 全绿。

Windows 上整套测试现在也是**全绿**：`1157 passed / 48 skipped`。被跳过的 48 项只针对 POSIX 专有机制（`#!/bin/sh` 垫片、`ps`/`tmux`、POSIX 模式位、符号链接、`:` 分隔的 PATH），在 Linux/CI 上照常执行，每个跳过点都带一行说明为什么。这样「红」不再是常态信号，出现真失败时才看得见。

---

## 5. 升级流程

本仓库与上游**没有共同祖先**（2026-11-06 重建为独立历史，自 `0.1.0` 起为公开基线），所以升级不是 `git merge`，而是"取 diff → 按 §3 的清单逐处移植"。基线 SHA 记在仓库根的 `.upstream-baseline`。

```bash
cd <checkout>

# 1. 取官方更新，对比基线
git fetch upstream
baseline=$(cat .upstream-baseline)
git log --oneline $baseline..upstream/main          # 先看改了什么
git diff $baseline upstream/main --stat | tail -5

# 2. 按 §3 的 L1 清单逐处移植（不要 merge 无关历史，--allow-unrelated-histories 只会产生噪音）
#    移植范围只应落在 §3 列出的文件与 §9 的框架层增量上

# 3. 更新基线并重建
echo <新的上游 SHA> > .upstream-baseline
pnpm install
pnpm build

# 4. 契约测试
pnpm typecheck
pnpm vitest run tests/windows-port.spec.ts

# 5. 若插件接口变了，重启后端/应用验证面板与健康
```

### 冲突处理预案

冲突**只会**出现在 §3 列出的那几个位置。处理原则：

- 先看官方这次是否重构了同一函数。若是，**以官方新结构为准，再把本项目的 win32 分支移植进新结构**，不要反向改。
- `writeEnvironment()` 的 shim 写入逻辑若被官方改写：保留官方 POSIX 写法，`windows ? … : …` 只挂在具体写文件那一行。
- `workerProbe()` 若官方也引入了平台抽象：优先用官方的抽象，删掉本项目的分支。
- 升级后**必须**重新生成 `worker-bin`（删掉 `<stateDir>` 下旧垫片，或让 setup 重跑），因为标记格式变了会触发 `foreignFile`。

### 基线维护

每次移植上游改动后：

```bash
git rev-parse upstream/main > .upstream-baseline
```

`.upstream-baseline` 只有一行 SHA，随仓库提交；它替代了早期用 tag 记基线的做法（重建历史后 tag 已不指向任何上游提交）。

---

## 6. 应用层为什么不会和上游冲突（外壳已移除，历史记录）

> 2026-11-07：`windows-app/` 已从仓库删除，本节只说明当年的隔离方式，不再是现有部件。

`windows-app/` 只做两件事：

1. **进程编排**：按 profile 拉起 `node <dsh>/lib/bin.js --profile <p> --patch <overlay> --no-open`，捕获它打印的 `dsh web: http://127.0.0.1:<port>/?token=…`，把它加载进 BrowserWindow。
2. **宿主适配**：git/gh 的 PATH 预检、便携 userData、单实例、退出杀进程树、错误页与日志。

它不 import 上游任何源码，也不改插件行为。**上游怎么升级，应用壳都不用动**；反过来，应用壳怎么迭代，也不影响上游合并。唯一需要同步的接口是两处：CLI 参数（`--profile/--patch/--no-open`）与 `/orchestrator/api/state` 管理 API——两者都在 `docs/006-deployment.md` 里有正式承诺。

---

## 7. 目前已知未完成项

- 官方仓库**没有** Windows 支持；本项目是唯一实现，因此未来官方若自带 Windows 分支，应评估是否整体切回官方实现（见 §5 冲突预案最后一条）。
- 本适配版独立托管在 `origin`（`ReSerendipity/dsh-superagent`）；Check-mj 的移植已降为 `reference`，不再作为上游跟随。
- `windows-app/`（已移除）当年也只入库源码与构建脚本，打包产物（Electron 二进制、`user-data/`、`lib/`、`node_modules/`）不入库。

---

## 8. 网络传输适配（中国大陆网络常见）

这一类改动与上游功能无关，但**没有它智能体无法工作**：它接单后要用 `git fetch` 检出仓库。

### 8.1 观测到的网络分层

| 目标 | 结果 |
|---|---|
| `api.github.com:443` | 通常可达（`gh` 用它轮询，所以面板看起来正常） |
| `codeload.github.com:443` | 通常可达 |
| `github.com:443`（git 的 HTTPS 传输） | **常被阻断** |
| `github.com:22` / `ssh.github.com:443` | 通常可达 |

后果：面板能收到触发、能评估，但执行器 `git fetch` 必然失败。这是最容易误判成"插件坏了"的地方。

### 8.2 SSH 传输（`SUPERAGENT_GIT_SSH=1`）

`src/infra/environment.ts` 的 `writeEnvironment()` 增加一段 opt-in 的 URL 重写：

```ini
[url "ssh://git@github.com/"]
	insteadOf = https://github.com/
```

worker 的 `git fetch https://github.com/owner/repo` 因此改走 SSH。**手动做法**：若要后端走 SSH，在实例的 overlay 或启动环境里设置 `SUPERAGENT_GIT_SSH=1`（日志有 `worker git transport: SSH`），否则保持 HTTPS 默认。原先「桌面应用自动判断 `~/.ssh/config` 里有无 `Host github.com` 路由」的探测随外壳于 2026-11-07 移除，不再存在。

配套（一次性、在操作者侧）：
- 生成密钥：`ssh-keygen -t ed25519 -N "" -f %USERPROFILE%\.ssh\id_ed25519`
- `~/.ssh/config`：`Host github.com` → `HostName ssh.github.com` / `Port 443` / `User git` / `IdentityFile`
- 把 `id_ed25519.pub` 登记到 GitHub 账号（**这一步必须能访问 github.com**，之后不再需要代理）

### 8.3 系统代理透传

Windows 的系统代理在注册表 `HKCU\...\Internet Settings` 里，而 **git/libcurl 与 `gh` 都不读它**——这正是"浏览器能打开 GitHub，但 `git push`/`git fetch` 超时"的原因。**手动做法**：从注册表读出 `ProxyEnable`/`ProxyServer`，在启动后端前设置 `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY`（日志有 `system proxy: …`），使 git、gh、node 与浏览器走同一条路。原先「桌面应用启动时自动读取并透传」的实现在 2026-11-07 随外壳移除，不再存在。

> 注意：仓库本地若已 `git config http.proxy`，那是**开发者手动配置**，不属于产品行为；产品侧只做环境变量透传。

### 8.4 判定顺序

1. `~/.ssh/config` 路由了 github → 用 SSH（不依赖代理，最稳）
2. 否则若系统代理开启 → 透传代理给后端（HTTPS 传输）
3. 否则直连（在无阻断网络下等价于上游默认行为）

### 8.5 TLS 中间盒（`UNABLE_TO_VERIFY_LEAF_SIGNATURE`）

**现象**：`dsh plugin … add "git+https://…"` 期间 pnpm/git 打印 `UNABLE_TO_VERIFY_LEAF_SIGNATURE` 并重试（常见 1–2 次），有时最终失败。

**原因**：机器或网络边界上有 TLS 中间盒（公司代理、杀毒软件的 HTTPS 扫描）。git 的证书链校验不认它的根证书。这与插件无关——克隆任何 GitHub 仓库都会遇到。

**处置**（按优先级）：

1. 把代理的根证书导入系统「受信任的根证书颁发机构」：`certutil -addstore Root <ca>.cer`（需要管理员）。
2. 只给 git 指定 CA 包：`git config --global http.sslCAInfo <ca-bundle.pem>`。
3. Node 侧（pnpm 自身）需要时设 `NODE_EXTRA_CA_CERTS=<ca-bundle.pem>`。

不要用 `git config --global http.sslVerify false` 绕过：它关掉整条链的校验，等于对中间人敞开。

### 3.4 实战暴露的两处（第一单端到端才出现）

| 位置 | 上游行为 | 改动 | 为什么 |
|---|---|---|---|
| `src/app/sessions.ts` 主 Session 工具限制 | 硬编码 `allow: ['skill','bash',...]` | 从**实际工具注册表**取：`MASTER_TOOLS.filter(name => agent.ctx.tools.get(name, scope))` | `tools.restrict()` 拒绝名字里含有不存在的工具，Windows 首启直接 `Session setup` 失败。按平台猜 `pwsh` 也不对——Windows 上装了 bash 插件的 profile 两者都有 |
| `src/executor/dsh.ts` prepare 执行 | `['sh','-c', command]` | Windows 走 `['cmd.exe','/d','/s','/c', command]` | Windows 无 `sh`；POSIX shell 还会把命令里每个 Windows 路径的反斜杠吃掉，报 `command not found`。**静态检查发现不了，只有真跑工单会暴露** |

### 3.5 批次包装器（`.cmd`）的参数传递

`runAsWorker()` 遇到 `.cmd`/`.bat` 时改用 `cmd.exe`，但**必须把程序与参数作为分开的 argv 传**：

```ts
// 正确：Node 逐个引用，cmd 只解析一次
['cmd.exe', '/d', '/c', argv[0], ...argv.slice(1)]

// 错误：整行拼成一个字符串，cmd 会二次解析引号，
// 目标程序拿到的是 \"…\" 而不是 "…"（实测失败）
['cmd.exe', '/d', '/s', '/c', argv.map(quote).join(' ')]
```

---

## 9. 框架层增量（与 Windows 无关）

除了平台适配，本适配版还包含以下**框架层**扩展。它们同样遵循「新增文件 + 最小侵入」的原则，上游更新时按 §3 的方式合并。

| 增量 | 位置 | 上游行为 | 本项目的做法 | 状态 |
|---|---|---|---|---|
| 声明式配置 | `src/app/config-file.ts`、`src/app/config-yaml.ts`、`deployment.ts` 的 `configPath` | 配置只在面板/`orchestrator.sqlite` | 新增 `configPath` 指向 JSON 或 YAML（扩展名决定解析器）；启动时按块覆盖已存设置，未声明的块保持不变，格式错误 fail-open 并带行号 | ✅ 已实施，`docs/009` |
| Mode A 单人收件目录 | `src/sources/inbox.ts`（新增）、`tsdown.config.ts`/`package.json`/`cordis.patch.yml` 各加一行、`tests/inbox.spec.ts` | 事件入口只有 GitHub/飞书，二者都靠通知，而 GitHub Source 会丢弃智能体账号自己的事件（`sources/github.ts` 的 sameName 过滤），因此**派单者必须与智能体是两个账号** | 新增第三个 Source：本地收件目录里的 `.md` 文件即工单，归档移动本身是读游标，结果写 `done/*.reply.md`。上游过滤一行未改——Mode A 不走通知入口。**双账号由此从使用前提降为 Mode B（团队语义）的配置项** | ✅ 已实施，默认 `disabled: true`，profile 里启用；契约测试 1196 全绿 |
| Source 实例命名 kind | `policy.ts` 的 `SourceInstanceSchema.kind`、`sources/registry.ts` | 设置里 Source 的 key 被当作 kind，一个 kind 只能一个实例 | Schema 增加可选 `kind`（缺省=id，旧配置语义不变）；registry 按实例解析 kind；**超过一个 deployment 实例时 setup 明确报错**而非静默用错仓库 | ✅ C1，C2/C3 见 `docs/010` |
| `stateDir` 派生默认 | `src/deployment.ts` 的 `defaultStateDir()` 与 `machineOf` 回退参数、`src/index.ts` 按 `profileContext` 派生 | `stateDir` 为 schema 必填（`.required()`），bundle patch 头注释明确「the plugin refuses to start without stateDir」；缺失时 entry FAILED——但该 entry 非必需，启动审计只警告，桌面端 host 的 stderr 又被 Electron 吞掉，新用户只见面板「没有响应」（静默失败） | schema 改为可选：未配置时派生 `<DSH home>/state/<profile>-superagent`（`superagent` profile 与无 profile 上下文沿用 `state/superagent`），显式配置永远优先；锁隔离语义（一个 `stateDir` 一个后端）不变，新装免配置 | ✅ 0.1.5 已实施；上游若跟进，删除 `defaultStateDir` 与回退参数即可切回 |
| preset 显示名回归上游 | `cordis.patch.yml` 两处 `name` | 上游本就是 `dsh-superagent 执行器` / `dsh-superagent 主 Session`（无 `[内部]` 前缀；description 为「专用，不供手动选择」） | 移植期曾自加 `[内部]` 前缀；0.1.4 删除、回归上游命名。description 保留更友好的「普通对话请选『标准模式』」提示，属措辞差异非结构差异 | ✅ 0.1.4 已对齐；preset id、结构、caps 与上游逐条一致 |

两条都要保持：**新增可选字段 + 明确拒绝未支持组合**，这样既向前推进，也不会让运行中的单实例部署悄悄行为改变。
| 项目 | 文件 | 内容 | 与上游的关系 |
|---|---|---|---|
| Watchdog 深化 | `src/app/watchdog.ts`、`src/app/runtime.ts`、`src/deployment.ts` | 跨 tick 差分、停滞识别、空 digest 不投递、`watchdogGuidance` 常驻指令 | 上游若实现 §6 的进展判断，删掉这三个配置项与本模块的差分逻辑即可切回 |
| Router 分片（§2.1） | `src/app/shards.ts`、`src/app/sessions.ts`、`src/app/runtime.ts` | `routerShards`（默认 1）、按 Thread 的稳定放置、分片 Session 预置、`router` 健康项 | 上游若实现 Router 分片，删掉本模块与配置、切回 |
| 状态存储接缝（§5） | `src/app/state-store.ts`、`src/app/source-context.ts` | `StateStore` 接口 + 本地适配器（可选命名空间前缀），Source 状态经它构造 | 上游若支持远端状态后端，删掉适配器、改为注入上游实现 |

| 异步子任务（§4.1 右半边） | （无代码） | 曾实现 `subagent_background`/`subagent_cancel`，实测上游 `subagent` 已支持后台运行后**已删除** | 无需切回：本项由上游提供，详见 docs/017 §7 |
