# 贡献指南 — DSH-Superagent

## 提交前

1. 读根 `README.md` 与 [ARCHITECTURE.md](ARCHITECTURE.md)，先弄清组件边界再改代码。特别是一条硬边界：**`src/core/**` 与上游逐字节相同，领域引擎不改**；改动集中在平台层、面板、文档与测试。
2. 提交必须带 DCO 签名：`git commit -s`，身份用 GitHub noreply 邮箱。DCO 只要求至少一行 `Signed-off-by` 与作者邮箱一致；历史上偶有多余的同一作者签名，不影响门禁，属观感问题，不改写历史。
3. 跑本仓的测试与检查命令；失败不隐藏、不静默跳过：

   ```sh
   pnpm install
   pnpm typecheck
   pnpm vitest run        # 全量基线；tests/service-script*.spec.ts 偶发并发抖动时单独重跑该文件复核
   pnpm release:check -SkipOnline   # 离线跑结构、构建一致性与测试；在线检查被跳过时结论是 NOT VERIFIED（exit 2），不是 READY
   ```

4. `lib/` 是入库的构建产物且必须与新鲜构建一致：改了 `src/` 之后先 `pnpm build` 再提交。
5. 不提交密钥、token、连接串与本机绝对路径；构建产物默认不入库，唯一例外是第 4 条要求的 `lib/`。`local/` 与根 `AGENTS.md` 不入库。

## Pull Request

描述写清四段：

- **改了什么**
- **为什么改**
- **怎么验证**（命令、截图、日志）
- **哪些没做 / 已知限制**

改动涉及发布链、安装形态（`package.json` 的 `files` 白名单 / `lib` 打包）或依赖清单时，在描述里单独说明影响面。

## 代码风格

以仓库根的 `.editorconfig` 为准；提交前确认没有引入 CRLF 或制表符混用。

## 分支与合并

功能开发走 `feat/*`、`fix/*`、`ci/*`、`chore/*` 分支，完成后合入 `main`。

## 发布到 npm（runbook）

发布形态与 Git 安装并存：`git+https://…#<commit>` 与 `@reserendipity/dsh-superagent@<version>` 是两条来源，必须指向同一次提交、同一个版本号。**只有 `npm view @reserendipity/dsh-superagent@<version>` 能返回该版本之后**，README 才可以写 `dsh plugin add @reserendipity/dsh-superagent`；在此之前不得宣传「按名字安装」。（`0.1.0` 已满足该条件并写入 README。）

### 版本规则

- 一个版本号只能发布一次，已发布内容不可覆盖；任何改动都要递增版本。`package.json` 的 `version`、`CHANGELOG.md` 的段头、`v<version>` tag 三处必须一致。
- 已发布超过 72 小时的版本基本不能 `npm unpublish`；包名不会因为撤下而回收。发之前按「这一步之后不可撤回」对待。
- npm 版本必须与 Git tag 出自同一次提交：先合入 `main`，再在 `main` 的提交上打附注 tag 并推送，最后从同一提交发布。

### 发布前的检查

在干净、已推送的 `main` 上：

```sh
pnpm install
pnpm typecheck
pnpm vitest run
pnpm release:check          # 在线；要求 HEAD == origin/main
npm pack --dry-run          # 看清单与体积，确认无源码/测试残留
```

`release:check` 的「本地打出的 .tgz 与 Release 资产 digest 一致」在同一个版本已经发过 Release 之后必然 FAIL（打包内容改过就不再是那份资产）。这是预期行为：它拦的是「用旧资产冒充新构建」，不是故障；新版本要等新 tag 与新资产。

### 凭据与发布

- 需要 npm 账号的发布凭据：交互式 `npm login`，或在 CI 里用 `NODE_AUTH_TOKEN` / OIDC；建议账号开 2FA，token 用 Automation 类型。
- 本机 `~/.npmrc` 的 registry 是 npmmirror，**不能**用它发布；`package.json` 的 `publishConfig` 已把 registry 固定到 npm 公共源，命令里也可显式写。
- CI 发布可加 `--provenance`（需要 OIDC 身份）留下可核对的构建来源；本机发布没有 provenance。

在 `main` 的干净 checkout、版本已提交并推送之后：

```sh
npm publish --registry https://registry.npmjs.org/
```

`prepack` 会自动跑 `pnpm build`，发出的 `lib/` 一定是当前源码的构建；`publishConfig.access` 为 `public`，无需额外参数。

### 发布后验证

刚发布的版本有一个可见的滞后：pnpm 11 起默认启用 `minimumReleaseAge`（默认 1 天），成熟期内的版本不会被裸包名解析到，所以按裸包名安装拿到的是上一个成熟版本，**这不是发布失败**。要验证新版本本身，安装与核对都用显式版本号 `@reserendipity/dsh-superagent@<version>`。

```sh
npm view @reserendipity/dsh-superagent version dist.tarball dist.integrity --registry https://registry.npmjs.org/
npm view @reserendipity/dsh-superagent@<version> dist.integrity --registry https://registry.npmjs.org/
```

`dist.integrity` 只用于校验 npm 上这个版本自身的下载完整性，**不要**拿它和本地 `dist/dsh-superagent-<version>.tgz` 的 `sha256` 对比：npm 的包由 npm 打包器生成，Release 资产由 `pnpm pack` 生成，两者**内容一致但字节不同**（`0.1.0`：npm 431.1 kB，Release 432,086 B）。核对应以解包后的文件清单与内容为准。npmmirror 有同步延迟，用 `--registry https://registry.npmmirror.com` 复查前先等一段时间。

### 两条来源的对齐

- `v<version>` tag、`package.json` 的 `version`、npm 上的版本三者相同，且出自同一次提交。
- README 同时给出 npm 包名与 Git 地址；只有 `npm view @reserendipity/dsh-superagent@<version>` 能返回该版本，才可写「按名字安装」。
- 插件运行时只认 `lib/`，两条来源装出来的行为必须一致；发版后对比 `npm pack` 出的 `.tgz` 与 Release 资产的文件清单与内容（打包器不同，字节不必相同）。

## 行为准则

参与本项目即表示同意遵守 [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)。
