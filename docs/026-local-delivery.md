# 026 `mode: local` 交付形态：选入路径与默认值决策备忘

> **结论先行（2026-11-07）**：`mode` 的默认值仍是 `github`。这次只把 `mode: local` 的**选入路径**补成可交付形态（干净安装、`prepare` 为空时也能在本地交出分支与提交），默认值是否切换留待产品决定。

## 1. 现状与缺口

`mode: local` 早已可选（默认 `github`）：不装 GitHub Source、不探测 `gh`，工单从收件目录来，交付是 `agent/<工单短名>` 上的一次本地提交——**不 push、不开 PR**，回信给出分支与人工合并命令。

缺口在写链路：干净安装的 `executor.prepare` 默认是空串，工单目录被创建后**是空的**（没有 `.git`），worker 无法建分支、无法提交，P7-5…P7-7 不成立（P7-8 记录的就是这件事）。此前那几条靠操作员手写 prepare 配方撑绿。

## 2. 这一版落地的选入路径

判据只有一条，写在 `src/executor/local-workspace.ts`：**`mode === 'local'` 且 `executor.prepare` 为空白**。其余组合一律不动。

| 部署 | `prepare` | 新工单目录 |
|---|---|---|
| `github`（默认） | 空 / 有值 | 与改前逐字相同（空目录 / 操作员命令） |
| `local` | 有值 | 与改前相同：操作员的配方（本地基座 worktree / clone） |
| `local` | 空 | **内置本地工作区**：`git init -b main` → 仓库级占位身份 → `main` 上一个空基座提交 → `checkout -b agent/<工单短名>` |

三条不变量：

- **无远端**：命令集里没有 `remote` / `push` / `clone`，本地交付不是靠纪律保证的，是构造保证的。
- **占位身份**：仓库级 `user.name=dsh-superagent`、`user.email=superagent@localhost`，满足 worker 的 `user.useConfigOnly`，且不会借用操作员自己的 git 身份；不推送，所以它永远到不了 GitHub。
- **默认值不变**：`github` 部署没有新增任何准备动作，`Config.mode` 的 default 仍是 `github`。

边界要说清：没有基座仓库时，内置工作区产出的是**自包含仓库**（一次提交里是整份工作成果），人工可 `git show` / cherry-pick / 以无关历史合入；要对着**你自己的代码**改，仍按既有文档把 `prepare` 指向本地仓库（worktree 配方）。内置路径解决的是「干净安装也能交付」，不是「自动找到你的仓库」。

证据：`tests/local-workspace.spec.ts`（判据、命令集、真实 git 运行：分支名、基座提交、无远端、占位身份、后续 `commit -s` 带 `Signed-off-by: dsh-superagent <superagent@localhost>`）。

## 3. 默认值该不该变：建议**不变**

1. **会静默改写存量部署**。`mode` 在 profile 里没写时，默认值在解析时生效——把 default 改成 `local`，等于把所有没显式写 `mode` 的 GitHub 安装在一次升级后变成「不轮询、不 push、不开 PR」。这不是默认值微调，是伪装成默认值的破坏性迁移。
2. **local 还有两个显式门槛，默认翻转解决不了**。GitHub Source 必须 disabled（否则健康项出现 `github: starting`，见 P7-9），收件准入名单必须非空（否则投单被判 `not_a_member`、静默归档）。默认变 local 只会把「配置没做完」从一种可见的报错改成两种更难发现的空转。
3. **证据基数还不够**。这一版关闭的是 P7-8 的构造缺口（单测 + 真实 git 探针），但参考环境还没有一份「干净安装 → 写单 → P7-5…P7-7 全绿」的完整记录。改默认值等于向**所有新装用户**承诺这条链路，现有证据撑不起这个承诺。
4. **产品主线仍是 GitHub 交付**。PR 交付、回贴、评审是主路径；local 是明确的旁路。默认值是一种承诺，旁路不该默认替主路做主。

**什么条件下可以再议**：①补齐全量干净安装的 local 写单实测（P7 全表）；②profile 自举能自动写「GitHub Source disabled + 收件白名单非空」，或面板一键完成；③local 形态经过一个发布周期的现场使用。届时切换是一行默认值 + 验收表口径调整。

## 4. 若切换，影响谁

| 对象 | 影响 |
|---|---|
| 未显式写 `mode` 的存量安装 | 升级后变 local：GitHub 不再轮询、不再 push/开 PR；需显式写回 `mode: github` |
| `dsh plugin add` 新装 | `examples/profile.cordis.patch.yml` 不写 `mode`，新装直接落到 local，必须补「关 GitHub Source + 收件白名单」 |
| 显式写 `mode` 的用户 | 不受影响 |
| 验收与文档 | P7 变默认路径，P6（GitHub 链路）变选入路径；健康面默认没有 `github` 项 |
| 测试夹具 | 依赖默认 `github` 的 `testMachine` 与 P6 前置需要显式 `mode: github` |

## 5. 回滚

- **配置级（分钟级，推荐）**：profile 写 `mode: github`，重新启用 GitHub Source，在设置里填回仓库与 CLI。`stateDir`、`orchestrator.sqlite`、工单与 Session 都不迁移、不重写；只是部署判定换回 github。
- **代码级**：revert 改默认值的那一个提交即可；显式写了 `mode` 的实例两种版本下行为一致。
- **这一版功能级**：任何非空 `prepare` 命令都会覆盖内置工作区；或直接把 `mode` 写回 `github`。内置工作区产出的是普通 git 仓库，没有数据库/状态耦合，删掉目录即无残留。
- **回滚验收**：`GET /orchestrator/api/state` 的 `setup.accounts.repository` 非空、健康面 `github` 回到 `ready`，再跑 P6-1…P6-7。

## 6. 这一版不做

不改 `mode` 默认值；不自动关闭 GitHub Source；不自动写收件白名单；不改提示词；不触碰 push / PR 路径。
