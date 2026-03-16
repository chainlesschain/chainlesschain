# 子代理隔离系统 (Sub-Agent Isolation)

> v5.0.1.7+ — 子代理上下文隔离与协作管理

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

## 测试覆盖

- **单元测试**: sub-agent-context, sub-agent-registry, scoped-context-engineering, namespaced-memory
- **集成测试**: sub-agent-isolation (spawn_sub_agent + 命名空间隔离)
- **E2E 测试**: 模块导入验证, 工具定义验证
