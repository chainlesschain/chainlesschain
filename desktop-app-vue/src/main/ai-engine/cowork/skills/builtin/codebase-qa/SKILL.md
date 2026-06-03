---
name: codebase-qa
display-name: Codebase Q&A
description: 代码库语义问答 - 基于文件索引和符号提取，回答关于代码库的任何问题
version: 1.0.0
category: knowledge
user-invocable: true
tags: [codebase, qa, search, index, symbols]
capabilities: [file-indexing, symbol-extraction, semantic-search]
tools:
  - file_reader
  - code_analyzer
os: [win32, darwin, linux]
handler: ./handler.js
instructions: |
  Use this skill when the user asks questions about the codebase. For --ask mode, scan
  source files, extract symbols (functions, classes, exports), match keywords against the
  question, and assemble relevant code snippets as context for answering. For --index mode,
  build a full file index with symbols. For --search mode, find files and symbols matching
  a query. Always cite file paths and line numbers in answers.
examples:
  - input: "/codebase-qa --ask How does the session manager handle compression?"
    output: "SessionManager (src/main/llm/session-manager.js) uses auto-compression at 70% context capacity. The compress() method calls ContextEngineering.compressContext() which preserves 30% of oldest messages..."
  - input: "/codebase-qa --index"
    output: "Indexed 245 source files, extracted 1,832 symbols (412 classes, 1,420 functions). Index ready for queries."
  - input: "/codebase-qa --search PermissionEngine"
    output: "Found 'PermissionEngine' in 3 files: src/main/permission/permission-engine.js (class definition, L15), src/main/permission/permission-ipc.js (usage, L23), tests/unit/permission.test.js (tests, L8)."
input-schema:
  type: object
  properties:
    mode:
      type: string
      enum: [ask, index, search]
      description: Q&A mode
    query:
      type: string
      description: Question or search query
output-schema:
  type: object
  properties:
    answer: { type: string }
    references: { type: array }
    confidence: { type: number }
    indexStats: { type: object }
model-hints:
  preferred: [claude-opus-4-6, gpt-4o]
cost: free
author: ChainlessChain
license: MIT
homepage: https://github.com/nicekid1/ChainlessChain
repository: https://github.com/nicekid1/ChainlessChain
---

# Codebase Q&A 技能

## 描述

基于文件索引和符号提取的代码库语义问答系统。扫描源文件、提取符号（函数、类、导出），通过关键词匹配和 TF-IDF 排名回答关于代码库的问题。灵感来自 Continue.dev 的 @codebase 功能。

## 使用方法

```
/codebase-qa [选项]
```

## 模式

### 问答 (--ask)

```
/codebase-qa --ask How does the permission system work?
```

### 索引 (--index)

```
/codebase-qa --index
```

### 搜索 (--search)

```
/codebase-qa --search SessionManager
```

## 索引内容

- 文件路径和大小
- 函数/类/方法定义
- 导出符号
- 注释和文档字符串
- import/require 依赖关系
