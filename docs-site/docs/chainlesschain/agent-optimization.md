# Agent 架构优化

> 本页描述当前代码中已经落地的 Agent 增强能力，以及它们如何与 CLI Runtime、WebSocket 服务和 Web Panel 主链对齐。内容已对齐到 2026-04-06 的实现状态。

## 概述

本文档梳理 ChainlessChain 近期已落地的 Agent 架构优化能力，包括 JSONL 会话、后台任务通知、Worktree 支持、压缩 A/B 测试和 Runtime 事件统一消费等。文档聚焦于"做了哪些新能力"以及它们在 CLI Runtime、WebSocket 协议和 Web Panel 中的对齐关系。

## 这页解决什么问题

如果你在看 ChainlessChain 最近这轮演进，最容易混淆的是两件事：

- “做了哪些新能力”
- “整体架构怎么重构”

这页主要回答前者，也就是：当前已经真正落地的 Agent 增强能力有哪些，它们现在在哪里、怎么用、和前端及 WS 协议的关系是什么。

如果你更关心整体 Runtime 分层，请继续看：

- [CLI Agent Runtime 重构计划](../design/modules/78-cli-agent-runtime)

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

## 推荐继续阅读

- [Web 管理界面 (ui)](./cli-ui)
- [WebSocket 服务 (serve)](./cli-serve)
- [设计文档：模块 69](../design/modules/69-websocket-server)
- [设计文档：模块 77](../design/modules/77-agent-optimization)
- [设计文档：模块 78](../design/modules/78-cli-agent-runtime)
