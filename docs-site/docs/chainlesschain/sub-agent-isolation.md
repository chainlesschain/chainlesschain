# 子代理隔离系统 (Sub-Agent Isolation v2)

> v5.0.1.7 — v5.0.1.8 | CLI v0.43.0+ — 子代理上下文隔离与协作管理

## 系统架构

```
┌──────────────────────────────────────────────────────────────────┐
│                        主代理 (Parent Agent)                      │
│   messages[]  CLIContextEngineering  SubAgentRegistry             │
└────────────────────────┬─────────────────────────────────────────┘
                         │ spawn_sub_agent
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  子代理 A    │ │  子代理 B    │ │  子代理 C    │
│  role:       │ │  role:       │ │  role:       │
│  code-review │ │  testing     │ │  document    │
│              │ │              │ │              │
│  独立        │ │  独立        │ │  独立        │
│  messages[]  │ │  messages[]  │ │  messages[]  │
│  独立        │ │  独立        │ │  独立        │
│  上下文引擎  │ │  上下文引擎  │ │  上下文引擎  │
│  工具白名单  │ │  工具白名单  │ │  工具白名单  │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       ▼                ▼                ▼
  摘要结果(≤500)   摘要结果(≤500)   摘要结果(≤500)
       │                │                │
       └────────────────┴────────────────┘
                        │ 注入父代理上下文
                        ▼
              ┌──────────────────┐
              │  SubAgentRegistry │
              │  _active Map      │
              │  _completed Ring  │
              └──────────────────┘
```

## 概述

子代理隔离系统解决了多代理协作中的**上下文污染**问题。当主代理通过任务分解或技能调用需要子代理参与时，子代理拥有完全独立的上下文环境，仅将摘要结果注入父代理。

### 核心问题

| 问题 | 描述 |
|------|------|
| 共享消息数组 | 所有工具调用和技能结果追加到同一 `messages[]`，子任务中间推理污染主代理上下文 |
| 全局上下文注入 | BM25 搜索、记忆召回、偏好注入都是全局的，不按任务范围过滤 |
| 单例内存泄漏 | `_working`/`_shortTerm` 是模块级全局 Map，所有代理共享 |
| Cowork 交叉污染 | Debate 的 moderator 看到所有 reviewer 的完整输出 |

### 解决方案

```
主代理 (父上下文)
  ├── 独立 messages[]
  ├── 独立 CLIContextEngineering
  └── spawn_sub_agent
        ├── 子代理 A (隔离 messages + 隔离上下文引擎)
        │     └── 返回: 摘要结果 (≤500字符)
        └── 子代理 B (隔离 messages + 隔离上下文引擎)
              └── 返回: 摘要结果 (≤500字符)
```

## 架构

### SubAgentContext

核心隔离原语，为子代理提供独立执行环境。

```js
SubAgentContext {
  id: string                    // "sub-<randomUUID>"
  parentId: string|null         // 父上下文 ID
  role: string                  // "code-review", "summarizer" 等
  messages: Array               // 隔离的消息历史
  contextEngine: CLIContextEngineering  // 独立实例
  maxIterations: number         // 子代理迭代上限 (默认 8)
  allowedTools: string[]|null   // 工具白名单
  status: "active"|"completed"|"failed"
  result: { summary, artifacts } | null
}
```

**关键方法**：

| 方法 | 说明 |
|------|------|
| `SubAgentContext.create(options)` | 工厂方法，创建隔离上下文 |
| `run(userPrompt, loopOptions)` | 运行子代理循环，返回结构化结果 |
| `summarize(content)` | 三级摘要策略 |
| `forceComplete(reason)` | 强制完成（超时/取消） |
| `toJSON()` | 可序列化快照（不包含 messages） |

### 三级摘要策略

| 策略 | 条件 | 行为 |
|------|------|------|
| 直接使用 | 结果 ≤ 500 字符 | 原样返回 |
| 结构化提取 | 包含 `## Summary`/`## Result` 等标题 | 提取该 section |
| 截断 + 标注 | 超长结果 | 取前 500 字符 + 完整输出长度标注 |

### spawn_sub_agent 工具

新增的 Agent 工具，允许 LLM 主动创建子代理：

```json
{
  "name": "spawn_sub_agent",
  "description": "生成隔离子代理处理子任务",
  "parameters": {
    "role": "子代理角色",
    "task": "任务描述",
    "context": "可选：从父代理传入的精简上下文",
    "tools": "可选：子代理可用工具白名单"
  }
}
```

## 作用域化上下文 (Scoped Context)

### 命名空间化记忆

层次化记忆的 `_working`/`_shortTerm` 从全局 Map 改为命名空间化：

```
之前: Map<id, entry>
之后: Map<namespace, Map<id, entry>>
```

- `storeMemory(db, content, { namespace })` — 存入指定命名空间
- `recallMemory(db, query, { namespace })` — 搜索指定命名空间 + 共享的 long-term/core
- 默认命名空间 `"global"`，向后完全兼容

### 作用域上下文引擎

`CLIContextEngineering` 的 `scope` 选项：

| 注入层 | 有 scope 时的行为 |
|--------|------------------|
| BM25 笔记搜索 | 查询前缀加 `[${role}]` |
| 记忆召回 | 命名空间隔离，阈值从 0.3 提升到 0.6 |
| 压缩摘要 | 新实例从空开始 |
| 错误历史 | 新实例从空开始 |

## 角色工具白名单

`agent-coordinator.js` 中按角色限制可用工具：

| 角色 | 可用工具 |
|------|---------|
| code-review | read_file, search_files, list_dir |
| code-generation | read_file, write_file, edit_file, run_shell, search_files, list_dir |
| data-analysis | read_file, search_files, list_dir, run_code, run_shell |
| document | read_file, write_file, search_files, list_dir |
| testing | read_file, write_file, edit_file, run_shell, search_files, list_dir, run_code |
| general | 所有工具 |

## 生命周期管理

### SubAgentRegistry

单例注册表，跟踪子代理生命周期：

```js
SubAgentRegistry {
  _active: Map<id, SubAgentContext>         // 当前活跃
  _completed: RingBuffer<CompletedRecord>   // 最近 100 条完成记录

  register(subCtx)           // 注册活跃子代理
  complete(id, result)       // 标记完成，移入历史
  forceCompleteAll(sessionId) // 按会话强制完成
  cleanup(maxAgeMs)          // 清理超时条目
  getStats()                 // 统计信息
}
```

### REPL 命令

```bash
chainlesschain agent
> /sub-agents              # 查看活跃/历史子代理状态
```

### 会话清理

WebSocket 会话关闭时自动 force-complete 所有子代理：

```js
// ws-session-manager.js
closeSession(sessionId) {
  SubAgentRegistry.getInstance().forceCompleteAll(sessionId);
  // ... 其他清理
}
```

## Cowork Debate 摘要化

每个 reviewer 的输出在传给 moderator 前先截断（max 300 字符），减少交叉污染：

```js
const REVIEW_SUMMARY_MAX = 300;
// reviewer 输出 → 截断 → moderator 收到摘要版
```

## 关键文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/lib/sub-agent-context.js` | 子代理上下文核心 |
| `packages/cli/src/lib/sub-agent-registry.js` | 生命周期注册表 |
| `packages/cli/src/lib/agent-core.js` | spawn_sub_agent 工具 |
| `packages/cli/src/lib/cli-context-engineering.js` | 作用域化上下文 |
| `packages/cli/src/lib/hierarchical-memory.js` | 命名空间化记忆 |
| `packages/cli/src/lib/agent-coordinator.js` | 任务分解执行 |
| `packages/cli/src/lib/cowork/debate-review-cli.js` | Debate 摘要化 |
| `desktop-app-vue/src/main/ai-engine/agents/sub-agent-context.js` | Desktop 等价实现 |

## 配置参考

```javascript
// spawn_sub_agent 调用配置
const subAgentConfig = {
  // 子代理角色（决定工具白名单）
  // "code-review" | "code-generation" | "data-analysis" | "document" | "testing" | "general"
  role: 'code-review',

  // 任务描述
  task: '审查 src/auth/ 目录的安全性',

  // 可选：从父代理传入的精简上下文（未提供时自动提取父代理最近3条消息前200字符）
  context: 'Auth 模块使用 JWT + bcrypt，关键文件: auth.js, middleware/auth.js',

  // 可选：显式指定工具白名单（覆盖角色默认白名单）
  tools: ['read_file', 'search_files', 'list_dir'],

  // 子代理最大迭代次数（默认 8）
  maxIterations: 8,

  // Token 预算（字符数，~4字符/token，默认不限制）
  tokenBudget: 40000
};

// SubAgentRegistry 全局配置
const registryConfig = {
  // 已完成记录环形缓冲区大小
  completedRingSize: 100,

  // 子代理最大并发数（executeDecomposedTask）
  maxConcurrency: 3,

  // 摘要截断字符上限
  summaryMaxChars: 500,

  // Debate reviewer 摘要截断字符上限
  reviewSummaryMaxChars: 300
};
```

---

## 性能指标

| 操作                               | 目标        | 实际        | 状态 |
| ---------------------------------- | ----------- | ----------- | ---- |
| 子代理上下文创建                   | < 5ms       | ~2ms        | ✅   |
| 并行子代理启动（3 个并发）         | < 20ms      | ~8ms        | ✅   |
| 三级摘要策略处理                   | < 10ms      | ~3ms        | ✅   |
| 命名空间化记忆存取                 | < 15ms      | ~6ms        | ✅   |
| 强制完成（forceCompleteAll）       | < 50ms      | ~18ms       | ✅   |
| 环形缓冲区 100 条记录查询          | < 5ms       | ~1ms        | ✅   |
| 子代理状态 IPC 查询（/sub-agents） | < 100ms     | ~35ms       | ✅   |

---

## v5.0.1.8 增强 (Sub-Agent Isolation v2)

- **自动上下文凝缩**: 未提供 context 时，自动从父代理最近3条消息提取前200字符作为继承上下文
- **Token 预算执行**: 基于字符长度估算 (~4字符/token)，达到 `tokenBudget` 时自动 `forceComplete`
- **并行子代理**: `executeDecomposedTask()` 支持批次并行执行 (`maxConcurrency` 默认 3)
- **系统提示词引导**: `getBaseSystemPrompt()` 包含 Sub-Agent Isolation 使用指南
- **Desktop 集成**: `agent-pool.js` 支持 `inheritedContext`/`tokenBudget`，`autonomous-agent-runner.js` 支持子代理追踪

## 测试覆盖率

- **单元测试**: sub-agent-context (38), sub-agent-registry (12), scoped-context-engineering (8), namespaced-memory (9)
- **集成测试**: sub-agent-isolation (33) — spawn_sub_agent + 命名空间隔离 + token预算
- **E2E 测试**: sub-agent-isolation (8) — 模块导入验证, 工具定义验证

## 核心特性

- **消息隔离**: 每个子代理拥有独立的 `messages[]` 历史，父代理和子代理之间互不可见中间推理过程，仅通过摘要结果通信
- **命名空间化记忆**: `_working`/`_shortTerm` 按命名空间分片存储，子代理只能访问自身命名空间 + 共享的 long-term/core 记忆
- **角色工具白名单 (6 种角色)**: `code-review`、`code-generation`、`data-analysis`、`document`、`testing`、`general`，每个角色仅暴露必要的工具集
- **三级摘要策略**: 直接使用 (≤500 字符) → 结构化提取 (`## Summary`/`## Result` section) → 截断 + 长度标注，确保返回父代理的结果始终精简
- **Token 预算管理**: 基于字符长度估算 (~4 字符/token)，达到 `tokenBudget` 阈值时自动触发 `forceComplete`，防止子代理无限消耗
- **Worktree 隔离**: 子代理在独立的工作树中执行文件操作，避免多个子代理并行修改同一文件产生冲突
- **并行执行**: `executeDecomposedTask()` 支持批次并行 (`maxConcurrency` 默认 3)，多个子代理可同时处理不同子任务

## 使用示例

### 在 Agent 会话中查看子代理状态

```bash
chainlesschain agent
> /sub-agents
# 输出:
# 活跃子代理: 2
#   sub-a1b2c3 [code-review] — "审查 auth 模块" (迭代 3/8)
#   sub-d4e5f6 [testing] — "编写单元测试" (迭代 1/8)
# 最近完成: 5
#   sub-x7y8z9 [document] — 完成 (摘要: 128字符)
```

### 自动分解复杂任务

当用户在 agent 会话中提出复杂任务时，LLM 会自动调用 `spawn_sub_agent` 分解执行：

```
> 请审查 src/auth/ 目录的安全性，同时为关键函数编写单元测试

# LLM 自动分解为两个子代理:
# 1. spawn_sub_agent(role="code-review", task="审查 src/auth/ 安全性", tools=["read_file","search_files","list_dir"])
# 2. spawn_sub_agent(role="testing", task="为 src/auth/ 关键函数编写单元测试", tools=["read_file","write_file","edit_file","run_shell","search_files","list_dir","run_code"])
# 两个子代理并行执行，各自返回摘要结果给主代理
```

### 手动传递上下文给子代理

```js
// 在 spawn_sub_agent 调用时提供精简上下文
{
  "role": "data-analysis",
  "task": "分析最近 7 天的 API 响应时间趋势",
  "context": "数据库表: api_logs, 关键字段: endpoint, response_ms, created_at",
  "tools": ["read_file", "run_code", "run_shell"]
}
```

未提供 `context` 时，系统会自动从父代理最近 3 条消息提取前 200 字符作为继承上下文。

## 故障排查

### 子代理记忆未找到 (namespace mismatch)

**症状**: 子代理无法召回之前存储的记忆，`recallMemory` 返回空结果。

**原因**: 子代理的命名空间 ID 与存储时的命名空间不匹配。每次 `spawn_sub_agent` 会生成新的 `sub-<UUID>`，不会复用旧命名空间。

**解决方案**: 确认记忆存储时使用了正确的 `namespace` 参数。跨子代理共享的信息应存入 long-term 或 core 层（默认 `"global"` 命名空间），而非 working/shortTerm。

### Token 预算超限触发自动终止

**症状**: 子代理在未完成任务时被 `forceComplete`，日志显示 `token budget exceeded`。

**原因**: 子代理累计消耗的 token 达到 `tokenBudget` 阈值 (~4 字符/token 估算)。

**解决方案**: 在 `spawn_sub_agent` 调用时增大 `tokenBudget`，或拆分任务为更小的子任务。也可检查子代理是否在循环中产生冗余输出。

### 工具不可用 (角色白名单限制)

**症状**: 子代理调用工具时报错 `tool not available` 或工具未出现在可用列表中。

**原因**: 子代理的 `role` 对应的白名单不包含该工具。例如 `code-review` 角色无法使用 `write_file`。

**解决方案**: 更换为合适的角色（如 `code-generation` 或 `general`），或在 `spawn_sub_agent` 的 `tools` 参数中显式指定需要的工具列表（覆盖角色默认白名单）。

### Worktree 清理失败

**症状**: 子代理完成后，临时工作树目录未被删除，磁盘空间逐渐占满。

**原因**: 子代理异常退出（crash/timeout）时清理逻辑未执行，或文件被其他进程锁定。

**解决方案**: WebSocket 会话关闭时会自动调用 `SubAgentRegistry.forceCompleteAll(sessionId)` 清理资源。如仍有残留，可手动删除临时工作树目录，或调用 `SubAgentRegistry.getInstance().cleanup(maxAgeMs)` 清理超时条目。

## 安全考虑

| 安全机制 | 说明 |
|----------|------|
| 隔离消息历史 | 子代理的 `messages[]` 完全独立，防止子代理之间或子代理与父代理之间的数据泄漏 |
| 工具白名单 | 按角色限制可用工具，`code-review` 仅有只读权限，`document` 无法执行 shell 命令，最小权限原则 |
| Token 预算 | 每个子代理有独立的 token 消耗上限，超限自动终止，防止失控的子代理产生高额 API 费用 |
| Worktree 隔离 | 子代理在独立工作树中操作文件，避免并行子代理的文件写入冲突，也防止子代理意外修改父代理的工作区 |
| 摘要化输出 | 子代理结果经三级摘要压缩后才注入父代理，限制信息回传量，降低上下文注入攻击面 |
| 迭代上限 | `maxIterations` (默认 8) 限制子代理最大循环次数，防止无限循环消耗资源 |

## 相关文档

- [Agent 会话管理](./agent-session.md) — Agent REPL 主循环与会话生命周期
- [Cowork 多代理协作](./cowork-system.md) — Debate Review、AB Comparator 等多代理协作模式
- [Plan Mode](./plan-mode.md) — 工具审批与计划模式
- [Worktree Isolator](./worktree-isolator.md) — Git worktree 隔离机制详解
