# Skills

本目录是**产品的一部分**：插件把这两个 skill 作为 worker 的运行时能力随包发布（`package.json` 的 `files` 白名单包含 `skills`），安装后由 DeepSeek Harness 加载。它们不是维护者的运维 skill，因此正文保持插件需要的英文表述，索引由本文件承担。

| Skill | 用途 | 触发场景 |
|---|---|---|
| [`dsh-superagent-github/SKILL.md`](dsh-superagent-github/SKILL.md) | 用 `gh` 读 GitHub issue / PR / 评审 / CI，并通过 `orchestrator_read` 取上下文快照 | worker 处理 GitHub 来源的工单时 |
| [`dsh-superagent-feishu/SKILL.md`](dsh-superagent-feishu/SKILL.md) | 以机器人身份读飞书消息、话题、嵌套转发、附件与文档 | worker 处理飞书来源的工单时 |

口径：

- 新增 skill 一律 `skills/<kebab-case>/SKILL.md`，frontmatter 必填 `name` 与触发导向的 `description`；复杂 skill 可带 `references/`、`scripts/`、`assets/`。
- 这里只放**随插件发布**的运行时 skill；维护者自己的 agent 运维 skill 不属于本仓，不要放进本目录。
- 改动 skill 会改变已安装实例的实际行为，按 `CONTRIBUTING.md` 的验证要求跑全量测试。
