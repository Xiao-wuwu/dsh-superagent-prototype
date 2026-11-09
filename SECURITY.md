# 安全策略 — DSH-Superagent

## 报告漏洞

**不要通过公开 Issue 报告安全问题。**

请使用 GitHub 的私密漏洞报告入口：

```text
https://github.com/ReSerendipity/dsh-superagent/security/advisories/new
```

也可在仓库的 **Security** 标签页选择「Report a vulnerability」。

报告时请尽量附上：影响版本、复现步骤、影响范围、可能的修复方向。不要附真实凭据或他人数据。

## 适用范围

本文件适用于本仓自身的代码与随仓分发的制品（`lib/` 构建产物与插件打包脚本）。桌面外壳 `windows-app/` 已于 2026-11-07 移除，不再在范围内。

两点边界需要说清：

- 上游 [deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) 的 `src/core/**` 与本仓逐字节相同，属于上游代码；该层的漏洞请同时报告给上游项目，本仓负责跟进合并。
- 本插件以**完全权限**运行在操作者自己的机器上（主 Session 只读、执行器全量是产品设计），它的安全模型以「操作者信任本机」为前提；绕过这一前提的隔离类问题（例如工单之间的上下文越界、策略准入被绕过）在本文件范围内，操作系统级沙箱缺失不是漏洞。

第三方依赖的漏洞请报告给对应上游项目；本仓只负责升级到修复版本。

## 响应承诺

个人维护项目，尽力在 7 天内确认收到、30 天内给出修复或缓解方案。复杂问题会先给临时缓解措施（例如在 README 标注已知风险）。

## 支持版本

只对默认分支与最近一个发布版本提供安全修复，更早版本请先升级。
