---
name: context-loader
display-name: Context Loader
description: 智能上下文加载技能 - 意图分析、相关文件预加载、token预算管理
version: 1.0.0
category: knowledge
user-invocable: true
tags: [context, loader, prime, relevant-files, token-budget, intent]
capabilities:
  [
    intent-analysis,
    file-relevance-scoring,
    context-priming,
    token-budget-management,
  ]
tools:
  - file_reader
  - code_analyzer
instructions: |
  Use this skill when the user needs the AI to understand a specific area of the
  codebase before answering questions or making changes. Analyze the user's intent,
  score file relevance, and proactively load the most relevant source files, schemas,
  git history, and documentation into context. Manage a token budget to avoid
  overloading the context window. This enhances the existing context-engineering.js
  KV-Cache optimization with a user-facing intent-driven layer.
examples:
  - input: "/context-loader prime 'session management'"
    output: "Loaded 6 files (4200 tokens): session-manager.js, session-compressor.js, conversation-ipc.js, session.ts..."
  - input: "/context-loader prime 'p2p signaling'"
    output: "Loaded 5 files (3800 tokens): signaling-handlers.js, mobile-bridge.js, webrtc-data-channel.js..."
  - input: "/context-loader budget 8000"
    output: "Context budget set to 8000 tokens. Will prioritize highest-relevance files."
os: [win32, darwin, linux]
author: ChainlessChain
---

# 智能上下文加载技能

## 描述

根据用户意图智能预加载相关代码文件、数据库 Schema、Git 历史和文档到 AI 上下文。通过 token 预算管理确保不超载上下文窗口，提升 AI 对话质量。

## 使用方法

```
/context-loader <操作> [参数]
```

## 操作

### 主题预加载

```
/context-loader prime <主题>
```

分析主题关键词，搜索相关文件并加载:
- 文件名匹配
- 内容关键词匹配
- 导入关系追踪
- 按相关度排序，控制在 token 预算内

### 设置 Token 预算

```
/context-loader budget <tokens>
```

设置上下文加载的最大 token 数（默认: 6000）。

### 查看当前上下文

```
/context-loader status
```

显示当前已加载的文件和 token 使用情况。

### 清除上下文

```
/context-loader clear
```

清除所有预加载的上下文。

## 加载策略

### 意图分析

根据主题词识别相关模块:

| 关键词 | 模块 | 关键文件 |
| ------ | ---- | -------- |
| session, 会话 | llm | session-manager.js, session-compressor.js |
| memory, 记忆 | llm | permanent-memory-manager.js |
| search, 搜索 | rag | hybrid-search-engine.js, bm25-search.js |
| p2p, webrtc | p2p | signaling-handlers.js, webrtc-data-channel.js |
| permission, 权限 | permission | permission-engine.js, team-manager.js |
| browser, 浏览器 | browser | browser-engine.js, computer-use-agent.js |
| skill, 技能 | skills | index.js, skill-md-parser.js |
| mcp | mcp | mcp-tool-adapter.js, community-registry.js |
| audit, 审计 | audit | enterprise-audit-logger.js |

### 优先级规则

1. **精确匹配**: 文件名包含关键词 (最高分)
2. **内容匹配**: 文件内容包含关键词
3. **依赖关联**: 被匹配文件导入的模块
4. **最近修改**: 近期 Git 提交涉及的文件
5. **文档**: 相关的 .md 文件

### Token 预算分配

```
总预算 (默认 6000 tokens)
├── 核心文件 (60%) - 最相关的 2-3 个文件
├── 辅助文件 (25%) - 依赖和关联文件
├── Schema/配置 (10%) - 数据库结构、配置
└── Git 历史 (5%) - 相关的最近提交
```

## 输出格式

```
Context Loaded
==============
Topic: "session management"
Budget: 6000 tokens (used: 4200)

Files loaded:
  📄 session-manager.js (1200 tokens) - Core session logic
  📄 session-compressor.js (800 tokens) - Context compression
  📄 conversation-ipc.js (700 tokens) - IPC handlers
  📄 stores/session.ts (600 tokens) - Frontend state
  📄 context-engineering.js (500 tokens) - KV-Cache optimization
  📄 SESSION_MANAGER.md (400 tokens) - Documentation

Remaining budget: 1800 tokens
```

## 示例

预加载上下文:

```
/context-loader prime "数据库迁移"
```

设置预算:

```
/context-loader budget 10000
```

查看状态:

```
/context-loader status
```
