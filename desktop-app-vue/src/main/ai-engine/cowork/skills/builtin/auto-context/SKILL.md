---
name: auto-context
display-name: Auto Context
description: 智能上下文检测 - 自动识别AI所需的文件、函数和上下文，优化token使用
version: 1.0.0
category: ai
user-invocable: true
tags: [context, auto-detect, files, tokens, optimization]
capabilities: [intent-detection, file-scoring, token-budgeting]
tools:
  - file_reader
  - code_analyzer
os: [win32, darwin, linux]
handler: ./handler.js
instructions: |
  Use this skill when the AI needs to automatically detect which files and functions are
  relevant to a user's query. For --detect mode, extract keywords from the query, score
  files by relevance (path match, import chain, recent modification), and return a ranked
  list within a token budget. For --budget mode, set the maximum token budget for context.
  For --files mode, list files related to a query with scores. Always respect token limits
  and prioritize the most relevant files.
examples:
  - input: "/auto-context --detect fix the WebRTC connection timeout"
    output: "Detected 5 relevant files (2,400 tokens): webrtc-data-channel.js (score: 9.2), P2PClient.kt (7.8), signaling-handlers.js (6.5). Budget: 4096 tokens, used: 2400."
  - input: "/auto-context --budget 8000"
    output: "Token budget set to 8,000. Context will be trimmed to fit."
  - input: "/auto-context --files permission system"
    output: "Found 6 files: permission-engine.js (core), team-manager.js, delegation-manager.js, approval-workflow-manager.js, permission-ipc.js, tests/permission.test.js."
input-schema:
  type: object
  properties:
    mode:
      type: string
      enum: [detect, budget, files]
      description: Detection mode
    query:
      type: string
      description: Query to detect context for
    tokenBudget:
      type: number
      description: Maximum token budget
output-schema:
  type: object
  properties:
    files: { type: array }
    totalTokens: { type: number }
    budget: { type: number }
    keywords: { type: array }
model-hints:
  preferred: [claude-opus-4-6, gpt-4o]
cost: free
author: ChainlessChain
license: MIT
homepage: https://github.com/nicekid1/ChainlessChain
repository: https://github.com/nicekid1/ChainlessChain
---

# Auto Context 技能

## 描述

智能检测 AI 需要的文件、函数和上下文。通过意图关键词提取、文件相关度评分和 Token 预算管理，自动为 AI 提供最相关的代码上下文。灵感来自 Cursor 的 Auto-context 和 Cline 的上下文管理。

## 使用方法

```
/auto-context [选项]
```

## 模式

### 检测模式 (--detect)

自动检测相关文件和上下文

### 预算模式 (--budget)

设置 Token 预算上限

### 文件模式 (--files)

列出相关文件及评分
