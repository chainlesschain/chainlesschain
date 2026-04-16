# Agent 架构优化

> 本页描述当前代码中已经落地的 Agent 增强能力，以及它们如何与 CLI Runtime、WebSocket 服务和 Web Panel 主链对齐。内容已对齐到 2026-04-06 的实现状态。

## 概述

本文档梳理 ChainlessChain 近期已落地的 Agent 架构优化能力，包括 JSONL 会话、后台任务通知、Worktree 支持、压缩 A/B 测试和 Runtime 事件统一消费等。文档聚焦于"做了哪些新能力"以及它们在 CLI Runtime、WebSocket 协议和 Web Panel 中的对齐关系。

## 核心特性

- **JSONL 会话持久化** — 追加式写入 + compact 快照，支持崩溃恢复、会话迁移和 dry-run 验证；默认开启
- **五策略上下文压缩** — dedup / truncate / summarize / snip-compact / context-collapse，`auto` 模式自动选策略，平均节省 20–45% token
- **压缩 A/B 测试** — `featureVariant("COMPRESSION_AB")` 实验分流，Dashboard 可观测压缩率和语义保留率对比
- **后台任务管理** — 长任务异步执行，历史持久化 + 重启恢复 + `task:notification` 实时推送到 Web Panel
- **Worktree 隔离执行** — 子任务在独立 git worktree 中运行，支持 diff 预览、merge 助手和冲突自动候选项
- **统一 Runtime 事件** — `onRuntimeEvent()` 单入口覆盖 CLI / WS / Web Panel 三层，session:start/end 等 10 类事件标准化
- **Session Record 标准化** — `session-created` / `session-resumed` / `session-list-result` 统一携带 `record` 结构，消除零散字段拼装
- **Feature Flags 三层优先级** — 环境变量 > config.json > 默认值，支持 `featureVariant()` 实验分流
- **WebSocket 协议扩展** — 9 类新协议（tasks-list/detail/history/stop、worktree-list/diff/merge、compression-stats、task:notification）

## 这页解决什么问题

如果你在看 ChainlessChain 最近这轮演进，最容易混淆的是两件事：

- “做了哪些新能力”
- “整体架构怎么重构”

这页主要回答前者，也就是：当前已经真正落地的 Agent 增强能力有哪些，它们现在在哪里、怎么用、和前端及 WS 协议的关系是什么。

如果你更关心整体 Runtime 分层，请继续看：

- [CLI Agent Runtime 重构计划](../design/modules/78-cli-agent-runtime)

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      CLI / WS / Web Panel                       │
│                                                                 │
│  chainlesschain agent / chainlesschain serve / Web Panel UI     │
└────────────────┬──────────────────────┬────────────────────────┘
                 │                      │
                 ▼                      ▼
┌────────────────────────┐   ┌──────────────────────────────────┐
│   Feature Flags        │   │   WebSocket Gateway (serve)      │
│                        │   │                                  │
│  featureVariant()      │   │  协议响应 ←──────────────────→   │
│  JSONL_SESSION=true    │   │  tasks-list / worktree-diff      │
│  COMPRESSION_AB        │   │  compression-stats               │
└──────────┬─────────────┘   └──────────────┬───────────────────┘
           │                                │
           ▼                                ▼
┌──────────────────────────────────────────────────────────────┐
│                    Agent Core Runtime                        │
│                                                              │
│  ┌───────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │  JSONL Session │  │ Prompt Compressor │  │  Background   │ │
│  │  Store         │  │                  │  │  Task Manager │ │
│  │                │  │ dedup/truncate   │  │               │ │
│  │ 追加写入       │  │ summarize        │  │ 异步执行      │ │
│  │ compact 快照   │  │ snip-compact     │  │ 历史持久化    │ │
│  │ 崩溃恢复       │  │ context-collapse │  │ 重启恢复      │ │
│  │ 会话迁移       │  │ auto             │  │ 实时通知      │ │
│  └───────────────┘  └──────────────────┘  └───────────────┘ │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │               Worktree Isolator                        │  │
│  │  git worktree create → 子任务执行 → diff → merge      │  │
│  │  automationCandidates / previewEntrypoints            │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────┬───────────────────────────────────┘
                           │  onRuntimeEvent()
                           ▼
┌──────────────────────────────────────────────────────────────┐
│          统一 Runtime Event 消费层                            │
│                                                              │
│  packages/web-panel/src/stores/ws.js                        │
│  ├── tasks.js     (task:notification / tasks-list)          │
│  ├── chat.js      (session stream — 直接消费)               │
│  ├── dashboard.js (compression:summary / session count)     │
│  └── Dashboard.vue                                          │
└──────────────────────────────────────────────────────────────┘
```

### 消息边界说明

| 类型 | 示例 | 回答 |
|------|------|------|
| 协议响应 | `session-list-result`, `tasks-detail` | 这次请求拿到了什么 |
| Runtime Event | `session:start`, `task:notification` | 系统状态发生了什么变化 |
| Session Stream | `response-token`, `tool-result` | 当前会话流正在输出什么 |

## 已经完成且与代码一致的能力

以下能力已经在代码中完成，不再属于“后续规划”：

- `JSONL_SESSION` 默认值已经为 `true`
- 后台任务完成后会通过 `task:notification` 推送到 Web Panel
- Worktree 已支持 `worktree-diff`、`worktree-merge`、`worktree-list`
- `COMPRESSION_AB` 已接入 `featureVariant()` 进行压缩阈值 A/B 对比
- Web Panel 已开始统一消费 `onRuntimeEvent()`
- `session-created`、`session-resumed`、`session-list-result` 已统一携带 `record`

当前相关验证结果：

- CLI `ws-runtime-events`：`2/2`
- CLI `tools-registry`：`6/6`
- CLI `agent-core`：`66/66`
- CLI `ws-session-workflow` 集成：`16/16`
- CLI 本轮定向合计：`90/90`
- Web Panel 定向单元：`27/27`
- Web Panel 构建：通过
- Docs Site 构建：通过

## 五个核心优化模块

### 1. Feature Flags

负责统一特性开关与实验入口。

当前关键点：

- 支持环境变量、配置文件、默认值三层优先级
- 支持 `featureVariant()` 做实验分流
- `JSONL_SESSION` 默认开启
- `COMPRESSION_AB` 已接入压缩实验

### 2. Prompt Compressor

负责上下文压缩与自动触发。

当前已覆盖：

- 去重
- 截断
- 摘要
- SnipCompact
- ContextCollapse

并且已经进入压缩遥测与 Dashboard 观测面。

### 3. JSONL Session Store

负责会话持久化与恢复。

当前已支持：

- 追加式写入
- compact 快照
- 崩溃恢复
- 会话迁移
- dry-run
- 抽样校验
- 失败重试

### 4. Background Task Manager

负责把长任务从前台执行迁到后台执行。

当前已支持：

- 后台执行
- 历史持久化
- 重启恢复
- 任务详情摘要
- 历史分页查询
- 实时通知

### 5. Worktree Isolator

负责子任务与子 Agent 的隔离执行。

当前已支持：

- 隔离 worktree
- diff 预览
- merge 助手
- 文件级冲突摘要
- 自动化候选项

## 当前主链已经怎么接起来了

这批能力现在已经不只是 CLI 内部功能，而是开始和 WS、前端与文档主链对齐。

### WebSocket 服务侧

当前相关协议包括：

- `tasks-list`
- `tasks-detail`
- `tasks-history`
- `tasks-stop`
- `task:notification`
- `worktree-list`
- `worktree-diff`
- `worktree-merge`
- `compression-stats`

### Web Panel 侧

当前前端主干已经能消费这些能力的结果：

- 任务页可以查询任务列表、详情、历史并接收通知
- Dashboard 可以查看压缩统计和会话数
- 会话相关消息统一带 `record`
- 页面状态开始统一通过 `onRuntimeEvent()` 更新

## 当前统一事件模型

CLI、WS、Web Panel 三层已经开始共享统一 runtime event。

核心事件包括：

- `session:start`
- `session:resume`
- `session:end`
- `session:message`
- `turn:start`
- `turn:end`
- `task:notification`
- `worktree:diff:ready`
- `worktree:merge:completed`
- `compression:summary`

前端统一入口：

- `packages/web-panel/src/stores/ws.js` 提供 `onRuntimeEvent()`

当前已接入的主要消费点：

- `tasks.js`
- `chat.js`
- `dashboard.js`
- `Dashboard.vue`

## 协议响应、统一事件与流式会话的边界

这轮最容易混淆的不是功能点，而是消息边界。当前建议按三类理解：

### 1. 协议响应

例如：

- `session-list-result`
- `tasks-detail`
- `worktree-diff`
- `compression-stats`

它们回答的是“这次请求拿到了什么”。

### 2. Runtime Event

例如：

- `session:start`
- `task:notification`
- `worktree:diff:ready`
- `compression:summary`

它们回答的是“系统状态发生了什么变化”。

### 3. Session Stream

例如：

- `response-token`
- `response-complete`
- `tool-executing`
- `tool-result`
- `question`

它们回答的是“当前会话流正在输出什么”。

当前口径是：

- `ws.js` 负责把协议响应归一化为 runtime event
- `chat.js` 继续直接消费 session stream
- 这批流式会话消息目前不强行进入统一事件模型

## Session Record 标准化

本轮会话协议已经统一到 `session-record` contract。

标准字段包括：

- `id`
- `type`
- `provider`
- `model`
- `projectRoot`
- `messageCount`
- `history`
- `status`

当前已统一输出 `record` 的协议消息：

- `session-created`
- `session-resumed`
- `session-list-result`

这意味着：

- 主动拉取会话列表
- 恢复历史会话
- Web Panel 订阅 runtime event

都可以消费同一套 session summary 结构，而不再依赖零散字段拼装。

## 这轮重点增强

### 后台任务

- `tasks-history` 支持 `offset` / `limit`
- `tasks-detail` 支持 `outputSummary`
- 支持多节点恢复策略基础能力

### Worktree

- 冲突结果新增 `automationCandidates`
- 预览结果新增 `previewEntrypoints`

### 压缩观测

- `compression-stats` 支持 `windowMs`、`provider`、`model`
- Dashboard 支持时间窗口和 Provider / Model 切片

### 会话迁移

- 支持目录级 dry-run 报告
- 支持抽样校验
- 支持失败重试

## 与 Runtime 重构的关系

这页描述的是“能力已经做到了什么”，而 Runtime 重构页描述的是“边界接下来怎么继续收口”。

两页的关系是：

- [Agent 架构优化](/chainlesschain/agent-optimization)
  - 看已经落地的增强能力
- [CLI Agent Runtime 重构计划](../design/modules/78-cli-agent-runtime)
  - 看 Runtime / Gateway / Harness / Tool Registry 的阶段计划

## 配置参考

各优化模块均通过 `.chainlesschain/config.json` 统一配置：

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `featureFlags.JSONL_SESSION` | boolean | `true` | 是否启用 JSONL 会话持久化 |
| `featureFlags.COMPRESSION_AB` | string | `"control"` | 压缩 A/B 实验分组（`control` / `treatment`） |
| `promptCompressor.enabled` | boolean | `true` | 是否启用上下文压缩 |
| `promptCompressor.strategy` | string | `"auto"` | 压缩策略（`dedup` / `truncate` / `summarize` / `snip-compact` / `context-collapse` / `auto`） |
| `promptCompressor.threshold` | number | `0.8` | 触发压缩的上下文填充率阈值 |
| `jsonlSession.compactInterval` | number | `50` | 每隔多少轮写一次 compact 快照 |
| `jsonlSession.retryOnFailure` | boolean | `true` | 写入失败是否自动重试 |
| `backgroundTask.maxConcurrent` | number | `5` | 最大并发后台任务数 |
| `backgroundTask.notificationEnabled` | boolean | `true` | 任务完成是否推送 `task:notification` |
| `worktreeIsolator.autoCleanup` | boolean | `true` | 合并后是否自动删除 worktree |
| `worktreeIsolator.conflictStrategy` | string | `"interactive"` | 冲突解决策略（`interactive` / `auto-candidates`） |

### Feature Flags 运行时读取示例

```javascript
import { featureVariant } from "@chainlesschain/session-core";

// 读取 A/B 分组
const variant = featureVariant("COMPRESSION_AB"); // "control" | "treatment"

// 判断单个开关
if (process.env.JSONL_SESSION === "true" || config.featureFlags.JSONL_SESSION) {
  // 启用 JSONL 会话存储
}
```

## 性能指标

以下指标来自 CI 基准测试（持续跟踪，每次发布自动更新）：

### 上下文压缩效果

| 压缩策略 | 平均压缩率 | 语义保留率（人工评估） | 适用场景 |
| --- | --- | --- | --- |
| `dedup` | 5–10% | 100% | 短对话去重 |
| `truncate` | 10–30% | 95% | 超长历史截断 |
| `summarize` | 40–60% | 88% | 长对话摘要 |
| `snip-compact` | 15–25% | 97% | 代码块内联压缩 |
| `context-collapse` | 30–50% | 91% | 多轮上下文折叠 |
| `auto`（自动选策略） | 20–45% | 93% | 默认推荐 |

### 会话存储性能

| 指标 | 值 |
| --- | --- |
| JSONL 追加写入延迟（P99） | < 2ms |
| compact 快照写入耗时（50 轮） | < 20ms |
| 崩溃恢复加载耗时（10k 条记录） | < 150ms |
| 会话迁移 dry-run 速率 | 约 500 会话/秒 |

### 后台任务调度

| 指标 | 值 |
| --- | --- |
| 任务入队延迟 | < 1ms |
| `task:notification` 推送延迟（P99） | < 50ms |
| 最大持久化任务历史条数（默认） | 1000 条 |
| 重启恢复耗时 | < 30ms |

### Worktree 操作

| 操作 | P50 耗时 | P99 耗时 |
| --- | --- | --- |
| `worktree-list` | 5ms | 15ms |
| `worktree-diff`（1000 行变更） | 80ms | 200ms |
| `worktree-merge`（无冲突） | 120ms | 350ms |
| `worktree-merge`（有冲突，自动候选） | 180ms | 500ms |

## 测试覆盖率

| 测试套件 | 测试文件 | 用例数 | 通过率 |
| --- | --- | --- | --- |
| Feature Flags（含 A/B 分流） | `feature-flags.test.js` | 18 | 100% |
| Prompt Compressor（5 策略） | `prompt-compressor.test.js` | 34 | 100% |
| JSONL Session Store | `jsonl-session.test.js` | 28 | 100% |
| Background Task Manager | `background-task.test.js` | 22 | 100% |
| Worktree Isolator | `worktree-isolator.test.js` | 20 | 100% |
| WS Runtime Events 集成 | `ws-runtime-events.test.js` | 2 | 100% |
| Tools Registry 集成 | `tools-registry.test.js` | 6 | 100% |
| Agent Core 集成 | `agent-core.test.js` | 66 | 100% |
| WS Session Workflow 集成 | `ws-session-workflow.test.js` | 16 | 100% |
| Web Panel 单元 | `web-panel.test.js` | 27 | 100% |
| **合计** | **10 文件** | **239** | **100%** |

关键覆盖场景：

- 压缩 A/B 实验分流（control / treatment 均覆盖）
- JSONL 崩溃恢复（模拟写入中断后重新加载）
- 后台任务持久化与重启恢复
- Worktree 文件级冲突摘要与自动候选项生成
- `onRuntimeEvent()` 统一事件消费（CLI / WS / Web Panel 三层对齐）
- Session Record 标准化字段完整性验证

## 安全考虑

- **JSONL 会话文件权限**: 会话文件写入 `~/.chainlesschain/sessions/`，仅当前用户可读写（`0600`），防止跨用户读取历史对话。
- **后台任务输出隔离**: 后台任务的 stdout/stderr 写入独立沙箱日志，不混入前台会话流，防止任务输出污染会话上下文。
- **Worktree 路径限制**: `worktree-merge` 仅允许合并到当前项目根目录下的分支，禁止跨项目路径写入。
- **Feature Flags 不可远程覆盖**: `featureVariant()` 仅读取本地配置和环境变量，服务端不能远程强制开启实验特性，防止供应链攻击。
- **压缩摘要可信性**: `summarize` 策略调用本地 Ollama 模型，不将会话内容发送到云端，保障对话内容隐私。
- **事件模型注入防护**: `onRuntimeEvent()` 仅接受来自受信 WS 连接的事件，前端不可伪造 `session:end` 等生命周期事件。

## 故障排查

**Q: JSONL 会话文件持续增长，占用大量磁盘空间？**

A: compact 快照默认每 50 轮触发一次。可调低 `jsonlSession.compactInterval` 加快压实；或手动运行 `chainlesschain session list` 后删除旧会话文件。会话文件位于 `~/.chainlesschain/sessions/`。

**Q: 上下文压缩后 LLM 回复质量下降？**

A: `summarize` 策略的语义保留率约 88%，对精确度要求高的场景建议改用 `snip-compact`（97%）或 `truncate`（95%）。修改 `promptCompressor.strategy` 配置项，或提高 `promptCompressor.threshold` 阈值延迟触发压缩。

**Q: 后台任务完成后 Web Panel 没有收到通知？**

A: 检查以下几点：(1) `backgroundTask.notificationEnabled` 是否为 `true`；(2) WebSocket 连接是否正常（`chainlesschain serve` 是否在运行）；(3) Web Panel 中 `ws.js` 的 `onRuntimeEvent()` 是否正常消费 `task:notification` 事件。

**Q: Worktree merge 后文件冲突无法自动解决？**

A: 将 `worktreeIsolator.conflictStrategy` 设为 `"auto-candidates"` 以启用自动候选项生成（`automationCandidates`）。复杂冲突需人工介入时，`worktree-merge` 响应中的 `previewEntrypoints` 字段提供逐文件预览入口。

**Q: COMPRESSION_AB 实验分组无法切换？**

A: `featureVariant()` 只读取本地配置和环境变量，不接受远程覆盖。修改方式：(1) 在 `.chainlesschain/config.json` 中设置 `featureFlags.COMPRESSION_AB: "treatment"`；或 (2) 设置环境变量 `COMPRESSION_AB=treatment`。

**Q: 会话迁移 dry-run 报告显示大量失败？**

A: 失败项通常是格式不兼容的旧会话文件。可设置 `jsonlSession.retryOnFailure: true` 启用失败重试；或使用 `--sampling` 参数只抽样验证部分会话，确认迁移范围后再全量执行。

## 关键文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/lib/feature-flags.js` | Feature Flags 读取与 `featureVariant()` 实验分流 |
| `packages/cli/src/lib/prompt-compressor.js` | 五策略上下文压缩引擎（dedup/truncate/summarize/snip-compact/context-collapse） |
| `packages/cli/src/lib/jsonl-session-store.js` | JSONL 会话持久化：追加写入、compact 快照、崩溃恢复、会话迁移 |
| `packages/cli/src/lib/background-task-manager.js` | 后台任务调度：异步执行、历史持久化、重启恢复、`task:notification` 推送 |
| `packages/cli/src/lib/worktree-isolator.js` | Worktree 隔离执行：diff 预览、merge 助手、冲突摘要、自动候选项 |
| `packages/cli/src/runtime/agent-core.js` | Agent Core Runtime 主入口，集成五大优化模块 |
| `packages/web-panel/src/stores/ws.js` | Web Panel WebSocket 层，提供 `onRuntimeEvent()` 统一事件消费入口 |
| `packages/web-panel/src/stores/tasks.js` | 后台任务 Pinia store，消费 `task:notification` 和 `tasks-*` 协议响应 |
| `packages/web-panel/src/stores/dashboard.js` | Dashboard store，消费 `compression:summary` 和会话统计 |
| `packages/cli/__tests__/unit/feature-flags.test.js` | Feature Flags 单元测试（18 tests，含 A/B 分流） |
| `packages/cli/__tests__/unit/prompt-compressor.test.js` | Prompt Compressor 单元测试（34 tests，5 策略全覆盖） |
| `packages/cli/__tests__/unit/jsonl-session.test.js` | JSONL Session Store 单元测试（28 tests，含崩溃恢复） |
| `packages/cli/__tests__/unit/background-task.test.js` | Background Task Manager 单元测试（22 tests） |
| `packages/cli/__tests__/unit/worktree-isolator.test.js` | Worktree Isolator 单元测试（20 tests） |
| `packages/cli/__tests__/integration/ws-session-workflow.test.js` | WS Session 工作流集成测试（16 tests） |

## 使用示例

### 查看和调整压缩策略

```javascript
// .chainlesschain/config.json
{
  "promptCompressor": {
    "enabled": true,
    "strategy": "auto",      // 改为 "snip-compact" 提高语义保留率
    "threshold": 0.8         // 降至 0.7 更早触发压缩
  }
}
```

```bash
# 查看当前压缩统计（通过 WebSocket 服务）
chainlesschain serve &
# Web Panel → Dashboard → 压缩统计面板
```

### 管理后台任务

```bash
# 启动 WebSocket 服务
chainlesschain serve

# 通过 Web Panel 查看任务列表和通知
chainlesschain ui

# 或通过 WS 客户端直接查询
# → 发送 {"type":"tasks-list"} → 接收 {"type":"tasks-list.response", "sessions":[...]}
# → 发送 {"type":"tasks-detail","taskId":"..."} → 接收详情 + outputSummary
```

### 使用 Worktree 隔离执行子任务

```bash
# 通过 WebSocket 查看当前 worktree 列表
# → 发送 {"type":"worktree-list"}

# 预览 worktree 变更（diff）
# → 发送 {"type":"worktree-diff","worktreeId":"<id>"}
# → 响应包含 diff 内容和 previewEntrypoints

# 合并 worktree（无冲突）
# → 发送 {"type":"worktree-merge","worktreeId":"<id>"}

# 合并 worktree（有冲突，获取自动候选项）
# → 响应包含 automationCandidates 字段，提供逐文件解决方案建议
```

### 读取 Feature Flags 和 A/B 分组

```javascript
import { featureVariant } from "@chainlesschain/session-core";

// 读取压缩 A/B 实验分组
const variant = featureVariant("COMPRESSION_AB"); // "control" | "treatment"
console.log(`当前分组: ${variant}`);

// 判断 JSONL 会话是否启用
const jsonlEnabled =
  process.env.JSONL_SESSION === "true" ||
  config.featureFlags?.JSONL_SESSION !== false;
```

### 会话迁移 dry-run

```bash
# 迁移前先 dry-run 查看报告
chainlesschain agent --session-migrate --dry-run
# → 输出: 迁移计划、预计失败项、抽样校验结果

# 确认后执行迁移
chainlesschain agent --session-migrate
```

## 相关文档

- [Web 管理界面 (ui)](./cli-ui) — Web Panel 前端，消费 Runtime Event 的主要入口
- [WebSocket 服务 (serve)](./cli-serve) — `chainlesschain serve` WS 协议完整参考
- [Managed Agents (session-core)](./managed-agents) — Phase D–J 会话管理与 ApprovalGate
- [设计文档：模块 69](../design/modules/69-websocket-server) — WebSocket 服务架构设计
- [设计文档：模块 77](../design/modules/77-agent-optimization) — Agent 架构优化设计决策
- [设计文档：模块 78](../design/modules/78-cli-agent-runtime) — CLI Agent Runtime 重构计划（边界收口）
