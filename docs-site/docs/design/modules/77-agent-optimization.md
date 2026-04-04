# Agent 架构优化系统 (Agent Architecture Optimization)

## 概述

Agent 架构优化系统是 ChainlessChain CLI 的 5 个核心模块，借鉴 Claude Code 的 12 层渐进式 harness 架构，为 CLI Agent 提供特性门控、上下文压缩、会话持久化、后台任务管理和 Git Worktree 隔离能力。

## 版本历史

| 版本 | 变更 |
|------|------|
| v5.0.2.9 | 初始实现：5 个优化模块 + 206 测试（160 单元 + 23 集成 + 23 E2E），修复 compress(null) 崩溃 |

## 模块架构

```
packages/cli/src/lib/
  feature-flags.js          ← 特性门控（6 个标志位）
  prompt-compressor.js      ← 上下文压缩（5 策略）
  jsonl-session-store.js    ← JSONL 追加式会话持久化
  background-task-manager.js ← 后台任务队列 + IPC
  background-task-worker.js ← 子进程执行器
  worktree-isolator.js      ← Git Worktree 隔离
```

## 模块详解

### 1. Feature Flags（特性门控）

**文件**: `feature-flags.js`

提供渐进式发布能力，支持按环境变量、配置文件、默认值三级优先级控制功能开关。

**6 个注册标志位**:

| 标志名 | 默认值 | 说明 |
|--------|--------|------|
| `BACKGROUND_TASKS` | false | 启用后台任务队列 |
| `WORKTREE_ISOLATION` | false | 启用 Git Worktree 隔离 |
| `CONTEXT_SNIP` | false | 启用 snipCompact 压缩策略 |
| `CONTEXT_COLLAPSE` | false | 启用 contextCollapse 折叠策略 |
| `JSONL_SESSION` | false | 使用 JSONL 追加格式持久化 |
| `PROMPT_COMPRESSOR` | true | 启用 CLI 提示压缩器 |

**优先级**: `CC_FLAG_<NAME>` 环境变量 > `config.features.<NAME>` 配置 > 默认值

**百分比灰度**: `featureVariant(name)` 基于确定性哈希实现 A/B 分流

**CLI 命令**:

```bash
chainlesschain config features list       # 列出所有标志位及状态
chainlesschain config features enable CONTEXT_SNIP   # 启用
chainlesschain config features disable CONTEXT_SNIP  # 禁用
```

### 2. Prompt Compressor（上下文压缩）

**文件**: `prompt-compressor.js`

借鉴 Claude Code 的 3 层压缩策略（autoCompact / snipCompact / contextCollapse），扩展为 5 策略流水线：

| 策略 | 说明 | 门控标志 |
|------|------|----------|
| Deduplicate | Jaccard 相似度去重（阈值 0.7） | 始终启用 |
| Truncate | 保留最近 N 条消息 | 始终启用 |
| Summarize | LLM 摘要压缩（可选） | 始终启用 |
| SnipCompact | 移除 `[PROCESSED]` 等陈旧标记 | `CONTEXT_SNIP` |
| ContextCollapse | 折叠连续 tool 调用序列 | `CONTEXT_COLLAPSE` |

**Token 估算**: 中文 1.5 字符/token，英文 4 字符/token

**自动触发**: `shouldAutoCompact(messages)` 在消息超过阈值时返回 true，集成于 `agent-repl.js`

### 3. JSONL Session Store（追加式会话持久化）

**文件**: `jsonl-session-store.js`

替代全量 JSON 覆写，采用 JSONL 追加式写入实现崩溃恢复：

**事件类型**:
- `session_start` — 会话元数据
- `user_message` / `assistant_message` — 对话消息（user 同步写入）
- `tool_call` / `tool_result` — 工具调用
- `compact` — 压缩快照（包含压缩后的消息数组）
- `fork` — 会话分叉标记

**核心 API**:

```javascript
startSession(id, meta)       // 创建会话
appendUserMessage(id, content) // 同步追加用户消息
appendAssistantMessage(id, content) // 异步追加助手消息
appendCompactEvent(id, stats)  // 写入压缩快照
readEvents(id)                // 读取所有事件
rebuildMessages(id)           // 从最后一个 compact 事件重建消息
forkSession(sourceId)         // 分叉会话（复制事件 + fork 标记）
listJsonlSessions(options)    // 列出所有会话（按更新时间排序）
```

**崩溃恢复**: 用户消息使用 `writeFileSync` 同步写入，助手消息使用 `appendFileSync`，确保断电后数据不丢失。

### 4. Background Task Manager（后台任务管理）

**文件**: `background-task-manager.js` + `background-task-worker.js`

基于 EventEmitter 的后台任务队列，支持 `child_process.fork()` 子进程执行：

**任务生命周期**: `PENDING → RUNNING → COMPLETED / FAILED / TIMEOUT`

**特性**:
- 最大并发数限制（`maxConcurrent`）
- 心跳超时检测（`heartbeatTimeout`，默认 30s）
- 任务持久化到 `queue.jsonl`
- IPC 消息通信（heartbeat / result / error）
- 事件驱动（`task:complete` 事件）
- 清理过期任务（`cleanup(maxAge)`）

**API**:

```javascript
const manager = new BackgroundTaskManager({ maxConcurrent: 5 });
const task = manager.create({ command: "npm test", description: "Run tests" });
manager.start(task.id);       // fork 子进程执行
manager.stop(task.id);        // SIGTERM 停止
manager.cleanup(3600000);     // 清理 1 小时前的已完成任务
manager.destroy();            // 销毁所有任务和定时器
```

### 5. Worktree Isolator（Git Worktree 隔离）

**文件**: `worktree-isolator.js`

利用 `git worktree` 为并行 Agent 任务创建隔离工作目录，避免文件操作干扰主工作树：

**低级 API**:

```javascript
createWorktree(repoDir, branchName, baseBranch)  // 创建 worktree + 新分支
removeWorktree(repoDir, path, { deleteBranch })   // 移除 worktree（可选删分支）
listWorktrees(repoDir)                             // 列出所有 worktree
pruneWorktrees(repoDir)                            // 清理陈旧 worktree
```

**高级 API**:

```javascript
// 在隔离 worktree 中执行任务，自动清理
const { result, branch } = await isolateTask(repoDir, "task-123", async (wtPath) => {
  // wtPath 是隔离的工作目录，分支名为 agent/task-123
  return doWork(wtPath);
});

// 崩溃恢复：清理所有 agent/* worktree
cleanupAgentWorktrees(repoDir);
```

**分支命名规则**: `agent/{taskId}`，保存在 `.worktrees/` 目录下

## 模块交互关系

```
┌─────────────────┐    gates    ┌──────────────────┐
│  Feature Flags  │───────────→│ Prompt Compressor │
│  (门控层)       │            │ (压缩层)          │
└────────┬────────┘            └────────┬──────────┘
         │ gates                        │ compacts
         ▼                              ▼
┌──────────────────┐  stores   ┌──────────────────┐
│ Background Tasks │           │ JSONL Session     │
│ (执行层)         │           │ Store (持久化层)  │
└────────┬─────────┘           └──────────────────┘
         │ uses
         ▼
┌──────────────────┐
│ Worktree Isolator│
│ (隔离层)         │
└──────────────────┘
```

## 测试覆盖

| 测试类型 | 文件 | 测试数 |
|----------|------|--------|
| 单元测试 | `feature-flags.test.js` | 27 |
| 单元测试 | `prompt-compressor.test.js` | 24 |
| 单元测试 | `jsonl-session-store.test.js` | 21 |
| 单元测试 | `background-task-manager.test.js` | 20 |
| 单元测试 | `worktree-isolator.test.js` | 12 |
| 单元测试 | `agent-optimization-extended.test.js` | 56 |
| 集成测试 | `agent-optimization-workflow.test.js` | 23 |
| E2E 测试 | `agent-optimization-commands.test.js` | 23 |
| **总计** | | **206** |

## 设计决策

### 为什么用 JSONL 而不是 SQLite？

- 追加式写入天然支持崩溃恢复（无事务开销）
- 会话数据是顺序的，JSONL 格式自然契合
- 避免引入 SQLite 依赖（CLI 包保持轻量 ~2MB）

### 为什么用 Feature Flags？

- 新功能可渐进式发布，降低风险
- 环境变量覆盖机制方便 CI/CD 和调试
- 百分比灰度支持 A/B 测试

### 为什么用 Git Worktree 而不是 tmpdir？

- Worktree 共享 `.git` 对象库，无需完整克隆
- 天然支持分支管理，任务结果可通过 PR 合并
- `git worktree prune` 提供内置清理机制
