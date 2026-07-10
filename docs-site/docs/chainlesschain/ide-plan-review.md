# IDE 计划审阅与共享会话索引（Plan Review & Session Index）

> **版本: IDE gap-analysis 本轮实施（2026-07-10）| 状态: ✅ 双端代码已落地（随 VS Code > 0.37.9 / JetBrains > 0.4.52 的下一次插件发版上架；CLI 侧 review payload 随 > 0.162.156 的下一次 `cc` 发版）| VS Code + JetBrains 双端对齐 | agent-sdk 0.1.1（additive）| 13 项 JS 专项测试 + 10 项 JVM 纯核测试**
>
> 把 Claude Code 官方 IDE 插件的三块原生工作流补进 ChainlessChain IDE 插件：**① Plan Review 一等工作流**——计划不再只是聊天卡片，而是打开成**可编辑的 Markdown editor tab**，你在文档里写 inline comments，再一键批准/拒绝/要求修改/重新生成，批准与拒绝会把审阅快照写回会话转录供审计回放；**② 共享 IDE 会话索引**——VS Code 与 JetBrains 写同一份 `~/.chainlesschain/ide/session-index.json`，任一 IDE 的 `/sessions` 选择器都能看到并续接对方创建的会话；**③ `getActiveFile` 工具**——agent 直接读取活动文件、语言、脏状态与光标，不再从 selection 间接推断。

## 概述

此前 ChainlessChain IDE 插件的 Plan 模式只有聊天面板内的实时 plan 卡片：能看到被拦截的写操作和风险着色，能 Approve/Reject，但**无法对计划逐条批注**——想说"第 2 步别动 schema，第 4 步改成增量迁移"，只能在输入框里另起一段散文。对照 Claude Code 官方 VS Code 插件，Plan mode 打开的是完整 Markdown 计划文档，用户直接在文档中加 inline comments 再批准执行——这正是本轮补齐的第一块。

第二块是会话的跨 IDE 可发现性。此前 VS Code 与 JetBrains 各自管理自己的面板会话，`/sessions` 只能列出 CLI session store 里的条目；在 VS Code 里开的会话，换到 JetBrains 里就"不存在"。本轮引入**共享 IDE 会话索引**：两端在会话生命周期各节点（运行、等待审批、完成、出错、停止）把元数据写入同一份 index 文件，任一 IDE 的会话选择器都合并展示 CLI store + IDE index 两类来源，并支持**续接 / 重命名 / 删除**三个动作，为跨 workspace 搜索与后续 remote handoff 打基础。

第三块是 IDE MCP 工具面的补齐：新增 `getActiveFile`，agent 只需要"当前文件是哪个"时不必调 `getSelection` 拖回整段选中文本。

三块能力全部遵循插件一贯的**纯核 + 胶水**分层：格式化、归一化、合并等逻辑是零 IDE 依赖的纯模块（Node / 纯 JDK 各一份，行为对齐），可在无编辑器宿主下测试。

## 核心特性

### 1. Plan Review editor tab（计划审阅文档）

收到 agent 的 `plan_update` 事件后，插件把计划渲染成一份**真实的可编辑 Markdown 文档**并在编辑器打开（VS Code 开在侧栏 `Beside`；JetBrains 打开 Markdown editor tab）：

```markdown
# ChainlessChain Plan Review

- Conversation: 重构会话存储
- Session: sess-1a2b
- State: awaiting_approval
- Risk: medium (3)

## Review Actions

## Inline Comments

## Plan Items

1. edit_file: Update chat-view.js
   - id: p1
   - impact: medium
   - status: pending
   - comment:

## Reviewer Notes

-
```

- **inline comments**：每个计划条目自带 `comment:` 行，文档尾部有 Reviewer Notes 区——直接在文档里打字。
- **保护 reviewer 编辑**：agent 后续的 `plan_update` 只在你**没有改动**文档时同步刷新；一旦检测到人工编辑，插件不会覆盖你的批注（最新计划状态以聊天面板的 plan 卡片为准）。
- **只跟随活动 tab**：只有当前正在看的会话 tab 才会打开/刷新审阅文档，后台 tab 的计划保留快照、等切换回来时再打开，不抢焦点。

### 2. 四个审阅动作（批准 / 拒绝 / 要求修改 / 重新生成）

| 动作                | VS Code 入口（editor title 按钮 / 命令面板） | 语义                                                                                         |
| ------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Approve**         | `ChainlessChain: Approve Plan Review`        | 发送 `{type:"plan",action:"approve",review}`——解锁执行，**审阅快照写进会话转录**             |
| **Reject**          | `ChainlessChain: Reject Plan Review`         | 发送 `{type:"plan",action:"reject",review}`——丢弃计划不执行，快照同样入转录                  |
| **Request changes** | `ChainlessChain: Request Plan Changes`       | 把**整份审阅文档（含你的批注）**作为用户反馈 prompt 发回 agent，要求修订计划、保持 Plan 模式 |
| **Regenerate**      | `ChainlessChain: Regenerate Plan`            | 同上，但要求从头重新生成计划                                                                 |

JetBrains 侧对应计划卡上的 **Approve / Reject / Request changes / Regenerate** 按钮（`/approve`、`/reject` 斜杠命令等价）。反馈 prompt 明确指示 agent："Keep plan mode active. Do not execute write or shell tools until the revised plan is approved."——要求修改绝不会意外触发执行。

### 3. 审阅快照写回会话（审计与回放）

Approve / Reject 携带的 `review` payload 包含：动作、审阅时间、会话/对话 id、计划状态、条目数量，以及**截断到 24,000 字符的文档快照**（含你的全部批注）。CLI 收到后把它以

```
[PLAN REVIEW SNAPSHOT] action=approve reviewedAt=2026-07-10T… conversationId=…
<审阅文档全文>
```

的 system 消息形式插入继续执行的回合——**谁批准了什么计划、批注了什么，全部留在会话转录里**，`--resume` 回放与审计导出都能看到。VS Code 侧另在 workspaceState 保留最近 20 条审阅记录。

### 4. 共享 IDE 会话索引（跨 IDE 发现与续接）

- 两端写同一份 `~/.chainlesschain/ide/session-index.json`（**只存元数据，不存转录**——转录始终在 CLI session store，按 id `--resume` 续接）。
- 生命周期全覆盖：会话启动、等待审批、回合完成、出错、停止时各 upsert 一次状态。
- `/sessions` 选择器**合并两类来源**：`cc session list --json` + IDE index，按 id 去重（合并条目的 store 显示为 `file+ide:vscode` 之类），按 `updatedAt` 倒序；行内携带状态与 workspace，可跨 workspace 模糊搜索。
- **二步选择器：Resume / Rename / Delete**——选中会话后再选动作：
  - **Resume**（默认）：按 session id 续接。
  - **Rename**：改名写入 IDE index 作为 **title overlay**（合并时优先取 index 标题）——因此**只存在于 CLI store 的会话也能改名**（CLI 本身没有 rename 命令）。
  - **Delete**：`cc session delete --force` 删 CLI store + 索引剔除 + 清掉任何指向该会话的 tab resume id（防止下一条消息 `--resume` 到已删会话），有 modal 确认。
- 索引写入是 **best-effort**：索引失败绝不影响聊天功能。

### 5. `getActiveFile` IDE 工具（双端统一）

IDE 桥接工具从 4+1 个扩到 **5+1 个**（核心 5 个 + VS Code 条件暴露的 `executeCode`）：

| 返回字段     | 说明                         |
| ------------ | ---------------------------- |
| `file`       | 活动文件绝对路径             |
| `languageId` | 语言 id                      |
| `isDirty`    | 是否有未保存修改             |
| `cursor`     | 光标位置 `{line, character}` |

**不含选中文本**——agent 只需要"当前在哪个文件"时比 `getSelection` 更轻。宿主 facade 未实现时自动降级为从 `getSelection` 推导。

### 6. SDK / 协议契约同步

`@chainlesschain/agent-sdk` 的 `PlanControlInput` 已加上带类型的 `review` 字段（`PROTOCOL.md` 同步，SDK 版本 0.1.0 → **0.1.1**，纯增量），顶层 `snapshot` 字符串作为向后兼容简写。旧版 CLI 收到带 `review` 的 plan 控制会忽略多余字段，不破坏兼容。

## 系统架构

### 整体数据流

```
┌────────────────────────────┐  stream-json   ┌─────────────────────────────┐
│ VS Code / JetBrains 聊天面板 │◀──────────────▶│ cc agent 子进程（长驻双工）    │
│                            │  plan_update    │                             │
│ ┌────────────────────────┐ │───────────────▶│ PlanModeManager             │
│ │ Plan Review editor tab │ │                 │  拦截写/执行工具 → plan items │
│ │  (可编辑 Markdown 文档)  │ │ {type:"plan",  │                             │
│ │  批注 → Approve/Reject/ │ │  action,review}│ approve/reject:             │
│ │  RequestChanges/Regen  │ │───────────────▶│  [PLAN REVIEW SNAPSHOT]     │
│ └────────────────────────┘ │                 │  → system 消息入会话转录     │
│                            │                 └─────────────────────────────┘
│ 生命周期 upsert（best-effort）│
│      ▼                     │        ┌──────────────────────────────────┐
│ ~/.chainlesschain/ide/     │◀───────│ 另一台 IDE（VS Code ⇆ JetBrains） │
│   session-index.json       │  读+写  │ /sessions 选择器合并:             │
│  （metadata only, ≤200 条） │        │  cc session list --json + index  │
└────────────────────────────┘        └──────────────────────────────────┘
```

### Plan Review 状态机（插件侧）

```
plan_update(active, analyzing/awaiting_approval)
   │ 当前活动 tab？──否──▶ 暂存快照，tab 激活时再开
   ▼ 是
打开/同步 Markdown 审阅文档（Beside）
   │ 文档被人工编辑过？──是──▶ 不覆盖，暂存 pendingText
   ▼
用户动作:
   Approve/Reject ──▶ buildPlanReviewRecord（快照截断 24k）
   │                    └▶ sendEvent {type:"plan",action,review} ＋ 本地留档
   RequestChanges/Regenerate ──▶ buildPlanReviewFeedbackPrompt
                                  └▶ 作为用户消息发回（保持 Plan 模式）
plan state → approved / rejected ──▶ 不再同步文档
```

### 纯核 + 胶水分层（与 IDE 桥接一致）

| 端        | 纯核（无 IDE 依赖，可独立测试）                           | 胶水（碰编辑器 API）                                           |
| --------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| VS Code   | `chat/plan-review.js` / `chat/ide-session-index.js`       | `chat/chat-view.js` / `extension.js` / `vscode-facade.js`      |
| JetBrains | `PlanReview.java` / `IdeSessionIndex.java`（纯 JDK）      | `intellij/ConversationView.java` / `IntellijEditorFacade.java` |
| CLI       | `runtime/headless-stream.js`（review 解析 + system 注入） | —                                                              |

两份纯核**行为逐字段对齐**（同一 Markdown 模板、同一 24k 截断、同一 index schema），保证跨 IDE 读写同一文件不打架。

### session-index.json 数据格式

```jsonc
{
  "version": 1,
  "sessions": [
    {
      "id": "sess-1a2b", // CLI session id（--resume 用）
      "title": "重构会话存储",
      "ide": "vscode", // "vscode" | "jetbrains"
      "conversationId": "conv-3", // 面板内部会话 tab id
      "workspace": "C:\\code\\proj", // 首个 workspace 根
      "workspaceFolders": ["C:\\code\\proj"], // 最多 8 条
      "status": "running", // running | waiting_approval | errored | stopped | completed
      "mode": "default", // default | plan | …
      "createdAt": "2026-07-10T02:00:00.000Z",
      "updatedAt": "2026-07-10T02:31:07.000Z",
    },
  ],
}
```

写入协议：整文件原子替换（临时文件 + `rename`），文件权限 `0600`；upsert 按 id 合并（保留最早 `createdAt`、非空 title/workspace 优先），按 `updatedAt` 倒序裁剪到 **200 条**；未知 status 归一化为 `stopped`；损坏/旧格式（裸数组）容错解析。

## 配置参考

本轮功能**零新增用户设置**——随插件默认启用。相关常量与内部开关：

| 项                               | 值 / 默认                                        | 说明                                                          |
| -------------------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| 索引文件路径                     | `~/.chainlesschain/ide/session-index.json`       | 两端硬编码同一路径（与 IDE 桥接 lockfile 同目录）             |
| 索引容量                         | 200 条                                           | 超出按 `updatedAt` 倒序裁剪                                   |
| 审阅快照上限                     | 24,000 字符                                      | 超出截断并追加 `[review snapshot truncated: N chars omitted]` |
| 本地审阅留档（VS Code）          | workspaceState `chainlesschain.chat.planReviews` | 最近 20 条                                                    |
| editor title 按钮显隐（VS Code） | context key `chainlesschainPlanReviewActive`     | 活动编辑器是审阅文档时为 true（内部，勿手工设置）             |
| 会话索引开关                     | 扩展激活时 `enableSessionIndex: true`            | 内部注入；索引失败静默降级                                    |

### VS Code 新增命令（4 个）

| 命令 id                              | 标题                                 |
| ------------------------------------ | ------------------------------------ |
| `chainlesschain.plan.approve`        | ChainlessChain: Approve Plan Review  |
| `chainlesschain.plan.requestChanges` | ChainlessChain: Request Plan Changes |
| `chainlesschain.plan.regenerate`     | ChainlessChain: Regenerate Plan      |
| `chainlesschain.plan.reject`         | ChainlessChain: Reject Plan Review   |

四个命令同时出现在审阅文档的 **editor title 工具栏**（✓ / 💬 / ⟳ / ✕ 图标）与命令面板；聊天面板 webview 的 `planReviewAction` 消息与之等价。

### stream-json 协议（宿主接入方）

```jsonc
// 批准并携带审阅快照（reject 同形）
{ "type": "plan", "action": "approve",
  "review": {
    "action": "approve",
    "reviewedAt": "2026-07-10T02:31:07.000Z",
    "conversationId": "conv-3",
    "snapshot": "# ChainlessChain Plan Review\n…（含批注全文）"
  } }

// 向后兼容简写
{ "type": "plan", "action": "approve", "snapshot": "…" }
```

`review` 缺失或 `snapshot` 为空白时行为与旧协议逐字节一致（不注入 system 消息）。

## 性能指标

| 维度              | 表现                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| 审阅文档打开/刷新 | 编辑器内存文档一次全量替换；只在**活动 tab** 且**用户未编辑**时发生，后台 tab 零开销                          |
| 审阅快照体积      | 硬上限 24k 字符（截断），单条 system 消息，不随计划轮次累积                                                   |
| 索引读            | 打开 `/sessions` 时读一次 ≤200 条的 JSON 文件（毫秒级）                                                       |
| 索引写            | 仅生命周期转换点（启动/等审批/完成/出错/停止）各一次 upsert；临时文件 + 原子 `rename`，无后台轮询、无守护进程 |
| `getActiveFile`   | 一次 localhost HTTP POST，返回元数据不含文本——大文件/大选区场景显著轻于 `getSelection`                        |
| 聊天主链路        | 索引与审阅文档全部 best-effort try/catch 包裹，失败零影响                                                     |

## 测试覆盖

全部测试可在**无编辑器宿主**下运行（沿用 IDE 桥接的纯核测试策略）：

| 测试                                                                        | 数量 | 覆盖                                                                                                                                                                 |
| --------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vscode-ext-plan-review.test.js`                                            | 5    | 审阅文档渲染 / 快照截断与反馈 prompt / 审计 record / **ChatViewProvider 真流程**：从审阅编辑器批准并携带快照、批注作为修订 prompt 发回                               |
| `vscode-ext-session-index.test.js`                                          | 8    | 归一化-upsert-最新元数据保留 / metadata-only 落盘 / rename title overlay / 索引剔除 / 损坏与旧格式容错 / CLI+IDE 合并去重 / `--force` 删除 / `listSessions` 合并开关 |
| `headless-stream-plan.test.js`（新增 2 例）                                 | +2   | plan 控制的 review 解析 / **approve 后快照以 system 消息进入继续回合**                                                                                               |
| `vscode-ext-ide-bridge.test.js` / `vscode-ext-execute-code.test.js`（更新） | —    | 工具面 5+1（`getActiveFile` 计入）、`getActiveFile` 返回元数据且**不含**选中文本、真 CLI MCPClient 全链路                                                            |
| `PlanReviewTest.java`（JVM 纯核）                                           | 3    | Markdown 渲染 / record 截断 + planEvent 携带 / feedbackPrompt 语义                                                                                                   |
| `IdeSessionIndexTest.java`（JVM 纯核）                                      | 7    | 共享索引 upsert / rename overlay / 删除 / SessionList CLI+index 合并                                                                                                 |

整体回归：CLI vitest `vscode-ext-*` 61 文件 / 537 绿；JetBrains `./gradlew test` 254/0 + `PureLogicSmokeMain` 711/0；agent-sdk 构建 + 36/36（含真 CLI e2e）。

## 安全考虑

- **fail-safe 不越权执行**：Request changes / Regenerate 只发文本 prompt，且 prompt 明示"批准前不得执行写/Shell 工具"；Reject 丢弃计划、文件不动。批准语义与既有 plan 卡片一致，只是多带审计快照。
- **快照有界**：24k 字符硬截断，防止超大审阅文档撑爆会话转录或 LLM 上下文。
- **索引最小化**：`session-index.json` 只存元数据（id/标题/状态/workspace），**不存转录、不存 prompt、不存任何密钥**；文件权限 `0600`（与桥接 lockfile 同目录 `0700`）。
- **输入归一化**：status 白名单（未知归 `stopped`）、字符串字段 trim、workspaceFolders 上限 8 条、损坏 JSON 容错为空——恶意/损坏索引最多导致选择器少几条，不会崩面板。
- **原子写**：临时文件 + `rename` 整体替换，两个 IDE 并发写不产生撕裂读。
- **best-effort 隔离**：索引与审阅文档的所有异常都被吞掉（不影响聊天主链路），符合"辅助设施绝不拖垮核心功能"的插件惯例。
- **协议向后兼容**：`review` 为可选扩展字段，旧 CLI / 旧插件互通时静默忽略，无版本锁死。

## 故障排除

| 现象                                                 | 原因 / 处理                                                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 进入 Plan 模式但没弹审阅文档                         | 只有**当前活动的会话 tab** 才打开文档（设计如此，防抢焦点）；切到该 tab 即打开。计划已 `approved`/`rejected` 也不再打开 |
| editor title 上看不到四个按钮                        | 按钮仅在**活动编辑器是审阅文档**时显示（context key 控制）；点回审阅文档 tab，或直接用命令面板                          |
| 点按钮报 "plan review needs a running agent session" | 该会话的 `cc agent` 子进程已退出——先发一条消息拉起子进程，或用 New 开新会话                                             |
| 我在文档里的批注被 agent 的更新冲掉了                | 不会——检测到人工编辑后插件停止覆盖该文档；若看到刷新，说明你尚未编辑过。最新计划状态以聊天面板 plan 卡片为准            |
| `/sessions` 看不到另一台 IDE 的会话                  | 索引只在会话生命周期节点写入——功能上线**之前**创建且再未活动过的会话不在索引里；确认两端插件都已升级到含此功能的版本    |
| 同一会话在选择器里出现两次                           | 不应发生（按 id 去重）；若出现说明两条 id 不同——通常是旧版"匿名首会话"未持久化 id 的历史遗留，开新会话即收敛            |
| 改名后 `cc session list` 里标题没变                  | 设计如此——rename 是 IDE index 的 title overlay（CLI 没有 rename 命令）；选择器合并展示时优先取 index 标题               |
| 索引文件损坏 / 手工改坏了                            | 容错解析为空列表，功能自动降级为仅 CLI store；删掉 `session-index.json` 即重建                                          |
| `getActiveFile` 返回 null                            | 没有活动编辑器（焦点在面板/终端上）——先聚焦一个文件编辑器                                                               |

## 关键文件

### VS Code 扩展（`packages/vscode-extension/`）

| 文件                                        | 作用                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/chat/plan-review.js`                   | 纯核：审阅 Markdown 模板 / 快照截断 / 审计 record / 反馈 prompt              |
| `src/chat/ide-session-index.js`             | 纯核：索引读写、归一化、合并、原子落盘                                       |
| `src/chat/chat-view.js`                     | 胶水：`plan_update` → 审阅文档同步、`reviewPlan` 四动作、生命周期 upsert     |
| `src/chat/session-list.js`                  | `/sessions`：`cc session list --json` 与 IDE index 合并去重                  |
| `src/extension.js`                          | 4 个 plan 命令注册 + 活动编辑器变化时刷新 context key + `enableSessionIndex` |
| `src/vscode-facade.js` / `src/ide-tools.js` | `getActiveFile` facade 实现 + MCP 工具定义（含降级路径）                     |
| `package.json` / `package.nls*.json`        | 命令、editor/title 菜单、context key 声明与中英文案                          |

### JetBrains 插件（`packages/jetbrains-plugin/`）

| 文件                                                                                     | 作用                                                                                 |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `ide/PlanReview.java`                                                                    | 纯 JDK 核：Markdown / reviewRecord / planEvent / feedbackPrompt                      |
| `ide/IdeSessionIndex.java`                                                               | 纯 JDK 核：共享索引 record / upsert / 原子写                                         |
| `ide/SessionList.java`                                                                   | CLI 会话与 IDE index 的合并去重                                                      |
| `ide/intellij/ConversationView.java`                                                     | 胶水：审阅 editor tab 打开与同步、Request changes / Regenerate 按钮、生命周期 upsert |
| `ide/EditorFacade.java` / `ide/IdeTools.java` / `ide/intellij/IntellijEditorFacade.java` | `getActiveFile` 契约 + 工具定义 + IntelliJ 实现                                      |

### CLI / SDK（`packages/cli/`、`packages/agent-sdk/`）

| 文件                                 | 作用                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `cli/src/runtime/headless-stream.js` | plan 控制的 `review` 解析、24k 截断、`[PLAN REVIEW SNAPSHOT]` system 注入 |
| `agent-sdk/src/protocol.ts`          | `PlanControlInput.review` 类型（单一协议来源）                            |
| `agent-sdk/docs/PROTOCOL.md`         | 语言中立协议文档（JetBrains 等非 TS 宿主对齐用）                          |

## 使用示例

### 完整的计划审阅回路（VS Code）

```text
1. 聊天面板输入 /plan（或点 Plan 按钮）进入只读规划模式
2. 发需求："把会话存储从 JSON 迁到 SQLite"
3. agent 的写/执行操作被拦成计划 → 侧边自动打开 "ChainlessChain Plan Review" 文档
4. 在文档里逐条批注：
     2. edit_file: rewrite session-store.js
        - comment: 保留旧 JSON 读路径做一版迁移兼容
   并在 Reviewer Notes 写整体意见
5. 点 editor title 的 💬 Request Plan Changes → 整份文档（含批注）发回 agent
6. agent 修订计划 → 文档刷新（你的旧批注所在文档不被覆盖，新计划看 plan 卡片）
7. 满意后点 ✓ Approve Plan Review → 解锁执行，审阅快照写进会话转录
```

### 跨 IDE 续接会话

```text
1. 在 VS Code 里跑一个面板会话（自动写入共享索引）
2. 打开 JetBrains（同一台机器），聊天面板输入 /sessions
3. 选择器里出现来源为 ide:vscode 的条目（含标题、状态、workspace）
4. 选中 → 再选动作：Resume（按 session id 续接，上下文无缝衔接）/
   Rename（写 IDE index title overlay）/ Delete（cc session delete --force + 索引剔除，modal 确认）
```

### agent 使用 `getActiveFile`

```text
你: 给当前文件补一个文件头注释
agent: [调用 mcp__ide__getActiveFile]
       → { file: "src/chat/session-list.js", languageId: "javascript",
           isDirty: false, cursor: { line: 12, character: 4 } }
       [直接编辑该文件，无需你粘路径]
```

### 宿主/脚本直接说协议（stream-json）

```bash
cc agent --input-format stream-json --output-format stream-json
```

```jsonc
// stdin：进入 plan → 批准并携带审阅快照
{ "type": "plan", "action": "enter" }
{ "type": "user", "content": "…" }
{ "type": "plan", "action": "approve",
  "review": { "snapshot": "# Review\n- 第 3 步先备份再删" } }
// 会话转录中出现：
//   system: [PLAN REVIEW SNAPSHOT] action=approve …\n# Review\n- 第 3 步先备份再删
```

### 查看 / 重置共享索引

```bash
cat ~/.chainlesschain/ide/session-index.json   # 只有元数据，可放心查看
rm  ~/.chainlesschain/ide/session-index.json   # 损坏时删除即自动重建
```

## 相关文档

- [IDE 桥接（IDE Bridge）](/chainlesschain/ide-bridge) — 本功能所在的插件底座：MCP server、发现协议、Chat 面板、Plan 卡片、diff 审批
- [Agent SDK](/chainlesschain/agent-sdk) — `PlanControlInput.review` 的类型契约与 `PROTOCOL.md` 单一来源
- [`cc agent` 托管智能体](/chainlesschain/cli-agent) — stream-json 双工协议与 Plan 模式的 CLI 侧
- [会话管理 `cc session`](/chainlesschain/cli-session) — CLI session store（转录真正的家）与 `--resume`
- [Cowork 多智能体协作](/chainlesschain/cowork) — 桌面侧的计划/审批工作流（与 IDE 内审阅互补）
- 设计对照：`docs/ide/CLAUDE_CODE_IDE_GAP_ANALYSIS.md`（本轮实施状态与剩余项）
