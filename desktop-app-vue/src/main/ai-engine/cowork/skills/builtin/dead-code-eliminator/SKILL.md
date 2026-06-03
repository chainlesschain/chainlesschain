---
name: dead-code-eliminator
display-name: Dead Code Eliminator
description: 死代码检测 - 扫描未使用的导出、变量、文件，提供安全删除建议
version: 1.0.0
category: development
user-invocable: true
tags: [dead-code, unused, exports, cleanup, tree-shaking]
capabilities: [export-analysis, import-tracing, unused-detection]
tools:
  - file_reader
  - code_analyzer
os: [win32, darwin, linux]
handler: ./handler.js
instructions: |
  Use this skill to find and eliminate dead code. For --scan mode, perform a full scan
  of exports, imports, variables, and files to find unused code. For --exports mode,
  find exported symbols that are never imported anywhere. For --files mode, find source
  files that are never imported by other files. For --variables mode, find declared but
  unused variables and functions within files. Always provide safe deletion suggestions
  with estimated lines saved.
examples:
  - input: "/dead-code-eliminator --scan"
    output: "Found 23 dead code instances: 8 unused exports, 5 unreferenced files, 10 unused variables. Estimated savings: 450 lines."
  - input: "/dead-code-eliminator --exports"
    output: "Unused exports: formatDate (utils.js:15), parseConfig (config.js:42), OldService (legacy.js:8). These are exported but never imported."
  - input: "/dead-code-eliminator --files"
    output: "Unreferenced files: old-handler.js, temp-utils.js, deprecated-api.js. These files are not imported by any other source file."
input-schema:
  type: object
  properties:
    mode:
      type: string
      enum: [scan, exports, files, variables]
      description: Detection mode
output-schema:
  type: object
  properties:
    deadCode: { type: array }
    summary: { type: object }
    estimatedSavings: { type: number }
model-hints:
  preferred: [claude-sonnet-4-5-20250929]
cost: free
author: ChainlessChain
license: MIT
homepage: https://github.com/nicekid1/ChainlessChain
repository: https://github.com/nicekid1/ChainlessChain
---

# Dead Code Eliminator 技能

## 描述

扫描代码库中未使用的导出、变量和文件，提供安全删除建议和预估节省行数。灵感来自 knip 和 ts-prune。

## 使用方法

```
/dead-code-eliminator [选项]
```

## 检测类型

### 未使用导出 (--exports)

扫描所有 exports → 交叉引用所有 imports → 找到从未被导入的导出

### 未引用文件 (--files)

找到没有被任何其他源文件 import/require 的文件

### 未使用变量 (--variables)

在单个文件内查找声明但从未使用的变量和函数

### 全量扫描 (--scan)

执行以上所有检测
