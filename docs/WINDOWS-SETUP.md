#
# 默认安装方式是从构建仓库的 git 源（装 main 当前最新提交）：
#   dsh plugin --profile superagent add "git+https://github.com/ReSerendipity/dsh-superagent.git"
# 本文的 link: 步骤用于本机 checkout 的开发/调试循环。
#
# dsh-superagent Windows 操作手册

> 面向本机操作者（Windows 11 Pro x64，**没有管理员权限**）的完整部署与运维手册。
> 上游文档（`README.md`、`SETUP.md`、`docs/000`–`docs/008`）描述的是 Linux/macOS 的形态；本文件记录 **Windows 原生移植**后真正可用的做法，并标出与上游的每一处差异。
>
> 文档状态标记：
> ✅ **本机实测**（写这份文档时实际跑过）　🔧 **源码确认**（读移植代码确认，未逐条运行）　⏳ **待定/未验证**（第 12 节汇总）
>
> **2026-11-07：桌面外壳已移除。** `windows-app/`（含 `main.js`、`Superagent.exe` 构建产物、`install.ps1` / `install.cmd`、`instances.ps1`、快捷方式逻辑）已从仓库删除。本文中凡涉及「桌面应用」「外壳」「`windows-app`」「`Superagent.exe`」「快捷方式」的章节（§1.2–§1.3 的第二条路、§3.6、§4.5、§8.1、§10.3、§11、§12、§13 的相应步骤）**只作历史记录，不能再执行**。当前可用路径：§3.8（插件装进官方应用）与 §7/§8.2（CLI 服务管理器）。
>
> **路径占位符**（本文不写死任何一台机器的目录）：
>
> - `<checkout>`：你把本仓库放在哪里（示例：`%USERPROFILE%\src\dsh-superagent`）。
> - `%LOCALAPPDATA%\Programs\Superagent`：已移除的桌面外壳的默认安装根（历史占位，不再产生）。
> - `<gh.exe>` / `<git 目录>`：你的 GitHub CLI / Git 的安装位置，用 `where gh`、`where git` 查。
> - `%USERPROFILE%`：你的用户目录；配置文件里的路径要写成 `<you>/...` 这种字面绝对路径。
>
> 权威文档：**相对上游的改动清单与升级流程**见 [`docs/WINDOWS-DELTA.md`](WINDOWS-DELTA.md)；本手册是操作层摘要。

---

## 目录

1. [这是什么，以及 Windows 上它是怎么构成的](#1-这是什么以及-windows-上它是怎么构成的)
2. [Windows 前置条件](#2-windows-前置条件)
3. [一次性装配：插件与 DSH CLI](#3-一次性装配插件与-dsh-cli)
4. [机器配置：profile 的 cordis.patch.yml](#4-机器配置profile-的-cordispatchyml)
5. [模型 provider](#5-模型-provider)
6. [GitHub 账户与仓库配置（Mode A 要一个，Mode B 要两个）](#6-github-账户与仓库配置mode-a-要一个mode-b-要两个)
7. [面板设置：Sources → Policy → Execution → Prompts](#7-面板设置sources--policy--execution--prompts)
8. [启动 / 停止 / 状态](#8-启动--停止--状态)
9. [第一次跑通](#9-第一次跑通)
10. [故障排查](#10-故障排查)
11. [Windows 移植与上游的差异](#11-windows-移植与上游的差异)
12. [验证状态与开放问题](#12-验证状态与开放问题)
13. [附录：路径、命令、升级与回滚](#13-附录路径命令升级与回滚)

---

## 1. 这是什么，以及 Windows 上它是怎么构成的

dsh-superagent 是 **一个 GitHub 仓库的常驻编码智能体**，作为 DeepSeek Harness（下文 DSH）的插件运行：它监听 GitHub（可选飞书），把"被允许的人提出的请求"变成一张 **Ticket（工单）**，在自己的 Session 和目录里干活，最后回到原对话交付结果（通常是一个 Pull Request）。面板只显示"需要人处理的事"。

> **本移植版给单人场景留了分叉**：上游的 GitHub 入口要求"派单的账号 ≠ 执行的账号"，所以一个人用必须先注册第二个 GitHub 账号。这条铁律**没有被破坏**，而是被**旁路**——新增的 `inbox` 来源让你往本地目录丢一个 `.md` 就能派单，其余（Eval / Mandate / Ticket / worktree 执行 / 交付）与上游完全同一套。两条路线的对照见 §6.0，本机已按 Mode A 端到端跑通（§12.1）。

### 1.1 三层结构

```
┌──────────────────────────────────────────────────────────────┐
│ Superagent 桌面应用（Electron，便携，无 admin）              │
│  %LOCALAPPDATA%\Programs\Superagent\Superagent.exe          │
│  · 自己的窗口 + 图标，双击即用                               │
│  · 负责拉起后端、清理子进程、显示启动失败页                  │
└───────────────────────────┬──────────────────────────────────┘
                            │ 启动一个隐藏的子进程（不经过 shell）
┌───────────────────────────▼──────────────────────────────────┐
│ DSH 后端：dsh profile = superagent                           │
│  node …\@deepseek-ai\dsh\lib\bin.js --profile superagent    │
│       --patch <userData>\runtime.patch.yml --no-open         │
│  · 只监听 127.0.0.1 的随机端口（应用强制 port 0）            │
│  · 在应用窗口里加载 http://127.0.0.1:<port>/?token=…        │
└───────────────────────────┬──────────────────────────────────┘
                            │ 插件 dsh-superagent（link: 到本机 checkout）
┌───────────────────────────▼──────────────────────────────────┐
│ 面板（侧栏 Superagent）+ 智能体                              │
│  · 主 Session 评估、路由；每个 Ticket 一个执行器 Session     │
│  · 以 你的 Windows 用户 身份、danger-full-access 运行        │
│  · 通过独立的 GitHub 账号发评论、推分支、开 PR               │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 本机各组件的确切位置

| 组件 | 位置 / 取值 | 状态 |
| --- | --- | --- |
| 桌面应用（安装后） | 安装根目录 `%LOCALAPPDATA%\Programs\Superagent\`：`Superagent.exe`（Electron 44.7.0，自包含）+ `resources\app\` + `config\paths.json` +（可选）`tools\` + Electron 运行时。**本机 0.2.1 实装 = 368 MB，没有 `tools\`**；`resources\` 266 KB。旧文档的"约 500 MB（`tools\` ≈133 MB）"是那台**手工往安装根塞了 git/gh** 的机器，默认安装不会产出这个尺寸。启动必须带 `--no-sandbox --disable-gpu`（快捷方式已内置） | ✅ 2026-11-06 本机自建 → 自装 → 首跑 |
| 桌面快捷方式 | `%USERPROFILE%\Desktop\DSH-Superagent.lnk` + 开始菜单 `…\Programs\DSH-Superagent\DSH-Superagent.lnk`（**文件名带 `DSH-` 前缀，且开始菜单里还多一层同名子目录**）：Target=`<root>\Superagent.exe`、Arguments=`--no-sandbox --disable-gpu`、WorkingDirectory=`<root>`（`install.ps1` 用解析后的真实路径生成） | ✅ 2026-11-06 本机读回两项逐项一致 |
| 应用源码（在 checkout 里） | `<checkout>\windows-app\`：`main.js`、`preload.js`、`instances-window.js`、`build-portable.js`、`install.ps1`、`install.cmd`、`instances.ps1`、`启动 DSH-Superagent.cmd`、`icon.ico/png`、`instances.example.json`、`superagent.settings.example.json`、`README.md`、`INSTALL.md`、`package.json`(+lock)、`node_modules\`、`Superagent\`（构建产物，368 MB，已 gitignore）。`verification\` **本机不存在**：它也在 `.gitignore` 里，旧记录指向的截图只留在当初做验收的那台机器上 | ✅ 2026-11-06 本机自建（目录逐项 `ls` 核对） |
| 应用用户数据 | **默认 `%APPDATA%\Superagent\`**（这一版实测存在 `app.log`、`backend.log`、`runtime.patch.yml`、`watchdog\`；`window-state.json` 要等关闭才写；`SUPERAGENT_SCREENSHOT=1` 时另有 `screenshot.png`，这一版未启用所以**没有图像证据**）<br>回退：`<exe 所在目录>\user-data\` → `%TEMP%\superagent-user-data` | 🔧 源码；实测 app.log 在此 |
| DSH 安装 | `%APPDATA%\npm\node_modules\@deepseek-ai\dsh`（版本 `0.2.1-rc.3`） | ✅ |
| DSH profile | `%USERPROFILE%\.dsh\profiles\superagent\` | ✅ 已存在 |
| 插件 checkout | `<checkout>`（profile 以 `link:` 指向它） | ✅ 已 link |
| 状态目录 `stateDir` | `<you>/.dsh/state/superagent`（数据库、锁、worker shim、agent 的 git 配置、工单目录） | ✅ 配置好；目录已创建，含 `orchestrator.sqlite` |
| 模型凭据 | `%USERPROFILE%\.dsh\.credentials.yaml` 的 `refs: OPENCODE_GO_API_KEY` | ✅ 已存在 |
| GitHub 智能体账户 | 单独的 GitHub 用户；面板 CLI 填 `gh.exe` 的绝对路径，账号由 `GH_CONFIG_DIR` 隔离（第 6 节） | **仅 Mode B 需要**；Mode A 不要求第二个账号（§6.0） |
| 被操作的仓库 | `github.com/<owner>/<name>` + 本地 clone（供 `git worktree` 使用） | ⏳ 需要你指定（试验田请用可折腾的小仓，**不要用生产仓**） |
| 工单目录 | `stateDir\work\<工单短名>-<id前12位>\`（默认） | 🔧 |
| Mode A 收件目录 | `stateDir\inbox\`（投放处）+ `stateDir\inbox\done\`（归档 + 回信 `<文件>.reply.md`） | ✅ 本机已启用并端到端跑通 |
| 外层值守（**可选，仅 CLI 无人值守路径**） | `scripts\dsh-superagent-watchdog.ps1`（一次 tick）、`scripts\dsh-superagent-guard.ps1`（登录后每 15 分钟）、`scripts\install-guard-startup.cmd`（双击装自启）；状态在 `%APPDATA%\Superagent\watchdog\` | ✅ 脚本逻辑已实弹验证；⏳ 登录自启未实测（需操作员本人注销重登；应用内路径下与插件锁互斥且监督不到应用后端，见 §8.6） |

### 1.3 三条运行路径（用途不同，别混用）

| | **官方应用内插件**（最省事，见 3.8） | **自带桌面应用**（已移除，仅历史） | **CLI 服务管理器**（排障 / 无人值守） |
| --- | --- | --- | --- |
| 入口 | DeepSeek Harness → 插件 → 「+ 添加插件」 | 双击桌面快捷方式 `DSH-Superagent.lnk`（或 `windows-app\启动 DSH-Superagent.cmd`） | `.\scripts\dsh-superagent.cmd start` |
| 额外要装的东西 | 无（复用你已在用的应用） | 368 MB 外壳 + Node + 全局 `@deepseek-ai/dsh` | 同左，但不需要外壳 |
| 端口 | 应用自己的（本机实测 `127.0.0.1:2165`，带 token） | 随机空闲端口（应用写入 `runtime.patch.yml` 覆盖） | profile 里写死的 `3082` |
| 需要打开浏览器吗 | 不需要，窗口内嵌面板 | 不需要，窗口内嵌面板 | 需要，日志里会打印带 token 的 URL |
| 需要 `gh` 在 PATH 吗 | 不需要（面板里填绝对路径） | 不需要（同左） | 同左 |
| 关闭方式 | 退出应用（菜单「应用 → 退出」；关窗口会缩进托盘，不算退出） | 关窗口 / 文件→退出 | `.\scripts\dsh-superagent.cmd stop` |
| 状态 | 侧栏「DSH-Superagent」页 + 插件页组件状态 | 窗口内可见 + `app.log` | `status` 的退出码 0/1/2/3 |

> 三条路**共用 `stateDir` 时同一时间只能跑一条**（`Lock file is already being held`）；各自用不同 `stateDir` 才能并行，但那样会出现两套工单与策略。本机现在走第一条；`superagent` profile 已停住，外壳已移除，`stateDir` 由应用侧独占。
>
> §8.6 的 guard **只服务第三条路（CLI 无人值守）**，启动的是 `profile superagent` 的 DSH 后端。第一条路的宿主由应用自己启停；两条路共用同一 `stateDir` 时插件锁只允许一个实例，guard 起的后端在应用持锁期间无法激活插件，且它的 `status` 只看 CLI 的 `service.pid` 与 3082，监督不到应用的后端。所以 guard 在应用内路径下不是必需项。

> **本机现状（2026-11-07）**：第二条路的外壳已整体移除——源码、构建产物、安装根、两个快捷方式与根目录 `install.ps1` 全部删除（这一版约 748 MB），`%APPDATA%\Superagent\` 的日志作为旧证据保留。第二条路**无法再从本仓库恢复**；历史随公开基线归档。

### 1.4 一次请求的流转（理解面板的前提）

`Trigger`（GitHub 通知/评论）→ `Thread` → `Eval`（门禁 + 研判）→ 接受则创建 `Ticket` → `Assignment` → `Executor Session` 在自己的目录里干活 → 通过 `Channel` 回到原对话（评论 / PR）。术语见 `docs/001-domain.md`，面板与本文都用这套词。

### 1.5 三条必须知道的安全事实

1. **没有管理员权限也能全程部署**：所有东西都在用户目录、`<checkout>` 和安装根目录里，不写注册表的机器级设置。
2. **执行器和智能体以"你"的 Windows 账户身份、`danger-full-access` 运行**（见 `docs/006-deployment.md` 的 Permissions and isolation）。CLI 包装器和 worker 目录只是默认值，**不是安全边界**；要真正隔离，只能用独立的 Windows 账户。
3. **Mode B 下智能体的每条 GitHub 发言都署它自己的账户名**，所以走 GitHub 派单时永远不要用你的账户当智能体（第 6 节）。**Mode A 不受这条约束**：它不经过 GitHub 通知，派单是往本地目录丢文件（§6.0）。

---

## 2. Windows 前置条件

### 2.1 版本下限与本机现状

| 组件 | 要求 | 本机现状 | 结论 |
| --- | --- | --- | --- |
| Windows | Windows 10/11 x64 | Windows 11 Pro，build 26300，非管理员 | ✅ |
| Node.js | `^22.19.0 \|\| >=24.0.0`（`package.json` engines） | **v26.13.0**，`C:\Program Files\nodejs\node.exe` | ✅ |
| pnpm | 项目声明 `pnpm@11.7.0`（`packageManager`） | **10.34.9**，`%APPDATA%\npm\pnpm.cmd` | ✅ 可用（见 3.2 的注意事项） |
| git | **>= 2.32**，且发行版要自带 `sh.exe`（Git for Windows / MinGit 都有） | **2.56.0.windows.2** 存在，但**不在 Explorer 的 PATH 里**（只在 DSH 会话的 PATH 里） | ⚠️ 必须加进 **User PATH**，见 2.2 |
| Python | >= 3.8（Windows 启动器用） | **3.12.10**，用户 PATH 中；`py` 启动器也在 | ✅ |
| GitHub CLI `gh` | **>= 2.48** | 便携版 **2.103.3**：`C:\path\to\gh.exe`，**不在 PATH** | ⚠️ 见 2.2（建议装一份并加入 User PATH） |
| DSH CLI | 满足 `engines.dsh: ^0.2.1-alpha.2`；本机固定 `0.2.1-rc.3` | 已全局安装 `0.2.1-rc.3` | ✅ |
| tmux | 上游需要 | **Windows 不需要**：移植用 Windows 进程管理替换（第 8 节） | ✅ 缺省即可 |
| PowerShell | 任意 | Windows PowerShell 5.1；执行策略 `Restricted` | ⚠️ 见 2.3 |

### 2.2 必须在本机补上的两件事（git、gh 进 User PATH）

**支持的部署方式：把 `git` 和 `gh` 加进"当前用户"的持久 PATH。** 桌面应用是从 Explorer 双击启动的，它继承的是用户 PATH；
**你的用户 PATH 目前既没有 git 也没有 gh**，只有 Python、`%APPDATA%\npm` 等。因此：

- `git`：后端的初始化检查（`verifyEnvironment`）、工单的准备命令、执行器工作区都按名字调用 `git`。
  **找不到 git 时，setup 会报成非常容易误解的**
  `git does not read the github.com credential configuration dsh-superagent writes; … needs git 2.32 or later`（`gitTooOld`）。
  → 看到这条，**第一件事是在新开终端里跑 `where git`**，通常就是 git 不在 PATH 上。
- `gh`：运行期只通过**面板里填的那个绝对路径**调用它（第 7.2 节），所以**严格来说 `gh` 不在 PATH 也能工作**；但建议一并加入 User PATH，方便你手动登录/自查，也让应用的探测能发现它。

**桌面应用 / 安装器的工具探测（可重定位，见 INSTALL.md §3.2–3.3）**：**显式覆盖与安装自带的 `tools\` 都排在 PATH 之前**——自包含安装不会被机器上别处的副本顶掉。
解析优先级：`SUPERAGENT_GIT_DIR` / `SUPERAGENT_GH_DIR` 与 `<root>\tools\git\cmd`、`tools\git\bin`、`tools\gh\bin` 先于 PATH → 再往后是 `where git`/`where gh`（PATH）→ 最后是 `%ProgramFiles%\Git\cmd`、`%ProgramFiles(x86)%\Git\cmd`、`%LOCALAPPDATA%\Programs\Git\cmd`、`%ProgramFiles%\GitHub CLI`、`%LOCALAPPDATA%\Programs\GitHub CLI`。
**两种都实跑过，落在哪一档取决于安装根里有没有 `tools\`**：旧机器（手工塞过 `tools\`）的 preflight 是 `git: <root>\tools\git\cmd (bundled tools)`、`gh: <root>\tools\gh\bin (bundled tools)`；本机 0.2.1（默认安装，无 `tools\`）落到后两档——`git: C:\Program Files\Git\cmd (known path)`、`gh: <某人>\gh-cli\bin (where gh)`、`pwsh: C:\Program Files\PowerShell\7 (where pwsh)`。
找到就把目录**前置到后端子进程的 PATH**（不设置 `GH_CONFIG_DIR`，那个由插件管）。
找不到时**不致命**：启动页和面板顶部显示横幅
`未找到 git (Git for Windows) / gh (GitHub CLI)：GitHub 集成不可用。请安装 Git for Windows 与 GitHub CLI，并加入用户 PATH，然后按 Ctrl+Shift+R 重启后端。`
**看到横幅时，按 2.4 把它们加进 User PATH 再重启应用。**
注意这条便利层只覆盖**桌面应用**启动的后端；用 `scripts\dsh-superagent.cmd` 启动的 CLI 路径**不会**自动注入，必须靠 User PATH。
应用侧覆盖变量全集：`SUPERAGENT_GIT_DIR`、`SUPERAGENT_GH_DIR`、`SUPERAGENT_NODE`、`SUPERAGENT_DSH_BIN`、`SUPERAGENT_CWD`/`SUPERAGENT_CHECKOUT`、`SUPERAGENT_USER_DATA`、`SUPERAGENT_HOME`、`SUPERAGENT_PORT`、`SUPERAGENT_PROFILE`、`SUPERAGENT_STATE_DIR`。

> 立刻自查：**新开**一个 PowerShell 窗口运行 `git --version` 与 `gh --version`。
> 看不到版本号也不一定打不开桌面应用（应用会用已知目录兜底并显示横幅），但 **CLI 路径一定需要**；
> 看不到就按 2.4 加进 User PATH，然后重启应用/后端。

### 2.3 执行策略：为什么本手册一律用 `.cmd`

本机 `Get-ExecutionPolicy` 返回 **`Restricted`**。这带来两个实际后果：

1. npm/pnpm 全局安装会在 `%APPDATA%\npm` 里同时生成 `xxx.cmd` 和 `xxx.ps1`；某些情况下 PowerShell 会先解析到 `.ps1`，于是报：
   `无法加载文件 …\npm.ps1，因为在此系统上禁止运行脚本。`
   → **永远显式调用 `npm.cmd` / `pnpm.cmd` / `dsh.cmd`**（或用完整路径 + `&` 调用运算符）。
2. 任何 `.ps1` 脚本（包括你自己写的巡检脚本）都不能直接双击/直接运行；需要时用
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <脚本>`，**不要**为了省事把全局执行策略改成 `Unrestricted`。

### 2.4 无管理员权限的安装 / PATH 方法

**方式 A（推荐，持久）：官方安装到"当前用户"**

```powershell
# 用 winget（不需要管理员；--scope user 表示当前用户）
winget install --id Git.Git     -e --scope user
winget install --id GitHub.cli  -e --scope user
winget search python            # 例：Python.Python.3.12（本机已装 3.12.10，无需再装）

# 不想用 winget 时：
#   Git for Windows: https://git-scm.com/download/win  → 安装器选 “Only install for me”
#   GitHub CLI:      https://github.com/cli/cli/releases → 用 gh_*_windows_amd64.zip 便携版
```

- Git for Windows 安装时**保持勾选 "Git from the command line and also from 3rd-party software"**（否则 `git` 不进 PATH）。
- 官方安装器通常会把目录写进 User PATH（Git for Windows 的 `…\Git\cmd`，GitHub CLI 的 `…\GitHub CLI`）；**装完后新开一个终端**，用 `where git` / `where gh` 确认能看到。
- ⏳ winget 的 id 与 `--scope user` 行为未在本机逐一验证（当前没有网络/提权）；若 winget 拒绝，用上面两个官方下载，安装时选"仅为我/当前用户"。

**方式 B（可选）：便携版 git/gh（比如官方的 zip 版）**

如果不想安装，可以把 Git for Windows 的 PortableGit 或 GitHub CLI 的 `gh_*_windows_amd64.zip` 解压到任意目录，然后把各自的 `cmd` / `bin` 目录加进 User PATH（见下）。**不要**把它们放进 `%LOCALAPPDATA%\Programs\Superagent\tools\`，除非你在做自包含安装（那个目录是安装根目录的一部分，升级时会被整体替换）。

**把目录加进"当前用户"PATH（方式 A/B 都可能需要）**

```powershell
# 先看当前用户 PATH
[Environment]::GetEnvironmentVariable('Path','User')

# 追加（示例：git 的 cmd 目录；gh 同理换成它自己的目录）
$dirs = @(
  "$env:LOCALAPPDATA\Programs\Git\cmd",
  "$env:LOCALAPPDATA\Programs\GitHub CLI"
)
$old = [Environment]::GetEnvironmentVariable('Path','User')
$add = ($dirs | Where-Object { $old -notlike "*$_*" }) -join ';'
if ($add) { [Environment]::SetEnvironmentVariable('Path', ($old.TrimEnd(';') + ';' + $add), 'User') }
```

- 只对**之后新启动**的进程生效；已经开着的 Explorer / 应用看不到，**重新登录一次**（或重启 `explorer.exe`）再双击应用。
- **不要用 `setx`**（超过 1024 字符会截断，且容易把 PATH 写坏）。
- 加完用**新开的**终端验证：`where git`、`where gh` 都应先出现你自己的安装目录。

### 2.5 为什么需要 Python

Windows 的服务管理器不是原生 exe，而是：

```
scripts\dsh-superagent.cmd   ← 找 Python 3
scripts\dsh-superagent       ← Python 实现（上游同一个文件，Windows 分支）
```

`.cmd` 的查找顺序（已读源码）：`DSH_SUPERAGENT_PYTHON` 环境变量 → `py -3` → `python.exe` / `python3.exe`。本机这三种都有（Python 3.12.10 + `py` 启动器），所以**不需要额外设置**。若以后换机器，报 `dsh-superagent needs Python 3.8 or later on PATH` 时按提示设置 `DSH_SUPERAGENT_PYTHON` 即可。

### 2.6 不需要 tmux

上游 `scripts/dsh-superagent start` 依赖 tmux；Windows 上没有也不会有。移植版保留同一个 Python 脚本和同一套 CLI/退出码，Windows 分支改为：

- `start`：用 `CREATE_NO_WINDOW` 在**隐藏的独立控制台**里启动后端，把 PID 写进 `.artifacts\control\profiles\<profile>\service.pid`，并用 `node --import scripts\dsh-service-hook.mjs` 预加载停止钩子；
- `stop`：通过命名管道发送 `stop`，钩子把它转成 DSH 本来就在处理的 **SIGINT**（收尾 Sessions 后退出），**从不强杀**；
- `status`：读 PID + 管理 API 健康状态。

---

## 3. 一次性装配：插件与 DSH CLI

> 原来的第三条装配路径是桌面外壳（§3.6），已随 `windows-app/` 于 2026-11-07 移除。

> 本机这些步骤**大部分已经由移植过程完成**（见每步的状态）。下面给出完整命令，供你核对、重装或迁移到另一台机器时使用。
> 所有命令都在**普通（非管理员）PowerShell 窗口**里、以 `<checkout>` 为当前目录执行。

### 3.1 先建立变量（每个窗口执行一次）

```powershell
Set-Location <checkout>
$npm  = 'C:\Program Files\nodejs\npm.cmd'
$pnpm = (Get-Command pnpm.cmd).Source   # 例：%APPDATA%\npm\pnpm.cmd
$dsh  = "$env:APPDATA\npm\dsh.cmd"      # npm -g 安装后出现
```

### 3.2 装依赖并构建插件（✅ 已完成，`lib\` 存在）

```powershell
& $pnpm install
& $pnpm build
Test-Path .\lib        # True
```

- 说明：插件是 TypeScript，`dsh` 加载的是构建产物 `lib\`，所以 `build` 不能跳过。`test`/`typecheck` 可选（`& $pnpm check` 全跑）。
- **不要**去修什么 `npm.ps1` 报错，用上面的 `npm.cmd`/`pnpm.cmd` 路径即可。
- pnpm 版本注意：项目 `packageManager` 写的是 `11.7.0`，本机是 `10.34.9`。当前 lockfile 可以被 10.x 读取，安装已经成功；只有在出现 lockfile/引擎不匹配报错时，才升级：
  ```powershell
  & $npm install -g pnpm@11.7.0
  ```
- 🔧 若构建时原生依赖（rolldown/lightningcss 等）下载失败，重跑一次 `& $pnpm install`；仍失败时再考虑换 Node LTS（22/24），当前 Node 26 满足 engines。

### 3.3 全局安装 DSH CLI（✅ 已安装 `0.2.1-rc.3`）

```powershell
& $npm install -g '@deepseek-ai/dsh@0.2.1-rc.3'
& $dsh --version           # 0.2.1-rc.3
```

- 版本必须满足 `package.json` 的 `engines.dsh`（`^0.2.1-alpha.2`）；本次固定用 `0.2.1-rc.3`。
- 安装后 `%APPDATA%\npm\` 下会出现 `dsh`、`dsh.cmd`、`dsh.ps1`。**请始终调用 `dsh.cmd`**（原因见 2.3）。

### 3.4 创建 profile（⚠️ 本机已存在，**绝对不要重跑**）

```powershell
# 仅当 "$env:USERPROFILE\.dsh\profiles\superagent" 不存在时才执行：
& $dsh superagent --from-default-profile web --dump-config > $null
```

- 上游是 `> /dev/null`；PowerShell 的等价写法是 `> $null`（或 `| Out-Null`）。
- 第一个位置参数是 **profile 名**（`superagent`）；`--from-default-profile web` 表示"从 DSH 的 Web 模板复制一份"；`--dump-config` 只打印配置、不启动。
- **重跑会重建整个 profile，并删掉手写的 `cordis.patch.yml`（包括端口、stateDir、模型配置）。** 升级永远不要用它。
- 判断能否执行：
  ```powershell
  Test-Path "$env:USERPROFILE\.dsh\profiles\superagent\cordis.patch.yml"   # True = 已存在，跳过本步
  ```

### 3.5 把插件 link 进 profile（✅ 已完成）

```powershell
& $dsh plugin --profile superagent add "link:D:/src/dsh-superagent"   # 换成你的 <checkout>，用正斜杠
```

- 用**正斜杠**写路径：这个值最终会进 JSON 依赖，反斜杠需要转义，容易出错。
- 完成后 `%USERPROFILE%\.dsh\profiles\superagent\package.json` 里应出现：
  ```json
  "dependencies": { "dsh-superagent": "link:D:/src/dsh-superagent" },
  "dsh": { "profile": { "bundles": [ "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-superagent" ] } }
  ```
- 以后升级插件：checkout 带着官方历史（`upstream` 指官方原型仓库），按 `WINDOWS-DELTA.md` §5 做 `git fetch upstream` → `git merge upstream/main` → `pnpm install && pnpm build` → 重启（第 8 节）。

### 3.6 构建并安装桌面应用（已移除，历史记录）

> 本节命令所依赖的 `windows-app/` 已于 2026-11-07 删除，**不能再执行**；保留仅为说明当年的构建/安装形态。

源码与布局：`<checkout>\windows-app\`；**布局与路径解析顺序以 `windows-app\INSTALL.md` 为准**。`Superagent\` 构建产物 = 368 MB（Electron 44.7.0 自包含），`Superagent.exe` 246 MB。

**首次构建**（只需要 Node；Electron 是该目录的 devDependency）：

```bat
cd /d <checkout>\windows-app
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
"C:\Program Files\nodejs\npm.cmd" install --allow-scripts=electron
"C:\Program Files\nodejs\node.exe" build-portable.js
:: 产物：<checkout>\windows-app\Superagent\Superagent.exe
```

- 若 npm 不认 `--allow-scripts`，用 README §6 的 `npm.cmd install --no-audit --no-fund`；Electron 下载失败时按 README 手动解压缓存 zip 并写 `path.txt`。
- **`npm install` 静默不装 Electron 二进制（本机 2026-11-06 撞到）**：它 1 秒就结束了（`added 13 packages`），但 `node_modules\electron\dist\` 根本没有——此时 `build-portable.js` 会产出一个跑不起来的外壳。判据是 `dist\` 目录存在且约 368 MB；补救命令是补跑 `node node_modules\electron\install.js`（同样要先 `set ELECTRON_MIRROR=…`）。
- 重建前先关掉应用（运行中的 `Superagent.exe` 会锁住目录）。只改 `main.js` 时重跑 `build-portable.js` 即可。

**安装（一次性，无需管理员）**：

```powershell
& '<checkout>\windows-app\install.cmd'                              # 默认 %LOCALAPPDATA%\Programs\Superagent
& '<checkout>\windows-app\install.cmd' -Root 'E:\Apps\Superagent'   # 或自选目录
# 以后移动/重装/修复快捷方式：重跑并加 -Force
& '<checkout>\windows-app\install.cmd' -Force
```

✅ **本机已实跑验证**（0.2.1，2026-11-06 自建 → 自装 → 首跑，`install.cmd -Force` 退出码 0）：

- 安装根 `%LOCALAPPDATA%\Programs\Superagent` 存在，**合计 368 MB**——和构建产物同尺寸，因为**安装器不复制 `tools\`，本机也没有 `tools\` 目录**；`resources\` 266 KB（`resources\app\` 里是 `main.js`、`preload.js`、`instances-window.js`、`package.json`、`icon.ico/png`），其余全是 Electron 运行时；
- `config\paths.json` 已写入（**无 BOM**）：`{"checkout": "<checkout>", "installRoot": "%LOCALAPPDATA%\\Programs\\Superagent", "installed": "<ISO 时间>"}`；
- 桌面与开始菜单快捷方式已创建，文件名是 **`DSH-Superagent.lnk`**（不是 `Superagent.lnk`）：Target=`<root>\Superagent.exe`、Arguments=`--no-sandbox --disable-gpu`、WorkingDirectory=`<root>`，逐项读回一致；
- 首跑（`%APPDATA%\Superagent\app.log`，本机第一份）：窗口标题 `DSH-Superagent`；`[ready] backend URL: http://127.0.0.1:<port>/ (10379ms)` 与 `[ui] document.title: DeepSeek Harness`（面板真渲染）；后端 `cwd` 通过 `paths.json` 解析到 `<checkout>`。**注意 `[ready]` 行不带 token**：应用会 `url.replace(/\?.*$/, '')` 主动剥掉 query，`did-finish-load` 也把 token 替换成 `<redacted>`——带 token 的 URL 是后端 stdout 的形状，不会出现在应用日志里；
- preflight **回落到了系统里的工具**：`git: C:\Program Files\Git\cmd (known path)`、`gh: <某人>\gh-cli\bin (where gh)`、`pwsh: C:\Program Files\PowerShell\7 (where pwsh)`。`bundled tools` 分支只有在你自己把 git/gh 放进 `<root>\tools\` 之后才会走到；旧文档里"从安装自身解析（bundled tools）"是**那台手工塞过 `tools\` 的机器**的记录，不是默认安装的结果。

安装器做的事（INSTALL.md §1/§2）：

- 把 `windows-app\Superagent\*` 复制到安装根目录：`Superagent.exe` + `resources\app\` + Electron 运行时；
- 创建 `config\`（可写、升级保留；`paths.json` 记录插件 checkout）；
- 把 `<checkout>` 记录进 `config\paths.json`（**不复制**插件源码）；
- 创建桌面与开始菜单快捷方式：目标=安装根目录的 `Superagent.exe`，参数 `--no-sandbox --disable-gpu`，工作目录=安装根目录；
- `tools\` 是**可选**的自包含工具目录（安装器不复制、构建也不产出；要自包含得自己把 git/gh 放进去）。`-Force` 覆盖安装只复制应用，**不会删掉已有的 `tools\`**。本机当前**没有** `tools\`，工具全部从系统解析（见上一条实测）。

> ⚠️ `config\paths.json` 必须**无 BOM**。PowerShell 5.1 的 `Set-Content -Encoding UTF8` 会写 BOM，`JSON.parse` 会拒绝它——安装器已改成无 BOM 写入，读取端也会剥掉开头的 BOM 兜底。手工改这个文件时请用无 BOM 的 UTF-8。

安装根目录优先级：`install.cmd -Root "<目录>"` → 环境变量 `SUPERAGENT_HOME` → 默认 `%LOCALAPPDATA%\Programs\Superagent`。

- **运行应用不需要 Node/Electron/npm**（Electron 已打包）；但**后端不在应用里**：仍需机器上装好 Node + 全局 `@deepseek-ai/dsh`。
- **必须带** `--no-sandbox --disable-gpu`：本机 Chromium 不加会在任何 JS 之前崩溃（Electron 33/44 都如此）。代价是 renderer 不沙箱——对一个只连本机回环面板的桌面壳可接受，干净机器上可重新评估。
- 可整体搬家：安装目录移到任意盘/路径、或复制到另一台有 Node+DSH 的 Windows 都能跑；搬家后跑一次 `install.cmd -Force` 重写 `paths.json` 与快捷方式。
- 应用解析插件 checkout 的顺序：`SUPERAGENT_CWD`/`SUPERAGENT_CHECKOUT` → `<root>\config\paths.json` 记录 → exe 附近按布局找（用 `package.json` 的 `"name": "dsh-superagent"` 校验）→ `%USERPROFILE%\.dsh\profiles\<profile>` → `%USERPROFILE%`。所以"移动后打不开"通常只需重跑安装器。
- 卸载：关应用 → 删除安装根目录 → 删除 `%USERPROFILE%\Desktop\DSH-Superagent.lnk` 与 `%APPDATA%\Microsoft\Windows\Start Menu\Programs\DSH-Superagent\`（整个子目录）；注册表无条目。
- 发布前审计（INSTALL.md §4）：源码里不应有 `D:\...`、`C:\Users\<某人>\...` 这类绝对路径。
- 验收结果见 12.1。

### 3.7 装配完成检查单

```powershell
$checkout = 'C:\src\dsh-superagent'                  # ← 换成你的 <checkout>
$root     = "$env:LOCALAPPDATA\Programs\Superagent"  # ← 或你 -Root 指定的安装根目录

Test-Path "$checkout\lib\index.js"                                 # True
& "$env:APPDATA\npm\dsh.cmd" --version                             # 0.2.1-rc.3
Test-Path "$env:USERPROFILE\.dsh\profiles\superagent\cordis.patch.yml"            # True
Select-String -Path "$env:USERPROFILE\.dsh\profiles\superagent\package.json" -Pattern 'dsh-superagent'  # link: 存在
Test-Path "$checkout\windows-app\Superagent\Superagent.exe"        # True（构建后）
Test-Path "$root\Superagent.exe"                                   # True（安装后）
Test-Path "$root\config\paths.json"                                # True（记录 checkout；无 BOM）
Test-Path "$root\tools\git\cmd\git.exe"                            # True（若放了自包含 git）
Test-Path "$root\tools\gh\bin\gh.exe"                              # True（若放了自包含 gh）
Test-Path (Join-Path $env:USERPROFILE 'Desktop\DSH-Superagent.lnk')  # True（安装器创建的快捷方式）
(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $env:USERPROFILE 'Desktop\DSH-Superagent.lnk')).TargetPath  # <root>\Superagent.exe
Test-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\DSH-Superagent\DSH-Superagent.lnk"  # True（开始菜单那一份）
Test-Path "$env:USERPROFILE\.dsh\.credentials.yaml"                # True（模型凭据）
git --version                                                      # 2.32 以上，且后端进程能看到
gh --version                                                       # 2.48 以上（或用应用横幅/SUPERAGENT_GH_DIR 指向 gh.exe）
```

---

### 3.8 把插件装进官方 DeepSeek Harness 应用（不需要第二个程序）

> 2026-11-06 本机实跑通。这是"日常用"的第三条路，也是最省事的一条：**不装外壳、不管端口、不需要开机启动**。

**为什么可以**（三条都是磁盘与进程事实）：

| 依据 | 实测 |
| --- | --- |
| 官方应用加载的就是本机一个普通 profile | 它的后端进程命令行：`…\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\index.js  …\app.asar\dsh  <you>\.dsh\profiles\desktop`——第三个参数就是 profile 目录 |
| 那个 profile 本来就接受第三方插件 | `profiles\desktop\package.json` 的 `dsh.profile.bundles` 里已有一条 `@copylee/dsh-computer-use`，插件页「已安装插件」把它和 DSH-Superagent 并列显示 |
| 兼容性闸门会放行 | 应用自带运行时是 `@deepseek-ai/dsh-* 0.2.1-rc.5`（从 `app.asar` 里读出的 manifest）。加载规则写明**插件自己声明了 `engines.dsh` 就只看这一条，peerDependencies 不参与，预发布版本参与范围**；本插件声明 `^0.2.1-alpha.2`，实算 `satisfies('0.2.1-rc.5', …) = true`。不满足时不是崩，而是 `skipping profile bundle <名字>: <原因>` |

**怎么做**（只能走应用里的入口）：

1. DeepSeek Harness → 左侧「插件」→ 右上「+ 添加插件」→ 在「包名或地址」框里填：
   ```
   https://github.com/ReSerendipity/dsh-superagent
   ```
   不带 `#` 时装 `main` 当前最新提交；团队统一版本、复现问题或 CI 要固定构建时，在末尾加 `#<40 位 commit>`，代价是升级要手动换 sha。这个框接受 **npm 包名 / GitHub 仓库地址 / 本地目录路径**三种。填本地目录会被写成 `link:<目录>`，profile 从此依赖那个目录一直存在；要自包含副本就用仓库地址。「安装源」下拉对 git 地址无效（代码与文案都写明 GitHub 地址和 `.tgz` 直链不经过安装源）。**当前版本三条路都能直接跑**：`lib` 已经把 `zod` 与 `proper-lockfile` 打进产物，`link:` 那种「不给被链目录装依赖」的行为不再影响能否启动。

   **不想每次拉 git 的话**：`pnpm pack:plugin` 产出 `dist\dsh-superagent-<version>.tgz`，用命令行 `dsh plugin --profile <name> add "file:<abs>.tgz"` 装（本机验证过落盘形态与启动）。**插件页那个框不收 `.tgz` 路径**——要在应用里用 tarball，先把它解包到一个目录，再把**目录路径**填进框（记成 `link:`，当前版本产物自带依赖所以能跑）。
2. 点「安装」。本机装完后的落盘形态（逐项核对过）：`dependencies` 多一条 `dsh-superagent`（不带 `#` 装时记的是不带 ref 的地址，`pnpm-lock.yaml` 记解析出的 sha；钉 sha 装时两处都带 `#<sha>`）；`dsh.profile.bundles` 末尾追加 `dsh-superagent`；`node_modules\dsh-superagent\` 是 `LICENSE/README.md/cordis.patch.yml/lib/locale/package.json/prompts/skills` 的自包含副本；profile 的 `node_modules` 里**没有** `@deepseek-ai\`——对等依赖由应用自带运行时提供。当前版本也**不再有** `proper-lockfile`/`zod`：它们被打进 `lib`，插件的安装期依赖为空（`tests/release-invariants.spec.ts` 锁住这一点）。
3. **重启应用**，补丁层与 bundle 只在启动时读。注意走菜单「应用 → 退出」再打开：**关窗口不算**，这应用会缩进托盘。
4. 0.1.5 起 `profiles\desktop\cordis.patch.yml` **可以不写 `stateDir`**：缺省时插件按 profile 派生 `<DSH home>/state/desktop-superagent`，新装即用。要沿用旧数据目录（例如迁移自 `state/superagent`）就显式覆盖；本地收件模式仍需启用 inbox Source：
   ```yaml
   - id: dsh-superagent
     config:
       stateDir: <you>/.dsh/state/superagent   # 可选：覆盖派生默认
   - id: dsh-superagent-inbox
     disabled: false
   ```
   再重启一次。0.1.4 及更早没有派生默认：缺 `stateDir` 时主页件**静默**异常（该 entry 非必需，启动审计只警告，而桌面端 host 的 stderr 被 Electron 吞进缓冲），所以"装上了但主页件异常、github-watch 等待依赖"基本就是这一条。

**两个已经撞过的坑**：

- 命令行装不进去：`dsh plugin --profile desktop add …` 报 `profile "desktop" is managed exclusively by the Electron application`。插件页是唯一入口。
- 用电脑控制驱动这个对话框时，「安装」按钮所在的下半屏若被别的窗口（任务管理器之类 topmost）盖住，点击会被判定"落在目标窗口外或被遮挡"而拒绝，而截图仍能显示按钮——因为采集支持遮挡窗口。此时要么把遮挡窗口移开，要么由人点这一下。另外这个输入框是受控组件，`SetValue` 类接口写进去的值不会被应用采纳，得走真实键入。

**选这条路之前要知道的代价**：

- GitHub 轮询由日常应用发起：应用开着它就轮，退出就停。§8.6 的值守脚本管的是 CLI 路径那份后端，**不会替你打开应用**——所以"插件为什么要开机启动"这个问题在这条路上不存在。
- 外壳的诊断面随外壳一起没有：preflight 横幅、`%APPDATA%\Superagent\app.log`、后端挂掉时的「重新启动后端」失败页、`--instance` 多实例。
- 应用升级（本机 `0.2.1-rc.5`）后插件兼容性要重新核一次；钉在某个 commit 的 git 安装不会跟着升级，要手动「卸载 → 重装」。
- 与 `superagent` profile **共用** `stateDir` 时，工单、收件目录与策略会互相带过去（本机就是靠这一点继承了 22 小时前的待验收工单，并且应用侧后端启动时重写了 `worker-bin\gh.cmd`）。不想共享就换一个目录，代价是历史与策略从零开始。

**回滚**：还原 `profiles\desktop\` 的 `package.json` 与 `cordis.patch.yml`（安装器自己会留 `_backup_before_computeruse_*` 那种目录，本机的在 `_backup_before_superagent_<时间戳>\`），删除 `node_modules\dsh-superagent`，重启应用；或者直接在插件页点「卸载」。

## 4. 机器配置：profile 的 cordis.patch.yml

### 4.1 文件与内容

路径：`%USERPROFILE%\.dsh\profiles\superagent\cordis.patch.yml`。这是 profile 的"补丁层"，在 bundle 默认配置之后生效。内容如下（把 `<you>` 换成你的用户名，其余逐字）：

```yaml
# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; `!!js` expressions allowed).
#
# dsh-superagent on Windows (native port). See docs/006-deployment.md upstream;
# WINDOWS-SETUP.md in the checkout records the Windows-specific deviations.

# The panel listens here (upstream example uses 3082).
- id: webserver
  config:
    host: 127.0.0.1
    port: 3082

# Machine configuration for the bundle. `stateDir` must be an ABSOLUTE path and
# cannot be changed from the panel later; forward slashes are fine on Windows.
- id: dsh-superagent
  config:
    stateDir: <you>/.dsh/state/superagent

# The bundle inserts no model of its own: it uses the profile's default model for
# Evals and for Executor Sessions. Mirror the desktop profile's provider so the
# credentials already stored in ~/.dsh/.credentials.yaml (refs: OPENCODE_GO_API_KEY)
# are reused instead of requiring a second sign-in.
- id: agent-default-model
  config:
    provider: opencode-go
    model: deepseek-v4.1-flash
    reasoningEffort: max

- id: llm-pi-ai
  config:
    providers:
      opencode-go:
        apiKeyEnv: OPENCODE_GO_API_KEY

# dsh-superagent's worker and router presets run with danger-full-access (see
# docs/006-deployment.md "Permissions and isolation"). Restate the presets so the
# default is explicit in this profile; approval prompts are never issued.
- id: permission
  config:
    presets:
      read-only:
        sandbox: read-only
        approval: ask
      workspace-write:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: never
    defaultPreset: danger-full-access
```

### 4.2 每条配置的含义

| 条目 | 键 | 本机值 | 含义 / 能不能在面板改 |
| --- | --- | --- | --- |
| `webserver` | `host` | `127.0.0.1` | 只监听本机回环，外网访问不到 |
| `webserver` | `port` | `3082` | **CLI 路径**的面板端口。桌面应用会用自己的 overlay 改成随机端口（见 4.5）；改这里后要同步 `--url` / `DSH_SUPERAGENT_URL` |
| `dsh-superagent` | `stateDir` | `<you>/.dsh/state/superagent` | **必须是绝对路径**。存数据库、锁、`worker-bin` 命令 shim、agent 的 git 配置，默认还存工单目录 `work` |
| | `promptMaxChars` | （未写，默认 100000） | 保存的 prompt 配置上限 |
| | `admissionContextMaxPages` | （未写，默认 10） | 一次研判最多读几页 Thread 上下文 |
| | `admissionContextTimeoutMs` | （未写，默认 15000） | 单次上下文读取超时 |
| `agent-default-model` | `provider` / `model` | `opencode-go` / `deepseek-v4.1-flash` | profile 的默认模型；Eval 和 Executor 没单独指定时用它 |
| `agent-default-model` | `reasoningEffort` | `max` | 推理强度。桌面 profile 是 `high`，这里是 `max`（唯一差异，可按需改成一致） |
| `llm-pi-ai` | `providers.opencode-go.apiKeyEnv` | `OPENCODE_GO_API_KEY` | 从凭据库该 ref 取 key，不再要求第二次登录 |
| `permission` | `presets` / `defaultPreset` | `danger-full-access`（`approval: never`） | 与 `docs/006-deployment.md` 的 Permissions and isolation 一致；审批提示永不弹出 |

### 4.3 必须遵守的规则

1. **`stateDir` 用绝对路径**。移植版放宽了校验：`C:/...` 和 `D:\...` 都接受（上游只接受 `/` 开头的 POSIX 路径，Windows 上会报
   `$.stateDir expect string to match regexp /^\//`）。
   ⚠️ 若你看到这个正则报错，说明跑的是**修复前的构建**：重新 `pnpm build` 并重启。
2. **`stateDir` 不能在面板里改**（面板只读显示）。要换位置只能改这个文件，并且先把旧目录里的 `orchestrator.sqlite` 备份/迁移。
3. **未知键会让插件拒绝启动**，日志会点名是哪个键；已废弃的键会提示它搬到了哪里（例如作者、仓库路径现在都在面板/准备命令里）。
4. **不要手改 `stateDir` 下的 `worker-bin\*` 和 `worker-gitconfig`**：每次启动都会重写；里面出现"不是 dsh-superagent 写的"文件会让 setup 直接失败（`… was not written by dsh-superagent`）。
5. **升级前备份** `stateDir\orchestrator.sqlite`。
6. `cordis.patch.yml` 是 YAML 数组，**不要**把它改成空数组 `[]`——那会丢掉全部机器配置。

### 4.4 改完怎么生效

- 改 `webserver.port`、`stateDir`、模型、权限 → **重启后端**（应用内 `Ctrl+Shift+R`，或 CLI `restart`）。
- 改提示词体积、上下文页数等"机器上限" → 面板 **Settings → Deployment** 里改即可，**不用重启**（但 `stateDir` 除外）。

### 4.5 桌面应用如何覆盖端口（外壳已移除，历史记录）

> 下面的 overlay 写入逻辑在外壳的 `main.js` 里，已随 `windows-app/` 删除。当前用 CLI/官方应用时，端口直接由 profile 的 `webserver.port` 决定。

桌面应用**不使用** 3082。它每次启动前在自己的 userData 目录写一份 overlay：

```yaml
# <userData>\runtime.patch.yml（自动生成，别手改）
- id: webserver
  config:
    host: 127.0.0.1
    port: 0
```

然后按下面的顺序启动后端（✅ 实测）：

```
node …\@deepseek-ai\dsh\lib\bin.js --profile superagent --patch "<userData>\runtime.patch.yml" --no-open
```

三条已经验证过的坑：

1. **profile 里的选项赢过 CLI 的应用参数**：`cordis.patch.yml` 里写了 `webserver.port: 3082`，所以只加 `--port 0` **不会**改端口，结果仍是 `EADDRINUSE: 3082`。要换端口只能改 patch 文件，或像应用这样再加一层 `--patch` overlay。
2. **`--patch` 是"启动器参数"，必须放在应用自己的参数之前**：
   `--profile superagent --patch <file.yml> --no-open` ✅；
   `--no-open --patch <file.yml>` ❌ 会报 `unknown option '--patch'`。
3. **一个 `stateDir` 同时只能有一个后端**：第二个实例会以 `Lock file is already being held` 失败。这通常意味着应用/CLI 已经有一个在跑，不是配置错误。

---

## 5. 模型 provider

### 5.1 复用桌面 profile 的 provider（本机已配好）

superagent profile 不引入自己的模型来源；它用 profile 的默认模型。本机沿用桌面 profile 的同一套：

- provider：`opencode-go`，模型：`deepseek-v4.1-flash`
- key 来源：`%USERPROFILE%\.dsh\.credentials.yaml` 的 `refs:` → `OPENCODE_GO_API_KEY`（已存在，✅）
- 通过 `llm-pi-ai` 的 `providers.opencode-go.apiKeyEnv: OPENCODE_GO_API_KEY` 读取

这样**不需要给 superagent 再登录一次**。

### 5.2 面板里还能选什么

- **Settings → Eval → 评估模型**：留空 = 用 profile 默认。
- **Settings → Execution → 执行器模型**：留空 = 用 profile 默认。
- 规则（`docs/003-execution.md`）：**Executor 模型在 Session 创建时固化**，改了只影响之后新建的 Session；Eval 模型每次请求都可能读最新配置。

### 5.3 模型不通时怎么排查

| 现象 | 处理 |
| --- | --- |
| 面板/日志出现 provider 鉴权错误 | 检查 `.credentials.yaml` 里 `OPENCODE_GO_API_KEY` 这个 ref 是否还在；确认后端用的 `DSH_HOME` 是 `%USERPROFILE%\.dsh`（本机默认，未改的话无需设置） |
| 只有某些工单卡住 | 看 **Eval 页**的记录与 `models` 健康项；Session 已创建时改模型不生效，需要重试/重启该工单 |
| 想把 superagent 单独换模型 | 改 `cordis.patch.yml` 的 `agent-default-model`（或在面板 Eval/Execution 指定），重启后端 |

---

## 6. GitHub 账户与仓库配置（Mode A 要一个，Mode B 要两个）

### 6.0 先选路线：Mode A 单人 / Mode B 团队

上游只允许通过 GitHub / 飞书的**通知**接单，而 GitHub Source 会**丢弃智能体账号自己产生的所有事件**（`src/sources/github.ts` 的 `sameName` 过滤；另外 owner 在自己仓库评论自己根本不产生通知）。所以"同一个账号既派单又执行"在这条链路上永远不会触发。

这是上游的设计铁律，不是移植引入的 bug，本仓库**不修改它**。分叉点在别处：

| | **Mode A：单人单账号** | **Mode B：团队双账号（上游语义）** |
| --- | --- | --- |
| 派单方式 | 往本地收件目录丢一个 `.md` 文件 | 用**另一个** GitHub 账号在仓库里 @ 智能体 |
| 需要**第二个** GitHub 账号 | **不需要** | 需要（专用智能体账号 + 仓库 Write） |
| 需要配置 GitHub 来源（仓库名 + CLI + 登录） | **仍然需要**（见下方"为什么 Mode A 也离不开它"） | 需要 |
| 交付回到哪 | `done/<文件>.reply.md` 追加一段回信 | 原 Issue/PR 对话里的评论 + PR |
| 适合谁 | 一个人、一台机器、自己给自己派活 | 多人协作、需要"别人提需求、agent 干活" |
| 其余机制 | Eval / Mandate / Ticket / worktree 执行 / 并发槽位——两边完全同一套上游代码 | 同左 |

**为什么 Mode A 也离不开 GitHub 配置**（2026-11-05 干净安装实测，非推断）：把 `dsh-superagent-github` 在 profile 里设成 `disabled: true`，健康表确实从 10 项掉到 9 项、`github` 项消失，**但 setup 仍报 `github / repositoryUnset`，编排照不解锁**。代码可证：`src/app/setup.ts:83` 无条件调用 `resolveDeployment(...)`，`:111` 是 `ids.length ? ids : ['github']`，整个文件不读来源开关；而 `writeEnvironment()` 要用 `gh.exe` 的绝对路径写凭据助手，worker 的 git 配置才有 github.com 的凭据。另外 M2 的写链路本来就依赖它：提交要推分支、交付要开 PR。

- **走 Mode A**：本节 **6.2（注册第二个账号）跳过**，但 **6.3 / 6.4 / 6.6 / 6.7 照做**——用**你自己的**账号登录 `gh`、在面板里填仓库与 CLI 即可。然后看 §7.2 的 inbox 来源与 §9.2 的 Mode A 派单。
- **走 Mode B**：照本节做完，再按需叠加 Mode A（两个来源可以同时开）。
- 铁律保留为**选择**而不是**前提**：Mode A 不要求你注册**第二个**账号；它仍然要求一个已登录、对目标仓库有写权限的 GitHub 账号。要彻底不配 GitHub 的纯本地交付（只留本地分支、或把 diff 写进回信）是另一个产品决策，尚未实现。

### 6.0.1 第三种形态：完全不配 GitHub（`mode: local`）

不想填仓库、不想登 `gh`、也不想让这个插件碰任何 GitHub 的东西——把部署模式显式设成 `local` 即可。默认值是 `github`，所以这个形态**不会**出现在你没选它的地方。

```yaml
- id: dsh-superagent
  config:
    stateDir: <you>/.dsh/state/superagent
    mode: local          # github（默认）| local
- id: dsh-superagent-github
  disabled: true         # 没有仓库可轮询，GitHub 来源必须关掉
- id: dsh-superagent-inbox
  disabled: false        # 唯一的入口
```

`local` 下发生什么：

| 项 | 行为 |
| --- | --- |
| setup | 不再要求仓库与账号：不探测 `gh`、不解析部署，`setup.problem` 直接为 `null` |
| 工作区 git 配置 | 照写，但**去掉** github.com 的凭据助手、SSH 改写与 `gh` 垫片；凭据校验也跳过 |
| 提交身份 | 仓库级占位身份 `dsh-superagent <superagent@localhost>`（worker 带 `user.useConfigOnly`，没有身份就提交不了）；因为不推送，它永远不会到 GitHub |
| 交付 | `DSH_SUPERAGENT_DELIVERY=local`：worker 只提交到 `agent/<工单短名>`，**不 push、不开 PR**，在回信里给分支名、改动文件与 diff 摘要，由你自己合并 |
| 代码来源 | `prepare` 为空时（干净安装的默认），Executor 自动建**内置本地工作区**：`git init -b main` + 空基座提交 + `agent/<工单短名>` 分支，无远端。产出是自包含仓库；要对着**自己的代码**改，把 `prepare` 指向你的**本地**仓库（worktree 配方），不需要任何远端。默认 `github` 部署不受影响（`docs/026`） |

首次使用会撞到两个静默门槛，**都实测过**：

1. **`dsh plugin add` 建出来的 profile 缺 `@deepseek-ai/dsh-web-app`。** 缺了它 `webServer / sessionController / workspaceRegistry` 三个服务不存在，插件永远停在 `pending`、端口不监听。把它加进 profile `package.json` 的 `dsh.profile.bundles`（或用会带上它的 `--from-default-profile` 建 profile）。
2. **新 profile 的准入名单是空的。** 往收件目录丢的文件会被判 `ignore / not_a_member`，**文件照常归档、但不写任何回信**，看起来像丢单。先写入白名单：

```powershell
# 面板：Sources → Policy → 能发起工作的发送者 → 加一行 local
# 或直接调 API（把 <port> 换成实际端口）
$h = @{ 'x-orchestrator-request' = '1'; 'Content-Type' = 'application/json' }
$s = Invoke-RestMethod "http://127.0.0.1:<port>/orchestrator/api/settings" -Headers $h
$val = $s.blocks.policy.value
$val.sources.inbox = @{ allowed = @(@{ id = 'local'; name = '本机' }) }
Invoke-RestMethod "http://127.0.0.1:<port>/orchestrator/api/settings/policy" -Headers $h -Method Put `
  -Body (@{ value = $val; revision = $s.blocks.policy.revision } | ConvertTo-Json -Depth 20)
```

> ⚠️ `DSH_SUPERAGENT_DELIVERY`、`DSH_SUPERAGENT_DIR` 这类变量**只注入 `prepare` 进程和 worker 的提示词**（`runtime/environment` 段），**不进** worker 执行 shell 命令时的环境。写工单验收判据时不要要求 worker `echo` 它们——取不到值是设计如此，不是故障。

### 6.1 为什么 Mode B 必须是独立账户

- 智能体的评论、分支、PR **全部以这个账户的名义**出现；用你自己的账户等于让"你"24 小时自动发言。
- 通知驱动：它读的是**这个账户的 GitHub 通知**，所以 GitHub App 不能代替它（`docs/006-deployment.md`）。
- 一份只属于它的 `gh` 登录（独立 `GH_CONFIG_DIR`），确保它不会用你的身份推代码。
- 这也正是 Mode A 存在的原因：单人场景下你不想为"给自己派活"再注册一个账号。

### 6.2 创建账户并授权仓库

1. 用**浏览器无痕窗口**（或先退出你的账户）打开 <https://github.com/signup>，注册一个专用账户，例如 `acme-agent`。建议开 2FA。
2. 把它加成目标仓库的协作者，**Write** 权限：
   仓库 → **Settings → Collaborators → Add people** → 输入账户名 → 选择 **Write**。
3. 用智能体账户登录 GitHub，**接受邀请**（邮件或 <https://github.com/notifications>）。
   如果是组织仓库，可能还需要组织允许该账户被邀请，或把它加进有写权限的 Team。
4. 记下它的 **login**（面板 Policy 里要填）和数字 **id**（提交身份会用到）。用浏览器打开 `https://github.com/<agent-login>` 的 API 地址即可，或在你已登录自己账户的 `gh` 里查：

```powershell
gh api users/<agent-login> --jq '{login: .login, id: .id}'
```

### 6.3 准备 `gh` 可执行文件

`gh` **不一定在 PATH 上**。装好 GitHub CLI 后，用 `where gh` 查到真实路径，这就是面板要填的值（示例：`C:\path\to\gh.exe`；官方按用户安装时通常是 `%LOCALAPPDATA%\Programs\GitHub CLI\gh.exe` 或 `%LOCALAPPDATA%\GitHubCLI\gh.exe`，以 `where gh` 为准）。

- **运行期不依赖 PATH**：面板里填的是这个 `.exe` 的绝对路径（6.7），插件只按这个路径调用它。
- **建议同时加入当前用户 PATH**（2.4）：方便你手动登录/自查，也让桌面应用的自动探测能找到它（应用也可以用它自带的 `tools\gh\bin`，或用 `SUPERAGENT_GH_DIR` 指定）。

### 6.4 两种受支持的账号模型（推荐 (a)）

面板"智能体的 GitHub CLI"支持两种写法，二选一即可：

**(a) 推荐：CLI = 真实 `gh.exe` 的绝对路径，账号由插件的 `GH_CONFIG_DIR` 选中（配置最少）。**
插件在两处注入 `GH_CONFIG_DIR=<stateDir>\gh-config`：

- `src/infra/environment.ts` 的 `agentVariables()`：给 worker 环境（以及插件进程）注入 `GH_CONFIG_DIR=<stateDir>\gh-config`；
- `src/deployment.ts` 的 `workerProbe()`：账号检查也显式传同一个 `GH_CONFIG_DIR`（因为检查发生在 `applyEnvironment()` 之前）。

本机 `stateDir` = `<you>/.dsh/state/superagent`，所以：

```
智能体的 gh 配置目录 = %USERPROFILE%\.dsh\state\superagent\gh-config
```

**(b) 兼容：CLI = 你自己的 `gh-agent.cmd` 包装器（上游文档的模型）。**
包装器设置 `GH_CONFIG_DIR` 后调用真实 `gh.exe`。Windows 上 Node 不能直接 spawn `.cmd`（CVE-2024-27980 之后抛 `EINVAL`），但移植版 `runAsWorker()` 会检测 `.cmd`/`.bat` 并改用
`cmd.exe /d /c <程序> <参数…>`，且**程序与参数作为分开的 argv 传入**（把整行拼成一个字符串会让 cmd 二次解析引号，目标程序收到的是 `\"…\"` 而不是 `"…"`）。所以包装器作为面板 CLI 完全可用。

两种模型都**不需要 `gh` 在 PATH 上**；写绝对路径（或 `.cmd` 的绝对路径）即可，不要依赖裸命令名。

> `gh-config` 目录**由插件拥有**（`<stateDir>` 下、启动时创建），当前版本叫 `gh-config`；应用本身从不设置 `GH_CONFIG_DIR`。
> 如果未来插件换了目录名，以 `<stateDir>` 下实际存在的那一个为准；第一次登录前没有它时，手动建一下或先启动一次后端即可。

结果：setup 检查和每个 worker Session 读的都是**智能体**的 gh 配置，**你自己的 `gh` 登录不受影响、也不会被智能体使用**。

### 6.5 创建包装器 `gh-agent.cmd`（模型 (b) 的 CLI；也可只用于登录/自查）

包装器有两个用途：走**模型 (b)** 时它就是面板里的 CLI；走**模型 (a)** 时它只是给你登录/自查用的便利工具。在 `%USERPROFILE%\bin` 下创建：

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\bin" | Out-Null
notepad "$env:USERPROFILE\bin\gh-agent.cmd"
```

粘贴以下内容（**CRLF 换行**，Notepad 默认就是）。**注意 `GH_CONFIG_DIR` 那一行要与本机 `stateDir` 对应**：

```bat
@echo off
setlocal
rem dsh-superagent: sign in / verify the GitHub agent account.
rem May be used as the configured CLI (model b) or just for manual sign-in (model a).
rem The plugin itself selects the agent account through GH_CONFIG_DIR.
rem gh.exe is called by ABSOLUTE path so a `gh` shim on PATH is never involved.
set "GH_CONFIG_DIR=%USERPROFILE%\.dsh\state\superagent\gh-config"
"C:\path\to\gh.exe" %*
exit /b %ERRORLEVEL%
```

| 行 | 作用 |
| --- | --- |
| `setlocal` | 不改动调用者窗口的环境 |
| `set "GH_CONFIG_DIR=…"` | 指向插件给智能体准备的配置目录（token 存在该目录的 `hosts.yml`）。**必须与 `stateDir` 对应**；换 profile/stateDir 时这里也要改 |
| `"…\gh.exe" %*` | 用**绝对路径**调用真正的 gh，参数原样传递。绝对路径确保调用的是你指定的那个 `gh.exe`，不受 PATH 上任何垫片/包装器影响 |
| `exit /b %ERRORLEVEL%` | 原样传递退出码 |

> gh 装在别处（winget/官方 MSI）时，只改调用 `gh.exe` 的那一行；路径带空格也没问题（引号已验证）。
> 走模型 (b) 时，面板里填这个 `.cmd` 的**绝对路径**；走模型 (a) 时不要把它填进面板。

### 6.6 登录智能体账户

两种方式等价，任选。**推荐方式 1**（不依赖包装器，最贴近插件实际机制）。

**方式 1：直接用 gh.exe + 一次性 `GH_CONFIG_DIR`**

```powershell
$agentHome = "$env:USERPROFILE\.dsh\state\superagent\gh-config"
New-Item -ItemType Directory -Force $agentHome | Out-Null

# 只对当前窗口生效；关掉窗口就恢复（不要用 setx！见下）
$env:GH_CONFIG_DIR = $agentHome
& 'C:\path\to\gh.exe' auth login --hostname github.com --git-protocol https --web
& 'C:\path\to\gh.exe' api user --jq .login      # 必须输出智能体账户
Remove-Item Env:GH_CONFIG_DIR                                  # 用完立刻清掉
```

cmd 版本：

```bat
set "GH_CONFIG_DIR=%USERPROFILE%\.dsh\state\superagent\gh-config"
"C:\path\to\gh.exe" auth login --hostname github.com --git-protocol https --web
"C:\path\to\gh.exe" api user --jq .login
```

**方式 2：用 6.5 的包装器**

```powershell
& "$env:USERPROFILE\bin\gh-agent.cmd" auth login --hostname github.com --git-protocol https --web
& "$env:USERPROFILE\bin\gh-agent.cmd" api user --jq .login
```

注意事项：

- 浏览器里**必须登录智能体账户**（用无痕窗口，别用你已登录的个人账户，否则会把智能体账户换成你的）。
- 也可以用 token（不要在任何地方贴 token；用完删除临时文件）：
  ```powershell
  & "$env:USERPROFILE\bin\gh-agent.cmd" auth login --hostname github.com --with-token < "$env:USERPROFILE\agent-token.txt"
  Remove-Item "$env:USERPROFILE\agent-token.txt"
  ```
- **不要**用 `setx GH_CONFIG_DIR …` 把它设成全局环境变量：那会污染你终端里所有 `gh` 命令（它们会指向智能体账号），而且对插件没有必要。
- 验证推送权限（插件保存时会做同样的检查）：
  ```powershell
  $env:GH_CONFIG_DIR = "$env:USERPROFILE\.dsh\state\superagent\gh-config"
  & 'C:\path\to\gh.exe' api repos/<owner>/<name> --jq '.permissions.push'   # true
  Remove-Item Env:GH_CONFIG_DIR
  ```

### 6.7 面板里填什么

| 字段 | 填什么 |
| --- | --- |
| **智能体的 GitHub CLI** | **推荐**：`gh.exe` 的绝对路径（例如 `C:\path\to\gh.exe`）；**兼容**：你自己的 `gh-agent.cmd` 的绝对路径（模型 (b)，见 6.4） |
| **监听的仓库** | `<owner>/<name>` |

- 保存时插件用它去查账号和推送权限，**通过后会自动重启一次后端**（见 7.5）。
- 在"CLI + 仓库"都配好之前，`/orchestrator/api/state` 里的 `setup.problem` 会是 `agentCliUnset` 或 `repositoryUnset`，**这是预期的待配置状态**（不是故障）。
- 如果保存后报 **`The agent GitHub CLI cannot read its account`**：说明 `gh-config` 目录里还没有登录，或登录的是别的目录——回到 6.6 用**同一个路径**重新登录并验证。

### 6.8 安全边界提醒

包装器和 `worker-bin` 只是"默认走对账号"，**不是安全边界**：执行器以你的 Windows 用户身份运行，可以按绝对路径运行任何程序、读你的 home。真要隔离，就给智能体一个独立的 Windows 用户账户，只放它自己的凭据（`docs/006-deployment.md`）。

---

## 7. 面板设置：Sources → Policy → Execution → Prompts

### 7.1 打开面板

- **桌面应用**：双击桌面快捷方式 `Superagent.lnk`，窗口先显示"正在启动 Superagent…"，约 5 秒后就绪并换成面板。**侧栏点 Superagent**。
- **CLI 路径**：日志里会打印 `dsh web: http://127.0.0.1:3082/?token=…`；浏览器打开**带 token 的 URL**（裸 URL 是 401，这是设计如此）。
- 顶部 **Overview** 会列出还缺什么，并链接到对应设置。**setup 没通过之前，轮询和工作都不会开始。**

顺序不能颠倒：**先 Sources（仓库 + 智能体 CLI）→ 再 Policy（谁能发起）→ 再 Execution（目录 + 准备命令）→ 最后 Prompts**。

### 7.2 Sources（来源）

GitHub 卡片里填：

| 字段（面板中文） | 填什么 | 说明 |
| --- | --- | --- |
| **监听的仓库** | `<owner>/<name>` | 只支持 github.com，不支持 GitHub Enterprise Server |
| **智能体的 GitHub CLI** | 推荐 `C:\path\to\gh.exe`（绝对 `.exe`）；兼容你自己的 `gh-agent.cmd` 绝对路径（模型 (b)） | 见 6.4/6.7；保存时校验账号 + 推送权限。`.cmd` 会被移植版通过 `cmd.exe /d /c` 以分开的 argv 参数执行（见 6.4） |
| 接收仓库里的新 Issue / 新 PR / 评论 / 默认分支的 CI | **先全部关闭** | 打开后会收到"没有 @ 智能体"的事件，交给策略的接收表判断；新手先关，减少噪音 |
| 轮询间隔 / 秒（Advanced） | 默认 60 | GitHub 要求更长时以 GitHub 为准 |
| 连续失败几次后报告异常（Advanced） | 默认 3 | 单次网络抖动会在下次轮询自愈 |

保存后如果返回 `restarting: true`，等后端重启完再看（应用会自动重载；CLI 路径用 `status` 等到不再退出 1）。

**Mode A：inbox 卡片（本地收件目录）**

走 Mode A 时，GitHub 卡片可以整张不填（或保持 disabled），改用 inbox 来源：

| 字段 | 填什么 | 说明 |
| --- | --- | --- |
| 收件目录 | 默认 `<stateDir>\inbox` | 相对 `stateDir`，一般不用改；`done\` 是归档区，**归档移动本身就是读取位点**，重启不会重放 |
| 本地发起人 | 你的账号名或任意稳定标识 | 落进来的文件按"白名单者点名"处理，走正常 gate 与 Policy，强度 `explicit` |
| 轮询间隔 / 连续失败阈值 | 与 GitHub 卡片同语义 | 健康项 `inbox` 形如 `0 files, 0 archived, 0 failed` |

- 插件入口是 `dsh-superagent-inbox`，**bundle 里默认 disabled**，需要在本机 profile 的 `cordis.patch.yml` 里启用（见 §4）。
- 派单与收结果的方式见 §9.2；`tests/inbox.spec.ts` 锁住文件翻译、重名与重试、回信幂等、scope 与 Policy 默认值。

### 7.3 Policy（策略：谁可以发起工作）

- **接单模式**：先 `observe`（默认）。它会**记录**主动工作的判断但不执行；观察一段时间再切 `auto`。
- **能发起工作的 GitHub 账号**（On each Source → GitHub）：**至少加一个人**（先加你自己的 login）。
  > ⚠️ **这张表为空时，任何请求都不会变成 Ticket**——这是最常见的"我 @ 了它但没反应"的原因。
- **评论可以成为候选的机器人**：按需加 `dependabot[bot]` 之类；机器人永远不能发起"明确请求"，也不能停止工单。
- 两条默认规则可以改/删；规则改动会影响运行中的评估（Policy 版本变化会通知受影响的 Ticket，但**不会立即撤销**已接受的工单）。

### 7.4 Execution（执行）

| 字段 | 建议值 | 说明 |
| --- | --- | --- |
| **执行目录的根目录** | 留空（= `<stateDir>\work`）或 `D:\work\superagent` | 每张工单在这里建一个以短名命名的目录；**只按目录分开，不是安全边界** |
| **并行工单数** | 默认 `3`（范围 1–16） | 超过就排队；状态接口里的 `load.maxWorkers` 就是它 |
| **禁止调用的命令** | 一般留空（见下） | 只拦"按名字"的调用；`gh`、`git`、`lark-cli` 不能禁；用绝对路径仍能跑，所以不是安全边界。Windows 上智能体与你共用同一个 `gh.exe`，插件用 `GH_CONFIG_DIR` 保证它拿不到你的 GitHub 登录，**因此通常不需要再禁什么**；若你另有一个"用你个人身份登录"的 CLI（例如 `gh-main.cmd`），把它的名字写在这里 |
| **准备命令** | 见下（推荐 `.cmd` 包装器） | 新工单目录建好前，在根目录用 **cmd** 跑一次；10 分钟超时；失败则该工单失败并附输出 |

#### 7.4.1 先准备一个"本地 clone"作为 worktree 基座

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\src" | Out-Null
git clone https://github.com/<owner>/<name>.git "$env:USERPROFILE\src\widgets"

# 关键：clone 的本地配置里不能留凭据（插件会检查，发现就判该工单失败）
git -C "$env:USERPROFILE\src\widgets" config --local --get-regexp '^(credential\.|http\..*extraheader)'
# 上面这条“有输出”就要清掉，例如：
# git -C "$env:USERPROFILE\src\widgets" config --local --unset-all credential.https://github.com.helper

# 若 clone 时 URL 里带过 token，务必改回干净地址：
git -C "$env:USERPROFILE\src\widgets" remote set-url origin https://github.com/<owner>/<name>.git
```

- 智能体工作时用的是**它自己的** git 配置（`<stateDir>\worker-gitconfig` + `gh-config` 凭据），不读你全局的 git 配置；所以个人代理、commit 身份等设置都不会带进去。
- 仓库用 Git LFS 的话，先装 `git-lfs`（工具链的 git 自带；Git for Windows 安装时也会带）。

#### 7.4.2 准备命令（Windows 版，✅ 已实测）

上游是 sh 写法（`$DSH_SUPERAGENT_*` + `&&`）。Windows 上准备命令通过 **`cmd.exe /d /s /c`** 执行，所以要用 `%VAR%` 和 cmd 语法。因为 cmd 没有 `${VAR:-默认值}` 这种"空值取默认"的写法，**推荐写成 `.cmd` 包装器**（下面的脚本会处理 PR head 为空的情况）。

创建 `<you>\bin\prepare-ticket.cmd`（**CRLF 换行**）：

```bat
@echo off
setlocal EnableExtensions
rem dsh-superagent: create this ticket's worktree from the local clone.
rem Runs once, in the execution root, with DSH_SUPERAGENT_* in the environment.
rem Edit GIT / CLONE to match this machine.

set "GIT=git.exe"
set "CLONE=%USERPROFILE%\src\widgets"

set "REF=%DSH_SUPERAGENT_GITHUB_PR_HEAD%"
if "%REF%"=="" set "REF=HEAD"

"%GIT%" -C "%CLONE%" fetch --no-tags "https://github.com/%DSH_SUPERAGENT_GITHUB_REPOSITORY%.git" "%REF%:refs/dsh-superagent/%DSH_SUPERAGENT_TICKET%"
if errorlevel 1 exit /b 1

"%GIT%" -C "%CLONE%" worktree add -b "agent/%DSH_SUPERAGENT_NAME%" "%DSH_SUPERAGENT_DIR%" "refs/dsh-superagent/%DSH_SUPERAGENT_TICKET%"
if errorlevel 1 exit /b 1

exit /b 0
```

然后在面板 **准备命令** 里填（路径无空格时不必加引号；有空格时写成 `"C:\path with space\prepare-ticket.cmd"`）：

```
<you>\bin\prepare-ticket.cmd
```

用到的执行环境变量（面板里点变量名可直接插入）：

| 变量 | 含义 |
| --- | --- |
| `DSH_SUPERAGENT_DIR` | 这张工单的执行目录（绝对路径） |
| `DSH_SUPERAGENT_NAME` | 工单短名（`1–4` 个英文小写 kebab 单词 + `-` + id 前 12 位，例如 `fix-plan-color-a1b2c3d4e5f6`） |
| `DSH_SUPERAGENT_TICKET` | 工单 id |
| `DSH_SUPERAGENT_GITHUB_REPOSITORY` | `owner/name` |
| `DSH_SUPERAGENT_GITHUB_PR_HEAD` | 若工单来自 PR：它的 head 分支；否则为空 |
| `DSH_SUPERAGENT_GITHUB_NUMBER`, `DSH_SUPERAGENT_GITHUB_ACCOUNT`, `DSH_SUPERAGENT_GITHUB_COMMIT_EMAIL` | 起始 Issue/PR 编号、智能体账户、提交邮箱 |

✅ **实测结论**（在 `cmd.exe /d /s /c` 下用 git 2.56 跑通）：

- `git -C "<clone>" fetch --no-tags "<url>" "<ref>:refs/dsh-superagent/<ticket>"` + `git worktree add -b "agent/<name>" "<dir>" "<ref>"` 完全可行；
- clone 路径、工单根目录里**有空格**也没问题（全部加引号）；
- `DSH_SUPERAGENT_GITHUB_PR_HEAD` 为空时用 `HEAD`，创建出的工单目录有完整工作区；
- 失败时的 `exit /b` 退出码会正确传回，面板会显示 `The prepare command failed: …` 和输出。

**为什么用包装器而不是一行命令**：cmd 里没有"空值取默认"，如果直接把 `%DSH_SUPERAGENT_GITHUB_PR_HEAD%` 拼进 refspec，PR head 为空时会变成 `:refs/...`，`git fetch` 直接报 invalid refspec。包装器里的 `if "%REF%"=="" set "REF=HEAD"` 解决这一点，并且把容易出错的引号集中在一处。

> `GIT=git.exe` 依赖后端进程的 PATH 上有 git；若没有（或想锁定版本），把它改成 git 的绝对路径，例如 `set "GIT=%ProgramFiles%\Git\cmd\git.exe"`。
> `%USERPROFILE%\src\widgets` 是 `.cmd` 里的展开，正确；面板里那个"准备命令"值必须是**字面绝对路径**（不能写 `%USERPROFILE%`）。

### 7.5 Prompts（提示词 / 团队段落）

在 **Settings → Prompts → 编辑**，关注三处（顺序同上游文档 `docs/004-prompts.md`）：

| 段落 | 要写什么 | 本机建议 |
| --- | --- | --- |
| **Communication** | 发给人的消息规则；**GitHub 每条消息的第一行声明**；哪些普通账户算"自动评审机器人" | 默认第一行 `This is by an automated agent, not a human.` 保留；如果有自动评审账户（不是 `[bot]` 结尾的），必须在这里点名 |
| **Ticket scope** | 工单何时继续、何时带草稿停下 | 默认即可 |
| **Delivery requirements** | PR 证据要求、**提交身份（commit author）**、**自动合并（auto-merge）条件** | 见下两行 |

**提交身份（必须是智能体账户）**：
默认不写身份时，执行器会用智能体账户的 no-reply 地址（`<id>+<login>@users.noreply.github.com`），这正是想要的效果。为了明确，建议在 Delivery requirements 里加一句：

```text
Author every commit as the agent account, DSH_SUPERAGENT_GITHUB_ACCOUNT <DSH_SUPERAGENT_GITHUB_COMMIT_EMAIL>, never as the operator or any other person.
```

**自动合并（auto-merge）**：
默认答案是 **不要**。原因：GitHub 把"启用自动合并"记在**启用者**名下，所以智能体不能用自己的账户开自动合并；要开就必须另有一个能合并的账户的 CLI，并在 Delivery requirements 里点名。答案"否"时：

- 把默认 Delivery requirements 里关于 auto-merge 的整段删掉（或直接写明）：
  ```text
  Never enable auto-merge; a person merges every pull request.
  ```
- 这样 PR 由人来合并，符合"先保守、观察后再放开"的节奏。

保存提示词**不会重启**后端；Sessions 每次模型请求都会读最新版本。升级后如果某些段落显示 **Default updated**，逐段决定"保留我的文本"还是"用新默认"。

### 7.6 保存语义与（可选）管理 API

- 每次保存都带 `revision`（乐观锁）；过期会返回 409，面板会提示
- 账号/仓库/CLI 这类改动会先跑一次 setup 检查；通过后返回 `restarting: true`，后端自己重启一次
- 面板就是同一套本地 API，路径前缀 `http://127.0.0.1:<port>/orchestrator/api/`，请求头必须带 `x-orchestrator-request: 1`，Host 必须是 `127.0.0.1:<port>` 或 `localhost:<port>`，否则 403

```powershell
# 读设置（把 $port 换成当前端口：应用窗口里的端口不固定，CLI 路径是 3082）
$port = 3082
$api  = "http://127.0.0.1:$port/orchestrator/api"
$h    = @{ 'x-orchestrator-request' = '1' }
Invoke-RestMethod "$api/settings" -Headers $h | ConvertTo-Json -Depth 6

# 读健康/初始化状态
Invoke-RestMethod "$api/state" -Headers $h | ConvertTo-Json -Depth 6
```

> 应用路径的随机端口可以从应用日志 `backend.log` 的 `dsh web: http://127.0.0.1:<port>/?token=…` 里找到。

---

## 8. 启动 / 停止 / 状态

### 8.1 日常：桌面应用（已移除，历史记录）

> 外壳与快捷方式已于 2026-11-07 删除，本节步骤不可执行；日常改用 §8.2 的 CLI 服务管理器，或在官方应用里使用插件。

| 操作 | 怎么做 |
| --- | --- |
| 启动（正常） | 双击桌面快捷方式 `%USERPROFILE%\Desktop\Superagent.lnk`（开始菜单 `…\Programs\Superagent\Superagent.lnk` 也有副本）；快捷方式由 `install.cmd` 生成，目标=安装根目录的 `Superagent.exe`，参数 `--no-sandbox --disable-gpu` |
| 启动（源码目录 / 未安装时） | `<checkout>\windows-app\启动 Superagent.cmd`（同样带必需参数） |
| 直接运行 exe | 只建议排查时用；**必须带** `--no-sandbox --disable-gpu`：<br>`& "$env:LOCALAPPDATA\Programs\Superagent\Superagent.exe" --no-sandbox --disable-gpu` |
| 看菜单 | 菜单栏默认隐藏，**按一下 `Alt`** 才出现 |
| 重启后端 | **Ctrl+Shift+R**，或 文件 → 重启后端 |
| 重新加载页面 | **Ctrl+R**（强制：Ctrl+Shift+F5） |
| 开发者工具 | **Ctrl+Shift+I** |
| 打开日志目录 | 文件 → 打开日志文件夹（或 帮助 → 打开日志文件夹） |
| 退出 | 关窗口 / 文件 → 退出 / **Alt+F4** |
| 重复启动 | 单实例：第二次双击只会把已有窗口调到前台，不会起第二个后端 |
| 移动/重装修复 | 关应用 → 重跑 `<checkout>\windows-app\install.cmd -Force`（重写 `config\paths.json` 与快捷方式） |

行为要点（依据 `<checkout>\windows-app\README.md` 与验收时的日志/截图）：

- 启动立刻显示"正在启动 Superagent…"，约 5 秒内抓到 `dsh web: http://127.0.0.1:<port>/?token=…` 并载入；**裸 URL 是 401（设计如此）**，token URL → 303 → 写 cookie → 200。
- 后端 90 秒内没给出 URL → 显示"后端启动超时"错误页，附**确切的启动命令**与最近输出。
- 后端异常退出 → 同样风格的错误页（退出码/信号 + 输出尾部），提示按 Ctrl+Shift+R；**不自动重试**（避免崩溃循环掩盖原因）。
- 退出：先 SIGTERM，2 秒未退则 `taskkill /PID <pid> /T /F`（另有 8 秒硬上限）；`process.on('exit')`/未捕获异常也会清进程树。验收时退出后 **0 个 Superagent 进程、0 个 dsh node 进程**。
- 窗口默认 1280×860（最小 960×640），大小/位置/最大化会记住；外部链接用系统浏览器打开；权限只放行剪贴板/通知/全屏。
- **后端不在应用里**：应用只负责找 Node + 全局 `@deepseek-ai/dsh` 并启动它；找不到时错误页会说明缺什么（也可用 `SUPERAGENT_NODE` / `SUPERAGENT_DSH_BIN` 指定）。
- **完整性级别**：本机这类环境里，从受限上下文启动 Electron 会拿到 Low-integrity 令牌，写不了 `%USERPROFILE%\.dsh` → 后端以 `EPERM … cordis.yml` 退出 1；应用检测到 Low IL 会在错误页给出对应提示。**正常从 Explorer 双击（Medium IL）预期没问题——但这一点还没有被一次普通双击验证过**（见 12.2），可用 `DSH_HOME` 指向可写目录 + `SUPERAGENT_STATE_DIR` 做排障。

### 8.2 排障 / 无人值守：CLI 服务管理器

在 checkout 根目录、普通 PowerShell 窗口里：

```powershell
Set-Location <checkout>

.\scripts\dsh-superagent.cmd start      # 后台启动（隐藏控制台），打印日志路径
.\scripts\dsh-superagent.cmd status     # 打印 JSON 状态，用退出码表达结果
.\scripts\dsh-superagent.cmd stop       # 优雅停止（命名管道 → SIGINT，最多等 5 分钟）
.\scripts\dsh-superagent.cmd restart

# 非默认 profile / 端口
.\scripts\dsh-superagent.cmd --profile superagent --url http://127.0.0.1:3082 status

# 给巡检用：intentional stop（手动 stop 过）时不自动拉起
.\scripts\dsh-superagent.cmd --profile superagent --respect-stop restart
```

- 启动日志：`<checkout>\.artifacts\dsh-superagent-superagent-<YYYYMMDD-HHMMSS>-<pid>.log`（保留最新 20 个）
- 控制文件：`<checkout>\.artifacts\control\profiles\superagent\`（`service.pid`、`manually-stopped`、`operation.lock`）
- 服务实际命令：`node --import <checkout>\scripts\dsh-service-hook.mjs <dsh lib\bin.js> --profile superagent --no-open`，工作目录 = checkout。`DSH_SUPERAGENT_DSH_BIN` 可覆盖 dsh 入口（排障/测试用）
- **优雅停止**：`stop` 通过命名管道 `\\.\pipe\dsh-superagent-<profile>-<checkout路径 sha1 前 8 位>` 发一条 `stop`，服务把它变成 DSH 本来就在处理的 SIGINT（收尾 Sessions 后退出，实测退出码 130）；最长等 `--stop-timeout`（默认 300 秒），**从不强杀**
- 健康判断：先看 `service.pid` 是否存活，再请求管理 API 的 `/orchestrator/api/state`；**不会去探 `/`**（它按设计返回 401）
- 本路径**固定使用 profile 里的 3082**；被占用时 `start` 会失败（见第 10 节）
- `stop` **从不强杀**；只有 `stop` 会写 `manually-stopped`，`start` 会清掉它
- **CLI 只认由它自己启动的实例**（靠 `service.pid`）：它不会去停应用窗口里的那份后端，反之亦然。所以"CLI `status` 说没在运行、但应用正开着"是正常现象。
- **同一个 `stateDir` 只能有一个后端**：第二个实例会以 `Lock file is already being held` 退出。看到它通常表示已经有一个后端在跑，而不是配置错误。

### 8.3 退出码契约（`status` / `start` / `restart` 都一样）

| 退出码 | 含义 | 你该做什么 |
| --- | --- | --- |
| **0** | 服务正常运行 | 什么都不用做 |
| **1** | 没在运行 / 跑了两个 / 不响应 / runtime 报错 | **先重启**（`restart`）。仍为 1：看最新 `.artifacts` 日志、看端口占用（第 10 节） |
| **2** | 在运行，但某个部件（Source、策略同步 `sync:<id>` 等）报错 | **不要重启**（重启不修）。`status` 的 JSON 里 `errors` 会点名部件和 detail，按部件修（账号、权限、网络、仓库） |
| **3** | 在运行，但**等待 setup** | **不要重启**。`setup` 字段说明缺什么，按提示去面板对应设置补；修完点 **Check again** |

### 8.4 后端在底下到底跑了什么

桌面应用不经过 shell，直接 spawn（🔧 源码确认；端口、token、启动顺序均已 ✅ 实测）：

```powershell
$dshBin = "$env:APPDATA\npm\node_modules\@deepseek-ai\dsh\lib\bin.js"
node $dshBin --profile superagent --patch "<userData>\runtime.patch.yml" --no-open
```

- **`--patch` 必须写在应用自己的参数（`--no-open` 等）前面**；反过来会报 `unknown option '--patch'`
- `<userData>\runtime.patch.yml` 里是 `webserver: 127.0.0.1 + port: 0` → **随机空闲端口**；要提高固定端口就用 `SUPERAGENT_PORT`
- 后端在 stdout 打印：`dsh web: http://127.0.0.1:<port>/?token=<token>`，应用用正则抓它并加载
- **不带 `?token=` 的裸 URL 返回 401**，这是 DSH 的正常行为，不是故障
- 后端的**工作目录**由应用解析（不是写死的）：`SUPERAGENT_CWD`/`SUPERAGENT_CHECKOUT` → `<root>\config\paths.json` 记录 → exe 附近布局搜索（用 `package.json` 的 `"name": "dsh-superagent"` 校验）→ profile 目录 → 用户目录；顺序细节见 `windows-app\INSTALL.md` §3.1
- CLI 路径（`<checkout>\scripts\dsh-superagent.cmd`）**不加** `--patch`，所以用 profile 的 3082；它用 `--import scripts\dsh-service-hook.mjs` 预加载停止钩子（不设控制管道变量时完全惰性），所以能被 `stop` 优雅停止
- 一个 `stateDir` 同时只能有一个后端（`Lock file is already being held`）
- 应用支持的排障用环境变量（一般不用设，完整表见 `<checkout>\windows-app\README.md` §6 与 `INSTALL.md` §3）：
  `SUPERAGENT_PROFILE`（默认 `superagent`）、`SUPERAGENT_PORT`（默认 `0`）、`SUPERAGENT_STATE_DIR`（写进 overlay，换独立 `stateDir`）、
  `SUPERAGENT_USER_DATA`、`SUPERAGENT_HOME`（安装根目录）、`SUPERAGENT_CWD`/`SUPERAGENT_CHECKOUT`（插件 checkout）、
  `SUPERAGENT_NODE`、`SUPERAGENT_DSH_BIN`、`SUPERAGENT_GIT_DIR`、`SUPERAGENT_GH_DIR`、`SUPERAGENT_START_TIMEOUT_MS`（默认 90000）、`SUPERAGENT_SCREENSHOT=1`
- 应用数据（userData）按顺序取第一个可写的：`%SUPERAGENT_USER_DATA%` → **`%APPDATA%\Superagent`（默认）** → `<exe 所在目录>\user-data`（`%APPDATA%` 不可写时的兜底）→ `%TEMP%\superagent-user-data`；实际选择写在 `app.log` 开头
- overlay 优先写到 `<userData>\runtime.patch.yml`；不可写时依次退到应用目录、系统临时目录

启动后 `GET /orchestrator/api/state` 的典型待配置状态（✅ 实测，`stateDir` 用临时目录、端口用 `--patch` 换到 3099）：

```json
{
  "setup": {
    "problem": { "place": "github", "code": "repositoryUnset",
                 "detail": "The GitHub Source names no repository." },
    "accounts": null
  },
  "health": {
    "runtime": { "state": "paused", "detail": "Waiting for the deployment check", "code": "setupPending" },
    "github":  { "state": "paused", "detail": "Waiting for the deployment check", "code": "setupPending" }
  },
  "load": { "running": 0, "queued": 0, "maxWorkers": 3 }
}
```

这对应 `status` 的**退出码 3**（等 setup），不是故障；把仓库和智能体 CLI 配上即可。

临时手动验证（只读；不要改 profile，也不要杀不是你起的进程）：

```powershell
# 换到 3082 之外的端口需要 overlay（--patch 放在最前面）
@"
- id: webserver
  config:
    host: 127.0.0.1
    port: 3099
- id: dsh-superagent
  config:
    stateDir: <you>/AppData/Local/Temp/sa-test
"@ | Set-Content -Encoding utf8 "$env:TEMP\sa-test.yml"

node "$env:APPDATA\npm\node_modules\@deepseek-ai\dsh\lib\bin.js" `
  --profile superagent --patch "$env:TEMP\sa-test.yml" --no-open

# 另开窗口：
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:3099/                                  # 401
curl.exe -s -H "x-orchestrator-request: 1" http://127.0.0.1:3099/orchestrator/api/state        # JSON
```

### 8.5 日志都在哪

应用的用户数据目录（默认）：`%APPDATA%\Superagent\`；`%APPDATA%` 不可写时退到 `<exe 所在目录>\user-data\`；实际选择写在 `app.log` 第一行。

| 日志 | 位置 | 用途 |
| --- | --- | --- |
| 应用生命周期 | `<userData>\app.log` | 启动命令/工作目录、PID、preflight 结果（找到的 git/gh 目录）、后端 URL、页面加载、退出码 |
| 后端原始输出 | `<userData>\backend.log` | 插件启动错误、setup 报错、`dsh web:` 行 |
| 窗口状态 | `<userData>\window-state.json` | 位置/大小/最大化（只恢复到仍在屏幕上的位置） |
| 端口 overlay | `<userData>\runtime.patch.yml` | 应用生成的端口覆盖配置，**不要手改** |
| 调试截图 | `<userData>\screenshot.png` | 仅 `SUPERAGENT_SCREENSHOT=1` 时 |
| CLI 服务日志 | `<checkout>\.artifacts\dsh-superagent-superagent-*.log` | CLI 路径启动的后端 |
| DSH 启动诊断 | `%USERPROFILE%\.dsh\logs\startup-<ISO时间>-<随机>.log` | 插件未激活/端口占用等启动失败详情 ✅ 实测存在 |

### 8.6 无人值守：自带的外层值守循环（可选，仅 CLI 无人值守路径）

上游 `docs/006` 只建议"在你自己的 profile 里每小时巡检一次"，并把"没有 Windows 服务、注销/重启后不会自动恢复"列为已知缺口。本仓库把那一层做成了原生脚本，**不再依赖任何外部定时任务**。

这一层是**可选项**，服务的是 §1.3 的第三条路（CLI 无人值守）。官方应用内插件路径不需要它：宿主由应用自己启停，且两条路共用 `stateDir` 时插件锁只允许一个插件实例（应用持锁期间 guard 起的后端激活不了插件）。

| 文件 | 干什么 | 生命周期 |
| --- | --- | --- |
| `scripts\dsh-superagent-watchdog.ps1` | **跑一次 tick 就退出**：读 `dsh-superagent.cmd status` 的退出码并按契约处置 | 每次被调用只活一轮，天然自终止 |
| `scripts\dsh-superagent-guard.ps1` | **登录后的循环**：先把后端拉起来一次，之后每 15 分钟跑一个 tick | 会话启动项，注销即结束 |
| `scripts\install-guard-startup.cmd` | **双击安装**：往你**自己**的"启动"文件夹写一个隐藏窗口 VBS 启动器 | 免管理员、不进计划任务、不写机器注册表 |

**tick 的处置逻辑**（与 §8.3 四态退出码一一对应）：

- `0` → 健康。若上一轮告过警，补一条 `RESOLVED` 并把失败计数清零。
- `1` → 没跑 / 双开 / 无响应：执行 `restart --respect-stop`。**非零重启先等 45 秒再探一次**——`restart` 可能在服务还在引导时就返回，早期版本会把这种瞬态记成一次失败重启、白白吃掉放弃预算。连续失败到 `MaxFailedRestarts`（默认 3）就**停手并升级给人**，不再乱重启；任何一次成功都会复位计数。脚本永不 `taskkill`。
- `2` / `3` → 部件报错 / 等待 setup：**绝不重启**，只在**错误签名变化时**告警一次（签名 = 把时间戳与空白归一后取 SHA-256 前 16 位），所以一次网络抖动不会刷屏，同一个故障也不会每小时重复轰炸。
- 无论发生什么，脚本自身**恒退出 0**，避免调度器重试成环。

**状态与日志**：全部在 `%APPDATA%\Superagent\watchdog\`

| 文件 | 内容 |
| --- | --- |
| `last-state.json` | `failedRestarts` 计数 + 当前告警的 `alertKind` / `signature` / `alertedAt` |
| `alerts.log` | 给人看的 `ALERT` / `RESOLVED` 行（含状态 JSON，换行压成 ` \| `） |
| `watchdog.log` | 每轮一行（`ok` / `restart recovered` / `exit 2 signature …` / `GUARD loop started`），超过 1 MiB 自动截尾 |

**装 / 停 / 卸载**：

```powershell
# 手动跑一个 tick（不需要安装，排障时最常用）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dsh-superagent-watchdog.ps1

# 开机自启：双击 scripts\install-guard-startup.cmd
#   它会写出 %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\DSH-Superagent-Guard.vbs
#   立刻生效而不想注销：直接双击那个 vbs
```

三条**故意留下的死亡路径**（没有退路的定时任务不允许存在）：

1. 注销即结束——它是会话启动项，不是服务；
2. 在 `%APPDATA%\Superagent\watchdog\` 里建一个名为 `disabled` 的文件 → 循环在下一个 tick 自己退出；
3. `scripts\dsh-superagent.cmd stop` 写手动停止标记，每个 tick 都带 `--respect-stop`，**人为停的不会被复活**。

> ⚠️ 与 §8.2 的口径一致：这套值守管的是 **CLI 路径**（端口 3082、`.artifacts` 日志），也只对这条路径有意义。应用内插件路径不需要它：宿主由应用自己启停；两条路共用 `stateDir` 时插件锁只允许一个实例（应用持锁期间 guard 起的后端无法激活插件），且 guard 的 `status` 只看 CLI 的 `service.pid` 与 3082，监督不到应用的后端。
> ⚠️ 安装器**必须由操作员本人双击**：在受限/自动化上下文里，计划任务注册与"启动"文件夹写入都会被系统拒绝，脚本无法代劳。

### 8.7 不要乱杀进程

- 正常停止：应用内退出 / `scripts\dsh-superagent.cmd stop`。
- `taskkill /F` 会打断正在执行的工单，只能在进程确实无响应、且接受丢失当前步骤时使用；应用退出时自己会用 `taskkill /T /F` 兜底，那是有序流程的一部分。

---

## 9. 第一次跑通

> 这条链路在本机已经**端到端跑通过一次**（issue 评论 → Ticket → 执行器 → PR #5），实测记录见 12.1。下面是给新环境的操作步骤。

### 9.1 先决检查

1. `status` 语义上健康（CLI：退出码 0；或应用窗口能打开面板且 Overview 没有红色 setup 项）。
2. Sources：仓库已填、**智能体的 GitHub CLI 已填并通过校验**（面板会显示它登录的账号）。
3. Policy：**allowed 列表里至少有一个人**（建议先是你自己）。
4. Execution：目录根可用；准备命令已填（如果没有仓库需要检出，可以先留空跑一次空目录）。
5. 接单模式是 `observe` 也没关系——**明确 @ 智能体的请求在任何模式下都会被处理**。

### 9.2 发一个请求

**Mode B（GitHub 派单）**——用 **allowed 列表里的账户**（不是智能体账户）在目标仓库里：

- 新开一个 Issue，正文写：`@<agent-login> 把 README 的安装段落补上 Windows 说明`
- 或者在一个已有 Issue/PR 下**新发一条评论**：`@<agent-login> …`

> ❗ 通过"编辑已有 Issue 正文"加上 @ 是**不会**被收到的；必须是新评论或新 Issue。

**Mode A（本地收件目录派单）**——不需要第二个账号。派单动作本身不联网（往 `<stateDir>\inbox\` 放一个 `.md` 就行），但**写操作工单仍然要走 GitHub**：提交要推分支、交付要开 PR。只读工单才真的全程不联网。工单文件长这样：

```markdown
title: 首单只读验证（勿改文件）

1. 只做检查并给出实际命令与非空输出：当前分支名、`git log --oneline -1` 的一行、工作目录第一层文件列表。
2. 不要修改任何文件、不要提交、不要开 PR、不要 push。
3. 三项齐全且各自带非空输出即视为完成，最后单独一行写「链路验证通过」；任一为空即写「未证」。
```

- 文件名就是工单短名，会成为工作树分支 `agent/<文件名词干>-<id>` 的一部分；**同名文件重复投递是幂等的**，内容或 mtime 变了才算新事件。
- 判据要写成**可验证**的：每项都要求"实际命令 + 非空输出"，并给一个明确的终态词。空输出一律记"未证"，不要接受"我看过了，没问题"。

### 9.3 一分钟内应该看到什么

**Mode B**：

- GitHub 来源默认 60 秒轮询一次；面板 **Overview** 出现一张 Ticket；
- 智能体的账户在原对话里**确认一次**（带 `This is by an automated agent, not a human.` 声明）；
- Ticket 进入 **working**，执行器在自己的目录里干活；
- 完成后回到原对话交付（PR 链接 + 一句结论）。

**Mode A**：

- 收件目录默认同一节奏轮询；原文件被**移动**进 `done\`（这一步就是读取位点，重启不会重放）；
- `done\<文件>.reply.md` 先出现一段 `**acknowledgement · <ISO> · <文件>**`，逐条复述它理解的任务与判据；
- 干完活后同一文件**追加**一段 `**reply · <ISO> · <文件>**`，里面是实际命令、非空输出和终态词；
- 面板 `Overview` 同样能看到这张 Ticket 的 Trigger / Eval / Execution 历史——Mode A 只换了入口，没换机器。

### 9.4 验收

- PR 分支形如 `agent/<DSH_SUPERAGENT_NAME>`（= `agent/<工单短名>`）；提交作者是**智能体账户**；
- 如果按 7.5 选了"不自动合并"，PR 由你合并。
- **Mode A 只读首单的验收口径**（本机已按此通过）：回信里的分支名、`git log --oneline -1`、目录第一层三项，逐字对得上你自己在工作树目录里跑的 git 命令；工作区 `git status` 干净；远端只有 `origin/main`，没有 `agent/*`、没有 PR、没有 push。**三项里任何一项为空就是"未证"，不算通过。**

### 9.5 跑不通时按这个顺序查

1. 作者在不在 allowed 列表？（Mode B 最常见）
2. Source 是否启用、处理是否被暂停（Execution → 暂停处理）？Mode A 还要确认 `dsh-superagent-inbox` 在 profile 里是 enabled，且文件真的落在 `<stateDir>\inbox\` 根下（不是 `done\`）
3. 智能体账户的 `gh` 是否已登录、是否有 push 权限？（Mode A 只读工单不需要）
4. `status` 退出码是 2 还是 3？（按 8.3 处理；`2` 里 `evals` 报错通常是模型额度/供应商问题，不是进程故障）
5. 工单停在 `prepare` 且报 `CRYPT_E_NO_REVOCATION_CHECK`：worker 环境里联网 clone 撞 Windows git 的吊销检查，按 7.4 改用本地 worktree 基座
6. 后端日志里 setup 的具体报错码（第 10 节对照）

---

## 10. 故障排查

> 面板会把 setup 问题翻译成本地化短句；`status`/日志里是英文原文。下表两种都给。

### 10.1 setup / 账号类

| 症状（英文原文 / 中文面板） | 原因与处理 |
| --- | --- |
| `The agent GitHub CLI is not set.` / 没有设置智能体的 GitHub CLI | Sources 里填 CLI 的绝对路径（推荐 `gh.exe`，或你自己的 `gh-agent.cmd`；见 7.2） |
| `The agent GitHub CLI was not found.` / 找不到智能体的 GitHub CLI | 路径写错、文件不在、或带空格没加引号。`Test-Path 'C:\path\to\gh.exe'` 自查 |
| `The agent GitHub CLI cannot read its account` / 读不到账号 | 智能体的 gh 配置目录里还没有登录：按 6.6 用 `GH_CONFIG_DIR=%USERPROFILE%\.dsh\state\superagent\gh-config` 登录后再保存；确认面板 CLI 指向的 `gh.exe`/`.cmd` 用的是同一个 `GH_CONFIG_DIR` |
| `The agent GitHub CLI did not report a GitHub account` | CLI 输出被别的东西污染（比如 gh 升级提示）。在终端里用同一个 `GH_CONFIG_DIR` 跑一次 `gh.exe api user --jq .login`，看原始输出 |
| `@x cannot read <repo>` / `@x cannot push to <repo>` | 给智能体账户 Write 权限、接受邀请、组织 SSO 授权 |
| `The GitHub Source names no repository.` | 填 `owner/name` |
| `The agent GitHub CLI is not set.` 出现在你还没配置时 | 这是**预期的待配置状态**（`setup.problem.code = agentCliUnset`）：Sources 里填 CLI 与仓库后自会消失 |
| 手工诊断 `git config --show-origin …` 看到 `file:"C:\\\\…"`（带引号、反斜杠转义） | **这不是不匹配**：不带 `-z` 时 git 会做 C-quote。手工对比请加 `-z`：`git config -z --show-origin --get-all credential.https://github.com.helper` |
| `git does not read the github.com credential configuration …`（`gitTooOld`） | **先在新开的终端里跑 `where git`**：这条报错最常见的原因就是 **git 不在后端进程的 PATH 上**（见 2.2），而不是 git 太旧。若 `where git` 正常，再考虑：git < 2.32，或所用 git 发行版不带 `sh.exe`（`!` 凭据助手跑不起来） |
| `<file> was not written by dsh-superagent`（foreign file） | `stateDir\worker-bin` 或 `worker-gitconfig` 里有别的工具写的文件。删掉/移走它们，或换 `stateDir`。**不要**手编这两个位置的文件 |
| `dsh-superagent configuration has keys it does not use: …` | `cordis.patch.yml` 里有废弃/未知键，删掉；日志会说明该值现在在哪（作者、仓库路径、blockedCommands 等已迁移到面板） |
| `The bot lark-cli …`（飞书相关） | 本手册不启用飞书；用不到就忽略 |

### 10.2 执行 / 工单类

| 症状 | 原因与处理 |
| --- | --- |
| 工单显示 `The prepare command failed: …` | 输出就是原因：clone 路径不对、git 不在 PATH、refspec 无效、目录已存在等。修好命令后 **Retry 工单** |
| 工单立即失败：`The prepare command failed: sh: line 1: C:\Users\<you>…: command not found` | 旧构建的 bug：prepare 走了 `sh -c`（Windows 没有 sh，且 POSIX shell 会吃掉 Windows 路径里的反斜杠）。移植版已改为 `cmd.exe /d /s /c`；更新插件并重建（13.3）后重试工单 |
| 准备命令报 `non-fast-forward` / `invalid refspec` | 多半是同一张工单重试时残留了旧 ref。先清：`git -C "$env:USERPROFILE\src\widgets" update-ref -d refs/dsh-superagent/<ticket-id>`（✅ 实测该命令有效），再 Retry |
| 工单目录是空的、worktree 没建出来 | 准备命令留空了；或命令成功了但 `DSH_SUPERAGENT_DIR` 用错（不要在命令里自己再拼路径） |
| `The git configuration of the repository in … sets credential…` | 本地 clone 的 `.git/config` 里有凭据或 `http.*.extraheader`；按 7.4.1 清掉 |
| 执行器长时间卡住 | 看 Overview 的 `models`/`worker` 健康项；可能是模型 provider 重试；也看是否在等审批（不应发生，preset 是 `approval: never`） |
| 编辑 Issue 正文 @ 了智能体但没反应 | 设计如此：只有新 Issue / 新评论（或通知）会触发 |
| **Mode A：文件已进 `done\` 但没有 `<文件>.reply.md`** | 归档移动就是读取位点，**移动发生 ≠ 工单成立**。这条链断在 Eval，不在 Source。查该 thread 的 decision：`sqlite3` 只读打开 `<stateDir>\orchestrator.sqlite`，按 `trigger.value` 里的 `threads[].id` 找 `decision.threadKey = inbox:<threadId>`，看最新一条的 `kind`：`unavailable` + `reason.code = timeout` ＝ **模型额度/供应商问题**（同时 `health.evals` 会报 `Eval(s) unavailable in the last hour`，`status` 退出码 2，**重启不解决**）；`ignore` + `reason.code = said` ＝ 研判认为这个线程已经答过（同一批任务重投、或已有别的工单覆盖），**不会再建工单**。两种都不是"文件丢了"，也不要靠重投同名文件补救——内容或 mtime 变了才算新事件 |
| **Mode A：回信只有 acknowledgement、迟迟没有 reply 段** | 工单已经成立并在跑（`load.running` ≥ 1）。若最终报 `The prepare command failed`，按上面 prepare 各行处理；额度类失败会停在 `failed`，面板 **Retry** 会在同 Session、同目录、同分支起新 Assignment |

### 10.3 应用 / 端口 / 环境类（外壳已移除，本表为历史）

> 下表针对已删除的桌面外壳；与插件/CLI 无关，保留作历史记录。

| 症状 | 原因与处理 |
| --- | --- |
| 双击应用后一直"正在启动 Superagent…" | 90 秒后应出错误页。看 `backend.log` 最后几行；最常见是 git 不在 PATH 导致 setup 失败、或 dsh 版本不对 |
| 应用错误页出现 `EPERM ... cordis.yml` / 无法写 `%USERPROFILE%\.dsh` | 应用运行在**受限（Low-integrity）令牌**下（例如从自动化/沙箱上下文启动），Electron 写不了你的用户目录。**正常从 Explorer 双击（Medium IL）预期没问题，但还没有被一次普通双击验证过**；排障时可用 `DSH_HOME` 指向可写目录 + `SUPERAGENT_STATE_DIR` 指向临时状态目录（验收时就是这么做的，**不要**用于正式数据） |
| 直接双击 exe 后窗口一闪而过/崩溃 | 少了 `--no-sandbox --disable-gpu`。用安装器创建的桌面快捷方式，或源码目录的 `启动 DSH-Superagent.cmd`（两者都内置参数） |
| 从某个终端/IDE 里启动后**什么都没发生**：没有窗口、`app.log` 也没有新增行 | 该终端设置了 `ELECTRON_RUN_AS_NODE=1`（Electron 系编辑器/自动化终端常见），被 `Superagent.exe` 继承后它退化成普通 Node 进程，读不到 app 就以退出码 0 结束——看起来像"双击没反应"。先在新终端里 `$env:ELECTRON_RUN_AS_NODE` 确认，再 `set "ELECTRON_RUN_AS_NODE="`（PowerShell：`Remove-Item Env:ELECTRON_RUN_AS_NODE`）后启动；或直接双击桌面快捷方式（不继承那个变量）。源码目录的 `启动 DSH-Superagent.cmd` 已内置清除 |
| 移动了安装目录/checkout 后打不开、或快捷方式失效 | 重跑 `<checkout>\windows-app\install.cmd -Force`：它会重写 `config\paths.json` 与两个快捷方式；不要手工改快捷方式 |
| 后端 cwd 落在 `%USERPROFILE%\.dsh\profiles\superagent` 而不是 `<checkout>` | 旧版应用的 bug：安装记录被从 `APP_ROOT\..\config\paths.json` 读取（正确是 `<root>\config\paths.json`），于是静默回退到 profile 目录。更新应用并 `install.cmd -Force` 后重启；临时可用 `SUPERAGENT_CWD=<checkout>` 绕过 |
| 安装记录不生效 / 改了 `config\paths.json` 没反应 | `paths.json` 若带 **BOM**，`JSON.parse` 会失败并（旧版）被静默忽略。安装器已改为无 BOM 写入、读取端剥 BOM；手工编辑请用**无 BOM 的 UTF-8**，改完重启应用 |
| 启动页/面板顶部出现横幅"未找到 git (Git for Windows) / gh (GitHub CLI)" | 应用没找到 git/gh，GitHub 集成不可用。按 2.4 加进 User PATH，然后 **Ctrl+Shift+R** 重启后端 |
| 应用错误页提示"另一个 Superagent 后端正在运行并占用同一 stateDir" | 先关掉别的实例；或设 `SUPERAGENT_STATE_DIR` 指向独立状态目录再启动（排障用，不要用于正式数据） |
| 应用错误页提示"端口被占用 … 若你设置了 SUPERAGENT_PORT" | 把 `SUPERAGENT_PORT` 改回 `0`（应用应使用系统分配端口） |
| 错误页"找不到 Node.js 或 DeepSeek Harness" | 应用只认 `C:\Program Files\nodejs\node.exe` 或 `where node`，以及 `%APPDATA%\npm\node_modules\@deepseek-ai\dsh\lib\bin.js`；用 `SUPERAGENT_NODE` / `SUPERAGENT_DSH_BIN` 覆盖，或装好 |
| `EADDRINUSE … 3082` | **CLI 路径**下：已经有一个后端（应用或 CLI）占着 3082。`Get-NetTCPConnection -LocalPort 3082` 查 PID；停掉多余的实例。应用路径下出现它，说明 overlay 没生效（检查 `<userData>\runtime.patch.yml` 是否被生成） |
| `start` 报 `Lock file is already being held` | 同一个 `stateDir` 已经有后端在跑（可能正是应用窗口里的那份）。这是正常的单实例保护：先确认/停止已有实例，不要同时开两个 |
| 后端被强杀过后启动失败：仍报 `Lock file is already being held`，且 Source 显示 **Off (`sourceOff`)** | 被强杀的后端留下了陈旧的锁。**先确认进程已停**，再删除 `%USERPROFILE%\.dsh\state\superagent.lock`，然后重新启动后端 |
| 关掉再打开应用后，Source 变成禁用/`Off`，或 setup 又说没仓库/没 CLI | 检查 **设置 → 来源 → GitHub** 的启用开关与两个字段（仓库 `owner/name`、CLI 绝对路径）——实测遇到过 `repository`/`cli` 被写成空串的情况，重新填上并保存即恢复 |
| 启动失败日志出现 `tools.restrict() names unknown global tool "bash"` | 旧构建的 bug：主 Session 硬编码了 `bash` 工具名，而 Windows profile 没有它，`tools.restrict()` 拒绝未知名字导致插件不激活。移植版已改为从**实时工具注册表**取可用工具；更新并重建后即可 |
| `stop` 报"无法通知/无法停止"且不发强杀 | 该服务不是由**当前版本**的 `start` 启动的（没有预加载 `scripts\dsh-service-hook.mjs`），所以命名管道收不到。用 `start` 重启一次即可恢复可停性 |
| 3082 被一个"装了插件但没启动"的 dsh 占着：`/` 返回 401、`/orchestrator/api/state` 返回 404 | 那是另一个 dsh 实例（没加载 dsh-superagent）。CLI `start` 会绑定失败；停掉它，或改 superagent 的端口（4.3/4.5） |
| 启动日志出现 `unknown option '--patch'` | `--patch` 是**启动器参数**，必须写在 `--no-open` 等应用参数之前：`--profile superagent --patch <file> --no-open` |
| `status` 退出码 3，`health.runtime` 是 `paused` + `code: setupPending` | 正常待配置：`setup.problem` 为 `repositoryUnset` / `agentCliUnset`。去面板把仓库和智能体 CLI 填好即可（不是故障，别去重启） |
| 裸开头 `http://127.0.0.1:<port>/` 显示 401/白页 | 正常：必须带 `?token=`（应用自动处理；CLI 路径从日志里复制完整 URL） |
| 面板打不开 / 一直在重载 | 看应用错误页与 `backend.log`；CLI 路径看 `.artifacts` 日志与 `status` |
| `无法加载文件 …npm.ps1，因为在此系统上禁止运行脚本` | 用了裸 `npm`/`pnpm`/`dsh`。改成 `.cmd`（2.3） |
| 中文乱码（日志/终端） | PowerShell 里先 `[Console]::OutputEncoding = [Text.Encoding]::UTF8`；`.cmd` 脚本请保存为 ANSI/UTF-8 均可，日志本身是 UTF-8 |
| 路径里有空格/中文导致失败 | 所有路径加双引号；尽量不用中文路径；超长路径在 git 里开 `core.longpaths` |
| 带反斜杠结尾的路径在引号里出错 | cmd 会把 `\"` 当转义。拼接时**不要让变量以反斜杠结尾**再贴引号（`git -C "%CLONE%"` 这种结构天然安全） |
| `.cmd` 双击闪退/行为异常 | 确认是 **CRLF** 换行；在 PowerShell 里运行看报错，而不是双击 |
| `status` 退出码 2 | 见 8.3：不要重启，按 `errors` 里的部件修 |
| `status` 退出码 3 | 见 8.3：按 `setup` 去面板补设置，再 Check again |
| 升级 DSH 后面板 "Failed to load plugins" | 重启后端（应用 Ctrl+Shift+R） |
| 插件与 dsh 版本不兼容 | 安装满足 `engines.dsh` 的版本（本机固定 `0.2.1-rc.3`） |

---

## 11. Windows 移植与上游的差异

> 这是**操作者视角**的摘要。完整的逐处清单、冲突处理预案与升级判定标准以 [`docs/WINDOWS-DELTA.md`](WINDOWS-DELTA.md) 为准。表中与桌面外壳有关的行（如 `Superagent.exe`、快捷方式）是 2026-11-07 移除前的历史记录。
> 仓库状态（可引用）：`origin` = `ReSerendipity/dsh-superagent`（本适配版唯一推送目标）、`upstream` = 官方原型仓库、`reference` = Check-mj 的 Windows 移植（起步来源，已不再是上游）；具体提交以 `git remote -v` 与 `git log -1` 为准，三处来源的分工见 `NOTICE`。`WINDOWS-DELTA.md` 的 §3.4 记录 E2E 才暴露的两处缺陷、§3.5 记录 batch 包装器参数传递；契约测试 `tests/windows-port.spec.ts` 2 条全绿（batch shim + PATH 剥离 + `.cmd` 包装器精确传参）。

| # | 上游（POSIX） | Windows 移植后的行为 | 状态 |
| --- | --- | --- | --- |
| 1 | `scripts/dsh-superagent start` 用 **tmux** 会话，`stop` 发 SIGINT | 入口 **`scripts\dsh-superagent.cmd`**（批处理，不是 `.ps1`）；Windows 用 `CREATE_NO_WINDOW` 分离启动、`service.pid` 记录、**命名管道 → SIGINT 钩子**（`scripts\dsh-service-hook.mjs`，`node --import` 预加载）优雅停止；不注册服务、不强杀；退出码 0/1/2/3 不变 | ✅ 负责人端到端实测（含真实 dsh 退出码 130） |
| 2 | 命令 shim 是 `#!/bin/sh` 无扩展名脚本 | 写成 **`<name>.cmd`**（`gh.cmd`、`lark-cli.cmd`、被禁命令 `<name>.cmd`）：`@echo off` + `@REM` 标记 + **像上游一样先把自己从 PATH 里剥离**（比较 `%~dp0` 重建 PATH）+ 调用配置的 CLI；另用 `%*` 传参、`exit /b` 透传退出码。这样 worker 里按名字调 `gh` 会命中垫片，再转到真实二进制 | ✅ 实测 + 契约测试（PATH 剥离、参数转发） |
| 3 | 准备命令 `sh -c <command>` | 改为 **`cmd.exe /d /s /c <command>`**（E2E 暴露：Windows 无 `sh`，且 POSIX shell 会吃掉路径里的反斜杠，报 `command not found`）；准备命令必须用 cmd 语法（`%VAR%`、`&&`），不需要 `sh.exe` | ✅ E2E 实测通过；见 WINDOWS-DELTA §3.4 |
| 4 | 账号探测用 `env PATH=… <cli>` | Windows 没有 `env`，改为给子进程显式传 PATH 覆盖，并**显式传 `GH_CONFIG_DIR`**（修复了"账号检查早于环境注入"的顺序问题） | 🔧 源码确认 |
| 5 | 智能体 CLI 用 `~/.local/bin/gh-agent` sh 包装器换账号 | **两种模型都支持**：(a) 面板 CLI = `gh.exe` 绝对路径，账号由插件注入的 `GH_CONFIG_DIR=<stateDir>\gh-config` 选中（推荐，最少配置）；(b) 面板 CLI = 自己的 `gh-agent.cmd`（上游文档模型）——`runAsWorker()` 检测 `.cmd`/`.bat` 后改用 `cmd.exe /d /c <prog> <args…>`，且**程序与参数分 argv 传入**（整行拼接会让 cmd 二次解析引号、目标收到 `\"…\"`）。上游"包装器当 CLI"的模型在 Windows 上重新成立 | ✅ (a) E2E 实测；(b) 契约测试 2 条绿 |
| 6 | `stateDir` 必须是 `/` 开头的 POSIX 绝对路径 | 接受 `C:/…` 或 `D:\…`（正则放宽为 `^(?:[A-Za-z]:[\\/]|\/)`） | ✅ 修复后实测插件可激活 |
| 7 | 用 `ps`/`fcntl`/`SIGINT`/`umask`/`chmod` | 分别换成：`OpenProcess`/`msvcrt` 字节锁/命名管道触发的 SIGINT 钩子/无 | 🔧 源码确认 |
| 8 | `--port` 可改面板端口 | **profile 的 `webserver.port` 会覆盖 CLI 的应用参数**；要改端口必须改 patch 文件或加 `--patch` overlay（桌面应用就是这么做的）；且 **`--patch` 必须放在应用参数之前** | ✅ 实测（`--port 0` 仍撞 3082；`--no-open --patch` 报 unknown option） |
| 9 | 面板在浏览器里 | 桌面应用窗口内嵌同一套 Web 面板（无地址栏/标签页），侧栏 **Superagent** 不变 | ✅ 已用截图验证渲染；安装器布局待验收 |
| 10 | `dsh` 是 POSIX 可执行 | Windows 上 npm 生成 `dsh.cmd`；脚本/文档一律用 `.cmd`，并注意 `Restricted` 执行策略 | ✅ |
| 11 | 每小时巡检跑 `scripts/dsh-superagent …` | Windows 用 `scripts\dsh-superagent.cmd …`（8.6） | 🔧 |
| 12 | 数据库、锁、SQLite、`proper-lockfile`、`--no-open`、`DSH_HOME` | 行为不变；但 Windows 上**一个 `stateDir` 只能有一个后端**（`Lock file is already being held`），要把它当作正常的单实例保护 | ✅ 实测 |
| 13 | 飞书 Source | 本机不启用（`dsh-superagent-feishu` 保持 disabled）；如启用需另配 `lark-cli.cmd` | — |
| 14 | 无桌面应用（只有浏览器面板） | 新增 **`windows-app\` Electron 壳 + `install.ps1` 安装器**：构建产物 368 MB、装好 ≈500 MB（含自带 git+gh ≈133 MB）、可整体搬家、无管理员、注册表零残留；布局是 `<root>\Superagent.exe` + `resources\app\` + `config\paths.json` + `tools\`（可选）+ Electron 运行时，插件 checkout 由 `paths.json` 记录（不复制） | ✅ 安装器实跑 + 启动/渲染验收 |
| 15 | 工具来自 PATH | 安装器壳按「显式覆盖 / 自带 `tools\` → PATH → 标准安装位置」探测 git/gh 并前置到后端子进程 PATH；自带 tools 优先于 PATH（自包含安装不被机器上别处副本顶掉）；缺失只警告不致命；覆盖变量 `SUPERAGENT_GIT_DIR` / `SUPERAGENT_GH_DIR` | ✅ 实跑：preflight 显示 `bundled tools` |
| 16 | 主 Session 的工具列表按平台假设硬编码 | 改为从**实时工具注册表**过滤可用工具（E2E 暴露：硬编码 `bash` 在 Windows profile 里不存在，`tools.restrict()` 拒绝未知名字导致插件不激活）。副作用：Windows profile 若同时加载 bash 插件，两个 shell 都保留 | ✅ E2E 实测；见 WINDOWS-DELTA §3.4 |
| 17 | `.cmd` 包装器无法作为被编程调用的 CLI | `runAsWorker()` 对 `.cmd`/`.bat` 走 `cmd.exe /d /c`，**程序与参数分开作为 argv**（不拼成一行）；契约测试覆盖 batch shim、PATH 剥离、`.cmd` 包装器精确参数转发 | ✅ 契约测试 2 条绿；见 WINDOWS-DELTA §3.5 |

---

## 12. 验证状态与开放问题

> 本节记录的大部分是桌面外壳的构建/安装/运行验收；外壳已于 2026-11-07 移除，这些记录**只能当历史，不能当现在可复跑的证据**。插件侧证据以本文件与 `docs/020` 的现行检查为准。

> 这一节是**诚实清单**：哪些是本次移植在本机实测过的、哪些只是源码/设计确认、哪些还没人跑过。凡与正文冲突，以这里为准。

### 12.1 已经实测过的（可以作为事实引用）

| 项 | 证据 |
| --- | --- |
| 启动器 `scripts\dsh-superagent.cmd` 的 `start/status/stop/restart` 与四个退出码 | 移植负责人端到端跑过：`start` 起真实 dsh（带 `--import` hook、`--patch` overlay 换端口）→ API 应答 → `stop` 发 SIGINT → 进程以 **130** 退出；0/1/2/3 四种码都实际触发过 |
| 优雅停止无强杀 | `stop` 约 0.7 秒返回，pidfile 删除；超时会报错而不是 `taskkill` |
| 命令 shim 的 Windows 形式 | `worker-bin\<name>.cmd`：`@echo off` + `@REM` 标记 + **像上游一样把垫片目录从 PATH 里剥离**（比较 `%~dp0` 重建 PATH）+ 调用配置的 CLI + `%*` + `exit /b`。实测：垫片目录消失、其余 PATH 项保持不变；namespace 内按名字调 `gh` 会命中垫片再转到真实二进制。被禁命令 stderr + exit 1。契约测试 2 条覆盖 batch shim + PATH 剥离 + 参数转发 |
| git 凭据助手 | `helper = !'<gh.exe 绝对路径>' auth git-credential` 经 Git for Windows 的 `sh` 执行；`GH_CONFIG_DIR` 在环境里时 `git credential fill` 返回智能体账号，不在时失败 |
| `verifyEnvironment` 的逐字节比较在 Windows 上原样通过（实测） | `git config -z --show-origin --get-all credential.https://github.com.helper` 的真实输出是 `['file:C:\\…\\worker-gitconfig', "!'C:/…/gh.exe' auth git-credential", '']`，与期望的 `['file:' + workerGitConfig, credentialHelper(cli), '']` 完全一致 → **不会误报 `gitTooOld`**。前提：git 必须是自带 `sh.exe` 的发行版（Git for Windows / MinGit）。注意 `-z`：不带 `-z` 时 git 会 C-quote 路径（`file:"C:\\…"`），手工诊断看起来像不匹配 |
| `.cmd` 作为 CLI（模型 (b)） | Node 确实不能直接 spawn `.cmd`（CVE-2024-27980，抛 `EINVAL`），但移植版的 `runAsWorker()` 检测到 `.cmd`/`.bat` 后用 `cmd.exe /d /c <prog> <args…>`，**程序与参数作为分开的 argv** 传入（整行拼接会被 cmd 二次解析引号，目标收到 `\"…\"`）；契约测试覆盖精确参数转发 |
| 主 Session 工具列表 | 从**实时工具注册表**过滤（`tools.restrict()` 只接受实际存在的工具），不再按平台猜 `bash`/`pwsh`；Windows profile 同时加载 bash 插件时两个 shell 都保留 |
| 准备命令容器 | Windows 为 `cmd.exe /d /s /c <command>`；POSIX 仍 `sh -c`。**这是 E2E 才暴露的缺陷**：旧构建走 `sh -c`，Windows 上没有 sh 且反斜杠被吃掉，报 `sh: line 1: C:\Users\<you>…: command not found`；见 WINDOWS-DELTA §3.4 |
| **端到端首单（实跑，真实 PR）** | 发起人（另一个账号）在 `<maintainer>/<repo>` 的 issue #1 评论 `@<agent> …` → 智能体账号收到 `mention` 通知 → Trigger（`human: true`, `addressed: mention`）→ 决策 **`accept / explicit / explicitRouted`** → Ticket → 自动回一条带 `<!-- dsh-superagent:<id> -->` 标记的确认评论 → 执行器占槽 → prepare 建 worktree → worker Session 编辑 `README.md`、提交、推送 `agent/readme-getting-started-fa569c55e2bc` → **PR #5**（OPEN、MERGEABLE、+6/−0、1 个文件）→ 原对话交付评论带 PR 链接，并说明自动合并关闭、需人工合并。 |
| 端口/`--patch` 规则 | `--port` 输给 profile 的 `webserver.port`；`--patch` 是启动器参数，必须排在应用参数之前；`--no-open --patch` 报 `unknown option` |
| stateDir 单实例 | 同一 `stateDir` 第二个后端 `Lock file is already being held` |
| 面板后端行为 | `dsh web: http://127.0.0.1:<port>/?token=…` 打印；裸 URL 401；`GET /orchestrator/api/state` 200，待配置状态为 `setup.problem.code = repositoryUnset` + `health.runtime = paused/setupPending` |
| **安装器流程（0.2.1 本机自建自装，退出码 0）** | `install.cmd -Force` 打印 install root/checkout、复制应用、记录 `config\paths.json`、创建两个快捷方式。安装根 `%LOCALAPPDATA%\Programs\Superagent` = **368 MB**（与构建产物同尺寸：`Superagent.exe` 246 302 208 字节 + Electron 运行时；`resources\` 266 KB；**无 `tools\`**）。`paths.json` 无 BOM，三键齐全 |
| 快捷方式 | 桌面与开始菜单快捷方式均正确：Target=`<root>\Superagent.exe`、Arguments=`--no-sandbox --disable-gpu`、WorkingDirectory=`<root>`（旧的失效路径问题已不存在）。**文件名是 `DSH-Superagent.lnk`**，开始菜单还多一层同名子目录 `…\Start Menu\Programs\DSH-Superagent\`——按 `Superagent.lnk` 去找会找不到 |
| 安装后启动与面板渲染（实跑） | 窗口标题 `DSH-Superagent`（`APP_TITLE`，`page-title-updated` 被拦下后强制改回；不是旧记录写的 `Superagent`）；`[ready] backend URL: http://127.0.0.1:<port>/ (10379ms)`——**这一行永远不带 token**，应用把 query 剥掉才写日志；`[ui] document.title: DeepSeek Harness`（面板加载）；后端 `cwd` 经 `paths.json` 解析到 `<checkout>`。截图证据：旧记录指向 `<checkout>\windows-app\verification\`，该目录在 `.gitignore` 里、本机不存在，这一版证据只有文本日志与 API 应答 |
| git/gh preflight（实跑） | **取决于安装根里有没有 `tools\`**：旧机器（手工塞过）走 `<root>\tools\git\cmd (bundled tools)`；本机 0.2.1 默认安装**没有 `tools\`**，三条全部落到后两档——`git: C:\Program Files\Git\cmd (known path)`、`gh: <某人>\gh-cli\bin (where gh)`、`pwsh: C:\Program Files\PowerShell\7 (where pwsh)`。也就是说"自包含工具优先于 PATH"这条机制本机只在文档与代码层面成立，`bundled tools` 分支这一版**未走到** |
| 构建产物 vs 安装产物 | `windows-app\Superagent\` = 368 MB（Electron 44.7.0，构建产物）；本机装好同样是 368 MB——多出的 132 MB 只出现在手工塞过 `tools\` 的机器上 |
| **正常用户双击路径首跑（本机实跑，2026-11-06，0.2.1）** | 这条推翻了 12.2 原来的第一条。启动安装根里的 `Superagent.exe`，**不设** `DSH_HOME`/`SUPERAGENT_STATE_DIR`，userData=`%APPDATA%\Superagent`（本机第一份 `app.log`）。结果：`starting 0.2.1 \| Electron 44.7.0` → `[health] no orphan backend found` → `[preflight] …` → `[backend] pid 16412` → `[ready] backend URL: http://127.0.0.1:13393/ (10379ms)` → `document.title: DeepSeek Harness`；**全程无 EPERM、无错误行**。应用拉起的那个后端：`GET /orchestrator/api/state` HTTP 200、`setup.problem=null`、`paused=false`、`load={"running":0,"queued":0,"maxWorkers":3}`、**12 个 health 部件逐个 ready**（`runtime`/`relay`/`notice`/`launch`/`delivery`/`assessment`/`reply`/`evals`/`models`/`router`/`inbox`/`github`） |
| token URL 语义 | token URL → 303 → 写 cookie → 200；裸 root → 401（设计如此） |
| 应用单实例 | 第二次启动只聚焦已有窗口，不启动第二个后端 |
| 优雅退出 | `SIGTERM` → backend exited，应用约 1 秒退出；事后 **0 个 Superagent + 0 个 dsh node 进程** |
| 窗口状态 | 关闭时写 `window-state.json`（如 `{"x":640,"y":266,"width":1280,"height":860,"maximized":false}`） |
| 已修复的两个应用 bug（验证时发现） | ① 安装记录路径曾读成 `APP_ROOT\..\config\paths.json`（正确是 `APP_ROOT\config\paths.json`），导致后端 cwd 静默回退到 profile 目录；② PowerShell 5.1 `Set-Content -Encoding UTF8` 写 BOM，`JSON.parse` 拒绝 → 记录被静默忽略。两侧都已修（安装器写无 BOM、读取端剥 BOM） |
| **Mode A 单人链路端到端（本机实跑，2026-11-05）** | 只读工单 `.md` 丢进 `<stateDir>\inbox\` → Trigger 收录 → 决策 `accept / explicit` → Ticket → worker 启动 → `done\<file>.reply.md` 出现 acknowledgement 段 → prepare 用**本地 worktree**建工作树（分支 `agent/<工单短名>-<id>`）→ worker 真调模型干活 → 回信追加 reply 段。**独立复核**：回信里的分支名 / 最近一次提交 / 目录第一层三项与操作者自己跑的 git 输出逐字一致；工作区零改动；远端只有 `origin/main`（无 `agent/*` 分支、无 PR、无提交） |
| **外层值守 tick 的四态处置（本机实弹）** | 杀掉后端 PID → 下一 tick 检出 exit 1 → `restart --respect-stop` 拉起 → `RESOLVED: restart recovered`；`evals` 部件报错（exit 2）→ 只落**一条**去重告警（签名一致时不重复）、**未尝试重启**；`last-state.json` 的 `failedRestarts` 在恢复后归零 |
| **重启瞬态修复（修复前后对照）** | 修复前：一次真实自愈在 `alerts.log` 留下 spurious `ALERT [unresponsive] restart-failed-1`，其状态 JSON 里 `health: null`（restart 返回时服务还在引导）。修复后：非零重启先等 45 秒再探，同场景直接记 `restart recovered`，不再虚增放弃预算 |
| **guard 循环三条死亡路径（2026-11-05 实弹）** | ① `disabled` 标记：建了再启动 guard → `watchdog.log` 记 `GUARD disabled marker found; loop exits`、当场退出、`loop.pid` 自删、退出码 0；② 单实例：循环在跑时二次启动 → 打印 `guard already running (pid …)` 且退出 0，pid 文件不被覆盖；③ 人为 stop 不被复活：手工放 `.artifacts\control\profiles\superagent\manually-stopped` → `--respect-stop restart` 打印 `Intentional stop is active; automatic recovery skipped.` 并在 stop 之前返回 0，后端 3082 与同一 PID 全程未动。**仍待实跑**：注销→重新登录后自动拉起（见 12.2） |
| **Mode A 写链路端到端（本机实跑，里程碑 M2，2026-11-05）** | 收件目录工单 → 本地 worktree `agent/mode-a-write-verify-9c63774afbb6` → 提交（带 `Signed-off-by`）→ `git diff --name-only main...HEAD` **恰好只有 `README.md`** → 分支推到远端、`origin/main` 仍为 1 个提交未受污染 → **PR #1** `state=OPEN`、`baseRefName=main`、`author=ReSerendipity`、`autoMergeRequest=null`、`mergeable=MERGEABLE` → 回信末行「Mode A 写链路验证通过」并给出 PR 编号与 URL。全程**未注册第二个 GitHub 账号、未新增一行代码**。关键机制：`environmentOf()` 遍历所有已启用 Source 而非工单来源，所以 GitHub 那组变量对 inbox 工单同样可见；`GH_CONFIG_DIR` 下 `gh api user` 返回 `ReSerendipity`，即智能体身份与仓主同源 |
| **P6-6「证据必须落在回信里」（2026-11-06 三投坐实）** | 补上面板提示词 revision 4 后重跑：**带纪律的 profile** 逐项写出命令与输出（`git branch --show-current` → `agent/evidence-p6-check-r2-f8179f1b1201` 等），并抄出环境行原文 `- DSH_SUPERAGENT_DELIVERY = "github": …`，末行「P6-6 验证通过」；**全新安装的 profile** 跑同一张单只给一句「逐条相符」。差异的根因是纪律只存在于面板版本里，不在仓库默认值——见下一节 |
| **纪律进仓库默认值（0.2.1，2026-11-06）** | `prompts/team/{communication,scope,delivery}.md` 三个默认值里各带一段 `--- VERIFICATION-DISCIPLINE-V1 ---`（合计 1 572 字符），`package.json` 的 `files` 含 `prompts`，所以 git 安装直接拿到。装 `#v0.2.0` 与 `#v0.2.1` 两个 ref 对比实跑证明 `v0.2.0` 里根本没有这段——这也是把版本发到 0.2.1 的原因。代价付在 `tests/model-surface.spec.ts` 的字符预算上（编排 58 551、工人 40 341，余量原本只有 449/159，预算提到 61 000/42 500 并把基线记在注释里） |
| **桌面应用自建自装首跑（0.2.1，2026-11-06，这一版）** | 本机 `node build-portable.js` → 368 MB 外壳 → `install.cmd -Force`（退出 0）→ 双击路径首跑。`app.log` 关键行：`starting 0.2.1 \| Electron 44.7.0` → `[health] no orphan backend found` → `[preflight] git: C:\Program Files\Git\cmd (known path)` / `gh: … (where gh)` / `pwsh: … (where pwsh)` → `[backend] cwd: <checkout>` → `[ready] backend URL: http://127.0.0.1:13393/ (10379ms)` → `[ui] document.title: DeepSeek Harness`。**未设** `DSH_HOME`/`SUPERAGENT_STATE_DIR`，全程无 EPERM。应用拉起后端的 `/orchestrator/api/state`：200、`setup.problem=null`、`load={"running":0,"queued":0,"maxWorkers":3}`、**12 个 health 部件逐个 ready**。同时**推翻**了 12.1 原来的三条旧"实测"（500 MB / `bundled tools` / 标题 `Superagent` 与带 token 的 `[ready]` 行），已在上面几行就地改正 |

### 12.2 还没验证的（写了做法，但没人跑完）

| 项 | 说明 |
| --- | --- |
| 后端自愈（失败页 →「重新启动后端」） | 只有旧机器（受限令牌）的记录。复跑判据：杀掉应用拉起的后端 PID → 窗口切到 `backendDownHtml` → 人工点按钮 → 6 秒内 `[ready]`。这一版没有把正在服务的面板后端杀掉，所以未复验 |
| 安装后整体搬家 | 设计上支持（重跑 `install.cmd -Force` 重写 `paths.json`/快捷方式），但没有实跑过 |
| winget id 与 `--scope user` | 当前无网络/不能提权，未验证；以官方安装器的"当前用户"选项为准 |
| 面板设置页交互 | 面板**渲染**已验证（这一版由 `document.title: DeepSeek Harness` 与 API 应答证明；旧记录的截图在 `<checkout>\windows-app\verification\`，该目录被 gitignore，本机没有）；Sources/Policy/Execution/Prompts 的逐项点击与保存流程未在应用窗口里逐项走过（字段与语义依据源码/上游文档） |
| 应用构建的可重复性 | 本机 2026-11-06 自建成功（`node build-portable.js` → 368 MB 外壳 → 装好能跑），并撞到 `npm install` 不下载 Electron 二进制那个坑（见 3.6）。**在一台干净机器上从零构建仍未验证**，尤其是没有本地 Electron 缓存、也没有 npmmirror 可达时的路径 |
| **登录自启的真实一次（可选，仅 CLI 无人值守路径；不阻塞交付）** | `install-guard-startup.cmd` 与 guard 循环的**逻辑**已实测（tick 四态、去重、pid 单实例、`disabled` 与 `--respect-stop` 都验过），但"注销→重新登录后自动拉起"这一步**未实测**，原因两条：①安装器必须由操作员本人双击并注销重登——自动化上下文里计划任务注册和"启动"文件夹写入都被系统拒绝；②应用内路径下 guard 与插件共用 `stateDir`/插件锁，应用持锁期间它起的后端无法激活插件，且它的 `status` 只看 CLI 的 `service.pid` 与 3082，监督不到应用后端。因此它只在 CLI 无人值守路径需要，未实测不影响官方应用路径的交付判定。若日后要在 CLI 路径验收，判据是：`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\DSH-Superagent-Guard.vbs` 存在，且重新登录后 `watchdog.log` 出现一行 `GUARD loop started pid=… interval=15m` |
| **纪律注入的耐久性（已收口，revision 8）** | 仓库默认值与本机面板覆盖层现已一致。2026-11-07 复跑 `GET /orchestrator/api/prompts`（带 `x-orchestrator-request: 1`；真实 stateDir 被 `superagent.lock` 占用，起后端报 `Lock file is already being held`，故以同字节副本起只读后端复核）：`current` = **`revision 8`**、`source: panel`、`savedAt 2026-11-07T06:01:34.208Z`、`previousRevision 7`；`communication` / `scope` / `delivery` 三节**都含 `VERIFICATION-DISCIPLINE-V1`、都不含旧标记 `MAINTAINER-DISCIPLINE-V1`**（长度 10 101 / 2 743 / 5 309，`defaults` 为 10 093 / 2 738 / 5 305——差值只来自换行风格：覆盖层用空行分段，默认值用空格连接，标记本身一致）。`skills` 仅 `orchestration-discipline`，`overrides` 为空。早先的 `revision 5` 覆盖层已在面板重存。<br>早前记录的已知差异已消失：`current` 的 scope 段**不再带**「先找 `docs/agent-contract.md`」这条虚构锚（实测 `false`），与仓库默认值一致。复跑判据：同一接口比对 `current.config.<节>` 与 `defaults.<节>`，两处都含 `VERIFICATION-DISCIPLINE-V1` 且都不含 `MAINTAINER-DISCIPLINE-V1` 即为生效 |

### 12.3 已知风险 / 运维注意

- **不注册 Windows 服务**：后端以操作者用户身份运行。装了 §8.6 的 guard 启动项之后，**登录**会把后端带回来；但它是会话启动项而不是服务——**开机后停在登录界面时它不会跑**，注销即停。没装启动项时，重启机器后仍需双击应用或执行 `start`。值守管的是 CLI 路径那份后端，不会替你打开应用窗口。
- **值守不是安全边界**：`alerts.log` 里会带完整状态 JSON（含仓库名、PID、日志路径）。它写在 `%APPDATA%` 下、当前用户可读，与本项目其余护栏同级——防误操作，不防同用户的其他进程。
- **停止依赖 hook**：`stop` 通过命名管道通知服务，服务必须由**当前版本**的 `start` 启动（带 `--import scripts\dsh-service-hook.mjs`）。用手工命令或旧脚本起的实例，`stop` 会明确报"无法通知"而不是强杀；用 `start` 重启一次即可恢复可停性。
- **命名管道是本机同用户可见的**：同用户的任意进程都能发 `stop`。和本项目其它机制一样，这是护栏，不是安全边界。
- **3082 可能被别的 DSH 实例占用**：若某个 dsh 进程占了 3082 但没装插件（`/` 返回 401、`/orchestrator/api/state` 返回 404），CLI `start` 会绑定失败、`status` 退出 1。先停掉那个进程，或给 superagent 换端口（4.3/4.5）。
- **飞书未启用**：`dsh-superagent-feishu` 保持 disabled；启用需要另配 `lark-cli.cmd`，不在本手册范围。

---

## 13. 附录：路径、命令、升级与回滚（外壳相关条目为历史）

### 13.1 路径速查

> 标「已移除」的行是桌面外壳的历史路径，仅用于解释旧日志/旧安装；标「值守」的行仍由插件脚本使用。

| 名称 | 路径 |
| --- | --- |
| 本 checkout（源码 / 插件） | `<checkout>`（独立历史，自 0.1.0 起为公开基线；与上游的差量与升级流程见 `WINDOWS-DELTA.md`，基线 SHA 在 `.upstream-baseline`） |
| 桌面应用源码（已移除） | 原 `<checkout>\windows-app\`（2026-11-07 删除；历史随公开基线归档） |
| 安装根目录（默认，已移除） | `%LOCALAPPDATA%\Programs\Superagent`（历史；`install.cmd -Root` / `SUPERAGENT_HOME` 已不存在） |
| 已安装的 exe（已移除） | 原 `<安装根目录>\Superagent.exe`（历史） |
| 自包含工具（可选，已移除） | 原 `<安装根目录>\tools\git\cmd`、`tools\gh\bin`（历史；当前直接用 PATH 上的 git/gh） |
| 安装记录（已移除） | 原 `<安装根目录>\config\paths.json`（历史） |
| 桌面 / 开始菜单快捷方式（已移除） | 原 `%USERPROFILE%\Desktop\DSH-Superagent.lnk` 与开始菜单同名项（历史；2026-11-06 读回一致） |
| 便携启动器（已移除） | 原 `<checkout>\windows-app\启动 DSH-Superagent.cmd`（历史） |
| 应用用户数据（外壳已移除） | `%APPDATA%\Superagent\`：外壳的 `app.log`、`backend.log`、`runtime.patch.yml` 为历史证据；`watchdog\` 仍见下一行 |
| 值守日志与状态（值守） | `%APPDATA%\Superagent\watchdog\`（`watchdog.log`、`alerts.log`、`last-state.json`；见 8.6） |
| 应用用户数据（回退，已移除） | 原 `<exe 所在目录>\user-data\` → `%TEMP%\superagent-user-data`（历史） |
| DSH home | `%USERPROFILE%\.dsh` |
| profile | `%USERPROFILE%\.dsh\profiles\superagent` |
| 机器配置 | `%USERPROFILE%\.dsh\profiles\superagent\cordis.patch.yml` |
| 状态目录 | `<you>/.dsh/state/superagent` |
| 工单目录 | `<you>/.dsh/state/superagent/work`（默认） |
| 模型凭据 | `%USERPROFILE%\.dsh\.credentials.yaml`（refs：`OPENCODE_GO_API_KEY`） |
| DSH 全局安装 | `%APPDATA%\npm\node_modules\@deepseek-ai\dsh` |
| CLI 日志/控制 | `<checkout>\.artifacts\` |
| DSH 启动诊断 | `%USERPROFILE%\.dsh\logs\startup-*.log` |
| 智能体 gh 配置 | `%USERPROFILE%\.dsh\state\superagent\gh-config`（由插件通过 `GH_CONFIG_DIR` 使用；`gh-agent.cmd` 只是登录入口） |
| 本地 clone（worktree 基座） | `%USERPROFILE%\src\widgets`（按实际仓库名） |
| **Mode A 收件目录** | `%USERPROFILE%\.dsh\state\superagent\inbox\`（投放处）；`inbox\done\` = 归档区 + 回信 `<文件>.reply.md` |
| **外层值守状态与日志** | `%APPDATA%\Superagent\watchdog\`（`last-state.json`、`alerts.log`、`watchdog.log`） |
| **值守停摆标记** | `%APPDATA%\Superagent\watchdog\disabled`（建了这个文件，guard 循环在下一个 tick 自己退出） |
| **登录自启启动项** | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\DSH-Superagent-Guard.vbs`（由 `install-guard-startup.cmd` 生成；删掉即卸载） |

### 13.2 命令速查

```powershell
$checkout = 'C:\src\dsh-superagent'                  # ← 换成你的 <checkout>
$root     = "$env:LOCALAPPDATA\Programs\Superagent"  # ← 或 -Root 指定的安装根目录

# --- 构建/更新插件 ---
Set-Location $checkout
& (Get-Command pnpm.cmd).Source install
& (Get-Command pnpm.cmd).Source build

# --- 安装/检查 DSH ---
& 'C:\Program Files\nodejs\npm.cmd' install -g '@deepseek-ai/dsh@0.2.1-rc.3'
& "$env:APPDATA\npm\dsh.cmd" --version

# --- link 插件（已做过就不要再做；路径用正斜杠）---
& "$env:APPDATA\npm\dsh.cmd" plugin --profile superagent add "link:D:/src/dsh-superagent"

# --- 智能体账户 ---
& "$env:USERPROFILE\bin\gh-agent.cmd" auth login --hostname github.com --git-protocol https --web
& "$env:USERPROFILE\bin\gh-agent.cmd" api user --jq .login

# --- 启停（CLI 路径）---
& "$checkout\scripts\dsh-superagent.cmd" start
& "$checkout\scripts\dsh-superagent.cmd" status
& "$checkout\scripts\dsh-superagent.cmd" stop

# --- 外层值守（可选，仅 CLI 无人值守路径；应用内路径由应用启停宿主）---
# 手动跑一个 tick（排障首选；脚本恒退出 0，判读看 %APPDATA%\Superagent\watchdog\）
& "$checkout\scripts\dsh-superagent-watchdog.ps1"
# 登录自启：请**本人双击**这个文件（自动化上下文写不动 Startup 文件夹）
#   $checkout\scripts\install-guard-startup.cmd
# 立刻启动 guard 循环（不等下次登录）
& "$checkout\scripts\dsh-superagent-guard.ps1"
# 停掉循环：New-Item "$env:APPDATA\Superagent\watchdog\disabled" -ItemType File
# 看告警：Get-Content "$env:APPDATA\Superagent\watchdog\alerts.log" -Tail 20

# --- Mode A 派单 / 收结果 ---
$inbox = "$env:USERPROFILE\.dsh\state\superagent\inbox"
Set-Content "$inbox\my-task.md" -Encoding utf8 -Value 'title: …'   # 正文写任务与可验证判据
Get-Content "$inbox\done\my-task.md.reply.md" -Raw                  # 一分钟后：acknowledgement + reply
Invoke-RestMethod 'http://127.0.0.1:3082/orchestrator/api/state' -Headers $h |
  Select-Object -ExpandProperty health | Select-Object inbox, github, evals

# --- 管理 API ---
$h = @{ 'x-orchestrator-request' = '1' }
Invoke-RestMethod 'http://127.0.0.1:3082/orchestrator/api/state' -Headers $h

# --- 端口占用 ---
Get-NetTCPConnection -LocalPort 3082 -ErrorAction SilentlyContinue | Select-Object LocalAddress,State,OwningProcess

# --- 应用壳构建/安装命令已随 windows-app 移除；历史随公开基线归档 ---
```

### 13.3 升级

> **本仓库是一条独立历史**（2026-11-06 重建，自 `0.1.0` 起为公开基线）。`upstream` 远端仍指向官方原型，但**没有共同祖先**，所以升级不是 `git merge`，而是"取上游 diff、按 `WINDOWS-DELTA.md` §3 的 L1 清单逐处移植、把新基线 SHA 写回该文件"。完整流程见 `<checkout>\WINDOWS-DELTA.md` §5，这里是操作摘要。

1. 等到没有执行器正在干活（面板 Execution 里没有 working 的工单）。
2. 备份数据库：复制 `<stateDir>\orchestrator.sqlite` 到安全位置。
3. 更新 checkout 并重建：

   ```powershell
   Set-Location $checkout
   git fetch upstream
   git diff --stat (Get-Content .upstream-baseline) upstream/main   # 先看官方改了什么
   # 按 WINDOWS-DELTA.md §3 的清单逐处移植；移植后把新的上游 SHA 写入 .upstream-baseline
   & (Get-Command pnpm.cmd).Source install
   & (Get-Command pnpm.cmd).Source build
   & (Get-Command pnpm.cmd).Source typecheck
   & (Get-Command pnpm.cmd).Source vitest run tests/windows-port.spec.ts
   ```

   - `tests/windows-port.spec.ts` 是本项目的**契约测试**（垫片形式、`GH_CONFIG_DIR`、`written()` 识别等），必须全绿；其余 POSIX-only 测试在 Windows 上失败属预期（见 `WINDOWS-DELTA.md` §4）。
   - 升级后**重新生成 `worker-bin`**：删掉 `<stateDir>\worker-bin` 下的旧垫片，或让 setup 重跑（标记格式变了会触发 `foreignFile`）。
   - ⚠️ 不要动 profile 的 `cordis.patch.yml`，也不要动 `stateDir` 里的数据。
4. 不再有应用壳打包步骤；插件升级按第 3 步 `pnpm build` 后重启即可。
5. 重启后端（应用 Ctrl+Shift+R，或 CLI `restart`），再看 `status`。
6. 如果有段落在面板显示 **Default updated**，逐段决定保留还是用新默认。

> 降级注意：被新版本迁移过的数据库，旧版本打不开；回滚必须先恢复第 2 步的备份。

### 13.4 卸载 / 回滚

```powershell
# 1) 停止后端
& "$checkout\scripts\dsh-superagent.cmd" stop

# 2) 从 profile 里移除插件（不会删 checkout）
& "$env:APPDATA\npm\dsh.cmd" plugin --profile superagent remove dsh-superagent

# 3) 桌面外壳已移除，不再需要删除安装目录/快捷方式
#    如曾在旧机器上装过外壳，可手动删：%LOCALAPPDATA%\Programs\Superagent 与两个快捷方式

# 4) 可选：删数据/账号配置（确认不再需要再删）
#   %APPDATA%\Superagent                     ← 应用日志/窗口状态
#   %USERPROFILE%\.dsh\profiles\superagent   ← profile（含 cordis.patch.yml）
#   %USERPROFILE%\.dsh\state\superagent      ← stateDir：数据库、垫片、工单目录
#   %USERPROFILE%\.dsh\state\superagent\gh-config ← 智能体账号的 gh 登录
#   %USERPROFILE%\bin\gh-agent.cmd、prepare-ticket.cmd
```

- 如曾装过外壳：安装根若用 `-Root` 或 `SUPERAGENT_HOME` 改过，删那个目录（历史条目）。
- `plugin remove` 的具体子命令名以 `dsh plugin --help` 为准（本手册未在 Windows 上实测该步）。
- 卸载前先 `stop`，并确认没有 node 进程还在使用 `stateDir`。
- 回滚代码：`git checkout <旧提交>` 后按 13.3 重建 + 重装；数据库需用升级前的备份。

### 13.5 参考（外壳文档已删除）

- 本适配版的**权威差量清单与升级流程**：`<checkout>\WINDOWS-DELTA.md`（含 §3.4 E2E 暴露的两处缺陷、§3.5 batch 包装器参数传递）
- **应用布局与路径解析**：外壳已移除，历史随公开基线归档。
- 本适配版的远程仓库（可引用）：`origin` = <https://github.com/ReSerendipity/dsh-superagent>；`upstream` = <https://github.com/deepseek-ai/dsh-superagent-prototype>；`reference` = <https://github.com/Check-mj/dsh-superagent-windows>（Windows 层的起步来源）
- 契约测试：`tests/windows-port.spec.ts`（batch shim + PATH 剥离 + `.cmd` 包装器精确传参，2 条）
- 文档基线：`README.md`、`SETUP.md`、`docs/000`–`docs/008`（本 checkout 内）
- 部署与排障原文：`docs/006-deployment.md`
- 每条配置的**预期行为**以源码为准：`src/deployment.ts`、`src/infra/environment.ts`、`src/executor/dsh.ts`、`src/app/sessions.ts`、`src/app/setup.ts`

---

> 本文件由 Windows 移植过程维护。仓库继承上游历史（本适配版独立维护，见 `NOTICE`）：移植改动集中在 `src/deployment.ts`（`stateDir` 校验、账号探测的 PATH/`GH_CONFIG_DIR` 注入）、`src/infra/environment.ts`（`.cmd` 命令 shim、`GH_CONFIG_DIR=<stateDir>\gh-config`、git 配置）、`src/app/setup.ts`（Windows 环境应用）、`scripts/dsh-superagent`（Windows 进程管理分支），以及新增的 `scripts/dsh-superagent.cmd`、`scripts/dsh-service-hook.mjs`、`windows-app\`（Electron 壳 + 安装器，2026-11-07 已移除）、`tests/windows-port.spec.ts`。其余行为与上游一致。
> 权威文档：差量清单与升级流程 [`docs/WINDOWS-DELTA.md`](WINDOWS-DELTA.md)；本文件是操作手册，第 11 节是摘要、第 12 节是验证状态。

### 应用打开后窗口是黑的（后端正常）——外壳已移除，历史问答

现象：标题栏正常、后端日志有 `[ready] backend URL`，但界面一片空白。原因是应用 userData 里的界面缓存损坏
（强制结束进程后偶发），与业务代码无关。

- **自动**：应用会在页面加载 12 秒后自检一次，发现空白就清缓存并重载一次；仍空白会给出提示页。
- **手动**：菜单「文件 → 修复界面卡住（清空缓存并重启）」。
- **彻底**：关闭应用后删除 `%APPDATA%\Superagent` 下的 `Cache`、`Code Cache`、`GPUCache`、`Local Storage`、
  `Session Storage` 目录再启动（会话与配置不在那里，不受影响）。

