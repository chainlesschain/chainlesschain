# 77. Agent 架构优化系统

**版本**: v5.0.2.10  
**创建日期**: 2026-04-04  
**最近更新**: 2026-04-06  
**状态**: 已实现，并已与 Runtime / WS / Web Panel 主链对齐

---

## 1. 模块定位

模块 77 关注的不是单一功能，而是一组围绕 CLI Agent 生产可用性建设的增强能力。它回答的问题是：

- CLI Agent 如何具备渐进式能力开关？
- 会话如何从“脆弱的本地状态”变成可恢复的持久化状态？
- 长任务如何脱离当前前台请求继续运行？
- 子 Agent 如何在隔离环境里工作并安全回收？
- 压缩和实验结果如何进入可观测面？

如果模块 78 关注的是“CLI Agent Runtime 如何重构”，那么模块 77 关注的是“在当前架构下，哪些核心 harness 能力已经落地并进入主链”。

---

## 2. 目标

本模块的总体目标，是借鉴渐进式 harness 思路，为 ChainlessChain CLI Agent 补齐一组真正影响可用性、恢复性和可观测性的能力。

本轮已经稳定落地的五个核心模块为：

1. `Feature Flags`
2. `Prompt Compressor`
3. `JSONL Session Store`
4. `Background Task Manager`
5. `Worktree Isolator`

除此之外，还完成了一批围绕它们的增强集成：

- `JSONL_SESSION` 默认启用
- 后台任务实时通知 Web Panel
- Worktree 合并助手
- 压缩策略 A/B 测试
- 压缩观测面板
- 会话迁移工具

---

## 3. 设计原则

### 3.1 先能力稳定，再逐步默认化

例如 `JSONL_SESSION` 先完成实现、验证、迁移工具，再默认启用。

### 3.2 能力必须可观察

不是只把功能做出来，而是要能看见：

- 是否命中
- 触发了什么变体
- 节省了多少 token
- 任务现在处于什么状态

### 3.3 尽量通过兼容式演进接入主链

这批能力不是平行世界里的新系统，而是要逐步接到：

- CLI Runtime
- WS 协议
- Web Panel
- 文档站

### 3.4 不把“后续计划”混写成“已完成”

模块 77 只记录已经真正落地的能力与当前状态。

---

## 4. 五个核心优化模块

### 4.1 Feature Flags

职责：

- 注册与查询特性开关
- 支持环境变量、配置文件、默认值三层优先级
- 支持百分比分流与实验变体

当前关键标志包括：

| 标志 | 默认值 | 说明 |
|------|--------|------|
| `BACKGROUND_TASKS` | false | 后台任务队列 |
| `WORKTREE_ISOLATION` | false | Git Worktree 隔离 |
| `CONTEXT_SNIP` | false | snipCompact 压缩 |
| `CONTEXT_COLLAPSE` | false | contextCollapse 折叠 |
| `JSONL_SESSION` | true | JSONL 追加式会话持久化 |
| `COMPRESSION_AB` | `{ enabled: false, variant: "balanced" }` | 压缩策略 A/B 测试 |
| `PROMPT_COMPRESSOR` | true | 提示压缩器 |

### 4.2 Prompt Compressor

职责：

- 对上下文做多阶段压缩
- 在 token 逼近阈值时自动触发
- 记录压缩遥测

当前支持的主要策略包括：

- 去重
- 截断
- 摘要
- SnipCompact
- ContextCollapse

### 4.3 JSONL Session Store

职责：

- 追加式会话写入
- compact 检查点
- 崩溃恢复
- 会话迁移与校验

当前已不是实验特性，而是默认持久化路径的一部分。

### 4.4 Background Task Manager

职责：

- 长任务后台执行
- 任务状态机管理
- 任务历史持久化
- 重启恢复
- 前端实时通知

### 4.5 Worktree Isolator

职责：

- 子任务隔离执行
- Git Worktree 生命周期管理
- diff 预览
- merge 辅助
- 冲突摘要与自动化候选项

---

## 5. 当前已完成的增强集成

### 5.1 JSONL_SESSION 默认启用

这项能力已经从“可选实验”变成默认行为：

- `feature-flags.js` 中默认值已为 `true`
- `agent-repl.js`、`session.js` 已按 JSONL 方案工作
- 会话迁移工具已可用于旧 JSON → JSONL 迁移

### 5.2 Background Task Notifications

后台任务不再只能靠轮询查询，任务完成或失败后会通过 `task:notification` 推送到 Web Panel。

当前这条链已经贯通：

- 后台任务管理器
- WS 协议
- `tasks.js`
- Web Panel 页面

### 5.3 Worktree 合并助手

当前 Worktree 不只是隔离运行，还补了后处理能力：

- `worktree-diff`
- `worktree-merge`
- 文件级冲突摘要
- `automationCandidates`
- `previewEntrypoints`

### 5.4 压缩策略 A/B 测试

当前已接入 `featureVariant()`：

- 可对比不同压缩阈值或变体
- 可在遥测中看到变体分布
- 可在 Dashboard 中看到观测结果

---

## 6. 当前实现状态

### 6.1 Harness 迁移

相关模块当前已迁入：

- `packages/cli/src/harness/feature-flags.js`
- `packages/cli/src/harness/prompt-compressor.js`
- `packages/cli/src/harness/compression-telemetry.js`
- `packages/cli/src/harness/jsonl-session-store.js`
- `packages/cli/src/harness/background-task-manager.js`
- `packages/cli/src/harness/background-task-worker.js`
- `packages/cli/src/harness/worktree-isolator.js`

旧 `lib/` 路径保留兼容层。

### 6.2 WebSocket 对齐

当前与这批能力相关的 WS 协议已包括：

- `tasks-list`
- `tasks-detail`
- `tasks-history`
- `tasks-stop`
- `task:notification`
- `worktree-list`
- `worktree-diff`
- `worktree-merge`
- `compression-stats`

### 6.3 Web Panel 对齐

前端当前已经可以消费这批增强能力中的主链结果：

- 任务通知
- 任务历史与详情
- Worktree diff / merge 结果
- 压缩观测摘要
- 统一 runtime event

---

## 7. 当前最重要的四个落地结果

### 7.1 后台任务增强

已完成：

- 任务历史分页检索
- 任务输出摘要
- 重启恢复
- 多节点恢复策略基础能力
- 实时通知

### 7.2 Worktree 增强

已完成：

- 文件级冲突摘要
- 自动化解决候选项
- diff 预览入口
- 一键合并协议

### 7.3 压缩观测增强

已完成：

- `windowMs` 时间窗口筛选
- `provider` / `model` 切片
- 策略分布
- 变体分布
- Dashboard 展示

### 7.4 会话迁移增强

已完成：

- 目录级 dry-run 报告
- 迁移后抽样校验
- 失败重试

---

## 8. 与模块 78 的关系

模块 77 和模块 78 的关系需要明确区分：

- 模块 77
  - 关注“增强能力本身已经做了什么”
- 模块 78
  - 关注“整个 CLI Agent Runtime 如何重构边界”

可以把两者理解为：

- 77 是“能力层成果”
- 78 是“架构层计划”

当前这两者已经开始在主链上合流：

- 能力模块迁入 `harness/`
- 事件开始统一为 runtime event
- 前端开始通过 `onRuntimeEvent()` 消费

---

## 9. 当前验证状态

与本模块直接相关的当前验证结果：

- CLI 定向单元：`130/130`
- CLI 定向集成：`19/19`
- CLI `ws-session-workflow` 集成：`16/16`
- Web Panel 定向单元：`23/23`
- Web Panel E2E：`29/29`
- Web Panel 构建：通过
- Docs Site 构建：通过

当前已经明确验证到：

- session record 在 CLI / WS / Web Panel 三层一致
- task / worktree / compression 能力已接入主链
- `onRuntimeEvent()` 可以驱动主干页面状态更新

---

## 10. 当前风险与边界

### 10.1 不是所有页面都已经完全收口

主干页面已开始统一，但边缘页面仍需要持续清查是否还有旧消息依赖。

### 10.2 能力已落地，不代表架构重构已结束

模块 77 的能力已经可用，但模块 78 的 Runtime / Tool Registry 主线仍在继续。

### 10.3 文档必须持续跟代码一起更新

这批能力跨越：

- harness
- ws
- web-panel
- docs-site

任何一层落后，用户就会看到不一致描述。

---

## 11. 相关文件

- `packages/cli/src/harness/feature-flags.js`
- `packages/cli/src/harness/prompt-compressor.js`
- `packages/cli/src/harness/compression-telemetry.js`
- `packages/cli/src/harness/jsonl-session-store.js`
- `packages/cli/src/harness/background-task-manager.js`
- `packages/cli/src/harness/worktree-isolator.js`
- `packages/cli/src/gateways/ws/task-protocol.js`
- `packages/cli/src/gateways/ws/worktree-protocol.js`
- `packages/web-panel/src/stores/tasks.js`
- `packages/web-panel/src/stores/dashboard.js`

---

## 12. 结论

模块 77 当前已经不再是“功能设想清单”，而是 CLI Agent 生产级能力的真实落地说明。

这批能力的价值在于：

- 让会话从脆弱状态变成可恢复状态
- 让长任务从前台阻塞变成后台可管理状态
- 让子 Agent 从污染主工作区变成隔离 worktree 执行
- 让压缩和实验从黑箱行为变成可观测行为

它和模块 78 共同构成当前 CLI Agent 重构的两条主线：

- 一条是“能力已经做到了什么”
- 一条是“架构接下来如何收口”
