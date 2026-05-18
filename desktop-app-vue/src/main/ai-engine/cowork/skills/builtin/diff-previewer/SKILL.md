---
name: diff-previewer
display-name: Diff Previewer
description: 多文件差异预览器 - 在应用AI变更前展示丰富的diff预览，支持部分接受和变更地图
version: 1.0.0
category: development
user-invocable: true
tags: [diff, preview, change-map, review, undo, partial-accept]
capabilities:
  [diff-generation, change-visualization, partial-accept, token-optimization]
tools:
  - file_reader
  - git_operations
handler: ./handler.js
instructions: |
  Use this skill when the user wants to preview changes before applying them,
  review staged/unstaged git diffs, compare two files, or get a compact summary
  of modifications for AI context. Parses unified diff format into structured
  data with file-level and directory-level statistics. Includes token estimation
  for context window optimization.
examples:
  - input: "/diff-previewer --staged"
    output: "Structured diff of all staged changes with per-file additions/deletions"
  - input: "/diff-previewer --unstaged"
    output: "Structured diff of all unstaged working tree changes"
  - input: "/diff-previewer --compare src/old.js src/new.js"
    output: "Side-by-side diff between two specific files"
  - input: "/diff-previewer --stats"
    output: "Change statistics with per-directory breakdown and change map"
  - input: "/diff-previewer --summary"
    output: "Compact token-efficient summary suitable for AI context injection"
input-schema:
  type: object
  properties:
    mode:
      type: string
      enum: [--staged, --unstaged, --compare, --stats, --summary]
      description: Operation mode
    file1:
      type: string
      description: First file path for --compare mode
    file2:
      type: string
      description: Second file path for --compare mode
output-schema:
  type: object
  properties:
    files:
      type: array
      items:
        type: object
        properties:
          path: { type: string }
          status: { type: string, enum: [A, M, D, R] }
          hunks:
            type: array
            items:
              type: object
              properties:
                oldStart: { type: integer }
                oldCount: { type: integer }
                newStart: { type: integer }
                newCount: { type: integer }
                lines: { type: array, items: { type: string } }
          additions: { type: integer }
          deletions: { type: integer }
    totalAdditions: { type: integer }
    totalDeletions: { type: integer }
    tokenEstimate: { type: integer }
model-hints:
  context-priority: high
  token-budget: 4000
cost: free
os: [win32, darwin, linux]
author: ChainlessChain
license: MIT
---

# 差异预览器技能

## 描述

多文件差异预览器，在应用AI变更前提供丰富的diff预览。支持查看git暂存/未暂存差异、比较任意两个文件、生成变更统计和变更地图。提供token估算帮助优化AI上下文窗口使用。

## 使用方法

```
/diff-previewer <mode> [arguments]
```

## 模式

| 模式         | 说明                                     |
| ------------ | ---------------------------------------- |
| `--staged`   | 显示git暂存区的差异（git diff --cached） |
| `--unstaged` | 显示工作区未暂存的差异（git diff）       |
| `--compare`  | 比较两个指定文件的差异                   |
| `--stats`    | 显示变更统计，包含目录级别的分解         |
| `--summary`  | 紧凑的token高效摘要，适合注入AI上下文    |

## 输出格式

### 结构化差异

```json
{
  "files": [
    {
      "path": "src/main/index.js",
      "status": "M",
      "additions": 15,
      "deletions": 3,
      "hunks": [
        {
          "oldStart": 10,
          "oldCount": 5,
          "newStart": 10,
          "newCount": 17,
          "lines": ["..."]
        }
      ]
    }
  ],
  "totalAdditions": 15,
  "totalDeletions": 3,
  "tokenEstimate": 450
}
```

### 变更地图

```
src/main/
  index.js        ████░░░░░░ +15 -3
  database.js     ██████████ +42 -10
src/renderer/
  App.vue         ██░░░░░░░░ +5  -1
```

## 示例

查看暂存的变更：

```
/diff-previewer --staged
```

查看未暂存的变更：

```
/diff-previewer --unstaged
```

比较两个文件：

```
/diff-previewer --compare src/old.js src/new.js
```

变更统计概览：

```
/diff-previewer --stats
```

AI上下文摘要：

```
/diff-previewer --summary
```
