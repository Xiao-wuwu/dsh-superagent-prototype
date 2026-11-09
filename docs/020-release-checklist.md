# 020 发布检查清单

## 一条命令先跑一遍

```powershell
pnpm release:check
# 或：powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release-check.ps1
```

自动检查：工作区干净且已推送、归属标注齐全（README/NOTICE/LICENSE/locale/package）、CHANGELOG 有该版本、
`typecheck`/`build`/全部测试、Release 资产与一行安装器的校验值一致。输出逐项 PASS/FAIL，任一失败退出码非 0。

`-SkipTests` 只跑结构检查（几十秒）；`-SkipOnline` 跳过 GitHub 部分（离线用）。


> 发布前逐项打勾；任一项不过就不发。每项都写明"用什么命令/看什么"。

## 0. 本次发布结果（公开基线 `v0.1.0`）

本清单用于公开基线 `v0.1.0`。发布结果以 Releases 页与 `pnpm release:check` 的输出为准；下面 A–F 的复选框只在「这一份已发布产物上真的跑过」的条目上打勾，没跑的保留空框并写明原因。

发布物是**插件 tarball**：`pnpm pack:plugin` 产出 `dist/dsh-superagent-<version>.tgz` 与 `.sha256`。桌面外壳已于 2026-11-07 整体移除，C 节、D 节中与 zip / `install.ps1` / `Superagent.exe` 相关的条目一律作废。

## A. 代码与测试

- [x] `pnpm typecheck` 通过
- [x] `pnpm build` 通过（`lib/` 已更新并提交；git 安装依赖构建产物）
- [x] `pnpm vitest run` 全绿（基线**截至 2026-11-07**：1258 passed / 48 skipped / 0 failed，共 1306；跑测命令与当天 HEAD 见本节提交）
- [x] 文档契约测试通过：`pnpm vitest run tests/docs.spec.ts`（编号连续、只链更早编号、本地链接可解析）
- [x] 工作区干净：`git status --short` 为空；`main` 与 `origin/main` 一致
- [x] **无参考环境绑定**：`pnpm vitest run tests/portability.spec.ts` 通过（全仓不得出现开发机绝对路径、用户名或旧 checkout 名）

## B. 归属与许可（不可移除）

- [x] `LICENSE` 仍是官方 MIT 原文（Copyright (c) 2026 DeepSeek Harness Team）
- [x] `NOTICE` 存在，列出新增部分与"上游实现即回退"的承诺
- [x] `README.md` 顶部归属横幅含上游仓库、MIT、版权
- [x] `locale/zh.json` 与 `locale/en.json` 的 `meta.description` 含上游与本构建两个链接与版权行（插件页会显示）
- [x] 桌面应用「帮助 → 关于 DSH-Superagent」含上游与版权（历史条目；外壳已移除，现由插件页 `locale/*.json` 的 `meta.description` 承担同类信息）

## C. 桌面产物（作废：外壳已于 2026-11-07 移除）

- [x] `node windows-app/build-portable.js` 产出 payload
- [x] 用 payload 打包 zip，并记录 SHA-256
- [x] 在**干净目录**跑包内 `install.ps1`：生成 `Superagent.exe` 与 `config\paths.json`
- [x] **含空格的安装路径**也要成功（例如 `D:\tmp\Path With Spaces`）；失败时安装器必须报错，不得只写 `paths.json`
- [x] 安装后快捷方式名为 `DSH-Superagent.lnk`；窗口标题 `DSH-Superagent`；关于框版本与发布版本一致
- [ ] 卸载/删除测试安装目录，确保未动真实安装与 `%APPDATA%\Superagent`——这一版没有重跑这一项（只验证了安装与含空格路径），发补丁版前补做

## D. Release 与一行安装

- [x] Release 说明含：非官方声明、上游归属、包含内容、安装命令、SHA-256、已知限制
- [ ] 资产齐全：`dsh-superagent-<ver>.tgz` 与 `.sha256`（唯一发布物；本文件其余勾选仍指已移除的桌面外壳）
- [x] 发布资产 digest 与本地 `sha256sum` 一致（GitHub API 会回传 digest）
- [x] `install.ps1` 里 `$checksums` 已写入本次发布的 SHA-256（历史条目；外壳已移除，该项作废）
- [x] 一行命令可用（或至少确认两条下载路径：`github.com/releases` 与 `api.github.com` 回退）（历史条目；外壳已移除，该项作废）
- [x] `irm … | iex` 后默认装到 `%LOCALAPPDATA%\Programs\Superagent`，无需管理员（历史条目；外壳已移除，该项作废）

## E. 运行状态（发布前最后一步）

- [x] 启动应用：`setup: null`、`runtime: ready`、`router: one Router Session`（这一版实测；`github` 健康项要配好 Source 后才出现，这一版是空配置所以未验）
- [x] 面板「介绍」页可打开，五个页面名称与说明正确
- [x] 设置 → 执行 → 控制回路与分片四个输入项可见、可保存
- [x] 多实例：`instances.ps1 -Action list` 正常；应用「文件 → 实例…」可打开（历史条目；外壳已移除，现由命令行多实例与 `lib/instances-view.js` 承担，见 `docs/015`）
- [x] 日志中有 `[instance]` 行与后端 URL；无未捕获异常

## F. 发布后

- [x] 仓库 About：描述、Topics（`dsh`、`deepseek-harness`、`super-agent`、`windows`）、Homepage 指向 Release
- [x] README 的 Release 链接可打开
- [x] 在 Release 说明里给出"如何回报问题"（Issues 链接）
- [x] 记录版本号与校验值到 `CHANGELOG.md`

## 回滚

发布后发现阻断问题时：

1. 不删除 Release，改为**编辑说明**标注问题并置 `prerelease`
2. 修复后发 `v0.1.1`：重新打包 tarball，并让 Release 资产与新 digest 一致
3. 已安装用户：重新安装 tarball 即可覆盖插件文件；状态目录与配置不受影响

## 发布执行步骤（照做）

```powershell
# 0. 确认要发布的版本与改动都在 main 上
git status --short            # 必须为空
git log --oneline -5

# 1. 全量彩排（12 项）——不绿就不要发
pnpm release:check

# 2. 打包插件 tarball（唯一的发布物；外壳已移除）
pnpm pack:plugin
#    产出 dist/dsh-superagent-<ver>.tgz 与 dist/dsh-superagent-<ver>.tgz.sha256
#    (Get-FileHash dist\dsh-superagent-<ver>.tgz -Algorithm SHA256).Hash.ToLower()

# 3. 不再有 install.ps1 校验表；release:check 直接比对 Release 资产 digest 与本地 tarball

# 4. 创建/更新 Release 并上传资产（用 API，oauth 缺 workflow 权限时 gh release create 会失败）
gh api repos/<repo>/releases -X POST -f tag_name=v<ver> -f name="DSH-Superagent v<ver>" --raw-field body="<notes>"
gh api --method POST -H "Content-Type: application/gzip" --input <tgz> "<upload_url>?name=dsh-superagent-<ver>.tgz"
gh api --method POST -H "Content-Type: text/plain" --input <sha> "<upload_url>?name=dsh-superagent-<ver>.tgz.sha256"

# 5. 再跑一次彩排，确认资产 digest 与本地 tarball 一致
pnpm release:check            # 全跑，只有全跑才可能打印 READY TO PUBLISH
#    只验在线资产时可用 pnpm release:check -SkipTests，结论会标 NOT VERIFIED（exit 2）

# 6. 人工确认（彩排覆盖不到的部分）
#    启动应用：setup 正常、面板「介绍」可打开、tarball 能在干净 profile 装好
```

> 若发布后发现问题：不改历史，发下一个补丁版本；旧 Release 可置为 prerelease 并在说明顶部标注原因。
