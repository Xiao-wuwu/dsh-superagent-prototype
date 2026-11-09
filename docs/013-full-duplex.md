# 013 全双工交互（§4.1）对照

> 依据：官方《Super-agent 设计探索》§4.1「全双工交互」。原文要点：经典 ReAct Loop 在同步 `run()` 上阻塞；异步版让耗时调用**立即返回 Started**，后台完成后**作为一条新事件消息投递**回会话，并**可以主动终止**执行过长的后台命令。文章称该机制"已经在 DeepSeek Harness 中实现，但尚未默认开启"。

## 1. 机制映射：文章概念 → DSH 实现

| 文章 | DSH / 本 bundle 的对应物 | 位置 |
|---|---|---|
| 异步 `run()` 立即返回 Started | shell 工具带**前台上限**（5 秒），超过即转入后台作业并立即返回 | `cordis.patch.yml` 两个 preset：`timeoutMs: 5000, maxTimeoutMs: 5000` |
| 后台完成后作为新事件投递 | 作业结束以事件回到 Session；`job_output` / `job_list` 取回结果 | 同一 preset：`tool-jobs` `waitTimeoutMs: 5000, maxWaitTimeoutMs: 5000` |
| 主动终止过长命令 | `job_kill` | 同上（router preset 的允许名单也包含 job 工具） |
| 前台对话不被阻塞 | Router Session 只做交互与分派，命令同样 5 秒转后台；`noWait` 守卫还会对"想等 30 秒以上"的调用给出提示 | `src/app/sessions.ts` `noWait`、两个 preset |

**结论：命令侧（含 Router）已符合 §4.1，并且已经不是"未默认开启"状态**——bundle 显式把两个 preset 的前台预算压到 5 秒。这一点有契约测试锁定：`tests/bundle-patch.spec.ts` 断言 worker 与 router 的 `bash-sandbox`/`pwsh-sandbox`/`tool-jobs` 配置一致且为 5000；`docs/003-execution.md` 也写明了行为。

## 2. 两个真实缺口（如实记录）

### 2.1 子任务工具调用仍是同步的

§4.1 要求「耗时命令**与子任务**工具调用」都异步。实测当前 DSH 的 `@deepseek-ai/dsh-tool-subagent` **没有暴露 background 参数**（`lib/index.js` 中无 background 相关参数），模型调用 `subagent` 必须等子代理结束。DSH 内部确有"continuable background child"的实现痕迹（`dsh-subagent` 的注释与事件），但工具层未开放。

**决定**：不在插件层 hack（例如自己起后台轮询），因为那会和上游未来的同名能力冲突，也绕过了 DSH 的工具契约。记录为**上游依赖缺口**：等 `dsh-tool-subagent` 暴露后台模式后在 preset 里开启即可，bundle 改动会是几行配置。

### 2.2 空白托管 Session 的 `standard` 窗口

dsh-superagent 会在首轮前恢复 `dsh-superagent-router` preset；但在那之前，若有人在面板里开空白托管 Session 并发消息，它跑的是 `standard` preset（前台 60 秒、作业等待 30 秒）。`noWait` 守卫在这种状态下会给出提示（"pass timeoutMs of at most 30000, or run_in_background"），但**不是硬限制**。

**决定**：保持现状并记录。这是"用户绕过面板入口"的边缘路径；硬性收紧需要改 DSH 的 preset 默认值，属于上游范围。

## 3. 这一版改动

- `tests/bundle-patch.spec.ts`：把 router preset 的 5 秒预算从"与 worker 相等"升级为**显式断言**（`toEqual([{ timeoutMs: 5000, maxTimeoutMs: 5000 }])` 等），使 §4.1 的配置被单独锁定——上游若改动任一 preset 的预算，测试立刻失败。

## 4. 验收（这一版）

| 项 | 结果 |
|---|---|
| 命令侧异步是否开启 | ✅ 两个 preset 均为 5 秒前台 + 5 秒作业等待，契约测试锁定 |
| 结果是否以事件投递 | ✅ `job_output`/`job_list` 取回，作业结束事件唤醒会话 |
| 是否可主动终止 | ✅ `job_kill` |
| 子任务是否异步 | ❌ 上游 `tool-subagent` 未提供后台模式（§2.1） |
| Router 是否不被阻塞 | ✅ 同一 5 秒预算；边缘路径见 §2.2 |
