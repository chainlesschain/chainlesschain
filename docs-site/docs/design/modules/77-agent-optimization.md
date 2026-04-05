# 77. Agent 架构优化系统

## 1. 模块概述

### 1.1 目标

借鉴 Claude Code 的 12 层渐进式 harness 架构，为 ChainlessChain CLI Agent 实现 5 个核心优化模块：

1. **Feature Flags** — 特性门控，支持渐进式发布
2. **Prompt Compressor** — 上下文压缩，5 策略流水线
3. **JSONL Session Store** — 追加式会话持久化，崩溃恢复
4. **Background Task Manager** — 后台任务队列，IPC 通信
5. **Worktree Isolator** — Git Worktree 隔离执行

### 1.2 设计原则

- **渐进式启用**: 所有新功能通过 Feature Flags 门控，默认关闭（除 PROMPT_COMPRESSOR）
- **零依赖**: 不引入新的 npm 依赖，利用 Node.js 内置模块
- **崩溃安全**: JSONL 同步写入 + append-only 设计
- **资源隔离**: Git Worktree 共享对象库，避免完整克隆开销

## 2. 架构设计

### 2.1 模块关系图

```
                    ┌─────────────────────┐
                    │    Feature Flags     │
                    │   (6 registered)     │
                    └──────┬──────┬───────┘
                    gates  │      │  gates
              ┌────────────┘      └────────────┐
              ▼                                 ▼
    ┌──────────────────┐            ┌───────────────────┐
    │ Prompt Compressor │            │ Background Tasks   │
    │ (5 strategies)    │            │ (fork + IPC)       │
    └────────┬─────────┘            └─────────┬─────────┘
             │ compact events                  │ uses
             ▼                                 ▼
    ┌──────────────────┐            ┌───────────────────┐
    │ JSONL Session     │            │ Worktree Isolator  │
    │ Store (append)    │            │ (git worktree)     │
    └──────────────────┘            └───────────────────┘
```

### 2.2 文件清单

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/lib/feature-flags.js` | ~90 | 特性标志注册、查询、A/B 分流 |
| `src/lib/prompt-compressor.js` | ~200 | 5 策略压缩器 + token 估算 |
| `src/lib/jsonl-session-store.js` | ~250 | JSONL 追加式会话管理 |
| `src/lib/background-task-manager.js` | ~200 | 任务生命周期 + 子进程管理 |
| `src/lib/background-task-worker.js` | ~50 | 子进程执行器 |
| `src/lib/worktree-isolator.js` | ~225 | Git Worktree CRUD + 隔离执行 |
| `src/commands/config.js` | 扩展 | `features list/enable/disable` 子命令 |

## 3. Feature Flags 详细设计

### 3.1 标志位注册表

```javascript
const FLAG_REGISTRY = {
  BACKGROUND_TASKS:    { default: false, description: "Enable background task queue" },
  WORKTREE_ISOLATION:  { default: false, description: "Enable git worktree isolation" },
  CONTEXT_SNIP:        { default: false, description: "Enable snipCompact strategy" },
  CONTEXT_COLLAPSE:    { default: false, description: "Enable contextCollapse strategy" },
  JSONL_SESSION:       { default: false, description: "Use JSONL session format" },
  PROMPT_COMPRESSOR:   { default: true,  description: "Enable prompt compressor" },
};
```

### 3.2 优先级链

```
CC_FLAG_<NAME> 环境变量 (string "true"/"false")
        ↓ (未设置时)
config.features.<NAME> (boolean)
        ↓ (未设置时)
FLAG_REGISTRY[name].default
```

### 3.3 百分比灰度

`featureVariant(name)` 使用 `name + machineId` 的 hash 值取模实现确定性分流，同一机器始终返回相同变体。

## 4. Prompt Compressor 详细设计

### 4.1 策略流水线

```
输入消息 → Deduplicate → Truncate → Summarize → SnipCompact → ContextCollapse → 输出
              (始终)       (始终)     (可选LLM)    (CONTEXT_SNIP)  (CONTEXT_COLLAPSE)
```

### 4.2 Token 估算算法

```javascript
function estimateTokens(text) {
  let tokens = 0;
  for (const char of text) {
    if (char.charCodeAt(0) > 0x4E00) tokens += 1.5;  // CJK
    else tokens += 0.25;  // ASCII/Latin
  }
  return Math.ceil(tokens);
}
```

### 4.3 自动压缩触发

当消息总 token 数超过 `maxTokens * 0.8` 时，`shouldAutoCompact()` 返回 true，由 `agent-repl.js` 自动触发压缩流程。

## 5. JSONL Session Store 详细设计

### 5.1 事件格式

```jsonl
{"type":"session_start","sessionId":"abc","data":{"title":"Chat","provider":"ollama"},"ts":1711000000000}
{"type":"user_message","sessionId":"abc","data":{"role":"user","content":"hello"},"ts":1711000001000}
{"type":"assistant_message","sessionId":"abc","data":{"role":"assistant","content":"hi"},"ts":1711000002000}
{"type":"compact","sessionId":"abc","data":{"messages":[...],"stats":{...}},"ts":1711000003000}
```

### 5.2 崩溃恢复机制

- `user_message` 使用 `writeFileSync`（同步写入）确保不丢失
- `assistant_message` 使用 `appendFileSync`（仍然同步但语义上是追加）
- `rebuildMessages()` 从最后一个 `compact` 事件开始重建，避免重放全部历史

### 5.3 会话分叉

`forkSession(sourceId)` 复制源会话所有事件到新文件，末尾追加 `fork` 标记事件。

## 6. Background Task Manager 详细设计

### 6.1 任务状态机

```
PENDING ──start()──→ RUNNING ──success──→ COMPLETED
                        │
                        ├──failure──→ FAILED
                        │
                        └──timeout──→ TIMEOUT
```

### 6.2 子进程通信（IPC）

```
父进程                        子进程 (background-task-worker.js)
  │                              │
  │──fork()──────────────────→│  │
  │                              │──execSync(command)
  │  ←──{ type: "heartbeat" }──│  │  (每 5 秒)
  │  ←──{ type: "heartbeat" }──│  │
  │  ←──{ type: "result", data }─│  (成功)
  │  或 { type: "error", error }─│  (失败)
```

### 6.3 持久化

任务元数据追加写入 `~/.chainlesschain/tasks/queue.jsonl`，支持进程重启后恢复未完成任务。

## 7. Worktree Isolator 详细设计

### 7.1 目录结构

```
repo/
├── .worktrees/
│   ├── agent-task-123/     ← worktree for agent/task-123 branch
│   └── agent-task-456/     ← worktree for agent/task-456 branch
├── src/
└── ...
```

### 7.2 isolateTask 流程

```
1. createWorktree(repoDir, "agent/{taskId}")
   → git worktree add .worktrees/agent-{taskId} -b agent/{taskId} HEAD
2. fn(worktreePath)
   → 在隔离目录中执行任务
3. finally: removeWorktree()
   → git worktree remove + (无新 commit 时) git branch -D
```

### 7.3 清理策略

- `isolateTask` 的 finally 块自动清理
- `cleanupAgentWorktrees()` 清理所有 `agent/*` 分支的 worktree
- `pruneWorktrees()` 清理目录已不存在的陈旧 worktree

## 8. CLI 集成

### 8.1 config features 命令

```bash
# 列出所有标志位
chainlesschain config features list
# 输出:
#   ● ON  PROMPT_COMPRESSOR [default]
#   ○ OFF BACKGROUND_TASKS [default]
#   ...

# 启用/禁用
chainlesschain config features enable CONTEXT_SNIP
chainlesschain config features disable CONTEXT_SNIP
```

### 8.2 agent-repl.js 集成

- `PROMPT_COMPRESSOR` 标志启用时，创建 `PromptCompressor` 实例
- 每轮对话后检查 `shouldAutoCompact()`，自动触发压缩
- `/compact` 命令优先使用 Prompt Compressor

## 9. 测试策略

### 9.1 测试金字塔

```
         ╱╲
        ╱E2E╲        37 tests — CLI 命令级验证
       ╱──────╲
      ╱ 集成   ╲     42 tests — 跨模块交互
     ╱──────────╲
    ╱   单元     ╲   255 tests — 模块内部逻辑
   ╱──────────────╲
```

### 9.2 测试文件

| 文件 | 类型 | 测试数 |
|------|------|--------|
| `feature-flags.test.js` | 单元 | 27 |
| `prompt-compressor.test.js` | 单元 | 24 |
| `jsonl-session-store.test.js` | 单元 | 21 |
| `background-task-manager.test.js` | 单元 | 20 |
| `worktree-isolator.test.js` | 单元 | 12 |
| `agent-optimization-extended.test.js` | 单元 | 56 |
| `v5029-features.test.js` | 单元 | 33 |
| `v5029-extended.test.js` | 单元 | 62 |
| `agent-optimization-workflow.test.js` | 集成 | 23 |
| `v5029-workflow.test.js` | 集成 | 19 |
| `agent-optimization-commands.test.js` | E2E | 23 |
| `v5029-commands.test.js` | E2E | 14 |
| **合计** | | **334** |

## 10. 已完成的增强 (v5.0.2.9)

1. ~~**JSONL_SESSION 全面替换**~~: ✅ `agent-repl.js` 和 `session.js` 完整集成 — 创建/保存/恢复/列表均支持 JSONL 模式
2. ~~**Background Tasks UI**~~: ✅ Web Panel 新增「后台任务」监控页面（Pinia store + Vue3 组件 + WS 协议）
3. ~~**Worktree + Sub-Agent**~~: ✅ `SubAgentContext` 集成 `isolateTask()` — 子 Agent 自动在隔离 worktree 中执行
4. ~~**Context Compression 自适应**~~: ✅ 30+ 模型 context window 注册表 + `adaptiveThresholds()` + `adaptToModel()` 动态切换

## 11. 后续规划

1. **JSONL_SESSION 默认启用**: 经充分验证后将 `JSONL_SESSION` 默认值改为 `true`
2. **Background Task Notifications**: 任务完成后通过 WebSocket 推送实时通知到 Web Panel
3. **Worktree 合并助手**: 子 Agent 在 worktree 中完成工作后，提供 diff 预览和一键合并到主分支
4. **压缩策略 A/B 测试**: 利用 `featureVariant()` 对比不同压缩阈值的效果
