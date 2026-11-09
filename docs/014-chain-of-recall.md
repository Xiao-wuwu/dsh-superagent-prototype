# 014 链式召回（§3.3）对照

> 依据：官方《Super-agent 设计探索》§3.3「上下文组织」。原文要点：把上下文窗口当 Cache 管理，用 **Inline（近期必需的内联进窗口）** 与 **Spill（超出预算的留在窗口外，只留引用/摘要）**；把 Inline & Spill 一致地应用到 Trigger / Thread / Worker Session 等对象后，得到**链式召回**——每次召回的对象都内联**下一跳关联对象的 ID**，模型顺着引用图逐跳展开。

## 1. 对象图与跳转（本适配版 的实现）

```
Trigger ──thread──▶ Thread ──tickets──▶ Ticket ──transcript──▶ Worker Session
   ▲                  │                    │
   │                  │                    ├──trigger_id──▶ Trigger
   │                  │                    └──decision_id──▶ Decision
   └──trigger_ids──── Decision ──ticket_id──┘
```

| 对象 | 内联的下一跳（id + 读取路径） | 位置 |
|---|---|---|
| Trigger | `thread`（线程键）、`read: trigger/<id>`；若带处置：`decision_id`、`delivered_to` | `src/app/cards.ts` `triggerCard` |
| Thread | `thread`、`tickets`（订阅它的工单 id）、`read: thread/<key>` | `threadCard` |
| Decision | `thread`、`trigger_ids`、`ticket_id`、`read: decision/<id>` | `decisionCard` |
| Ticket | `trigger_id`、`decision_id`、`threads[]`（线程键）、`transcript: ticket/<id>/transcript`、`assignment`/`assignments`/`inputs`/`result` 路径 | `ticketDetails` |
| Worker Session | 通过 `ticket/<id>/transcript` 与 `ticket/<id>/message/<n>` 读取，归属由 `workerSessionId(ticketId)` 决定 | `src/app/resources.ts` |

**结论**：§3.3 的"每次召回内联下一跳 ID"在本适配版 中**已闭环**——每一类对象卡片都同时给出下一跳的**标识符**和**读取路径**，模型不需要把全量历史塞进窗口，可以按需逐跳展开。缺口不在对象图，而在"模型是否知道该沿图走"（见 §3）。

## 2. Inline 与 Spill 的落点

| 操作 | 本适配版 的实现 |
|---|---|
| Inline 摘要与 ID | 每张卡片只给 `preview`（前若干字符）、状态、时间与下一跳 ID |
| 超长内容 Spill | 文本类资源带 `offset`/`limit` 分页（`newestPage` / `textPage`），完整内容留在存储里，按需再读 |
| 统一上限 | DSH 层 `spill-policy`（`maxInlineTokens`）与 `spill-local` 负责把超预算的工具输出落盘并留引用 |

## 3. 已知缺口

1. ~~图本身是隐式的~~：**已补**。`prompts/shared.md` 末尾新增一段，把这条引用链写成规则（trigger→thread→tickets→ticket→transcript，以及 decision 的反向引用），并要求「用卡片给出的 `read` 路径逐跳展开，而不是索取全部历史」。体积受 `tests/model-surface.spec.ts` 的按角色预算约束，加完仍在预算内。
2. **没有自动多跳抓取**：文章强调"按需展开"，这是有意的——不做自动预取，避免把窗口塞满；保持现状。
3. **Inline 预算未按角色区分**：目前卡片预算统一（`preview` 长度固定），文章建议按"下一步很可能用到"分级。属优化项，非缺陷。

## 4. 这一版改动

- `tests/chain-of-recall.spec.ts`：锁住这条链的两条不变量——① 卡片内联了下一跳的 id 与读取路径；② **卡片给出的 id 与它给的读取路径指向同一个对象**（`read` 的最后一段等于它命名的 id）。上游若改动任一卡片字段，测试立刻失败。

## 5. 验收（这一版）

| 项 | 结果 |
|---|---|
| Trigger→Thread 可跳转 | ✅ `thread` + `read` |
| Thread→Ticket 可跳转 | ✅ `tickets` + `read` |
| Ticket→Worker Session 可跳转 | ✅ `transcript` / `assignment` / `result` 路径 |
| Decision 双向可跳转 | ✅ `thread` / `trigger_ids` / `ticket_id` |
| 是否内联下一跳 ID | ✅ 契约测试锁定 |
| 提示词是否描述这张图 | ✅ 已补（`prompts/shared.md`），受体积预算约束 |
