---
name: architect-mode
display-name: Architect Mode
description: 双阶段架构模式 - 先规划后编辑，分离推理与代码修改，提升多文件编辑准确率
version: 1.0.0
category: development
user-invocable: true
tags: [architect, planning, multi-file, edit, reasoning, two-phase]
capabilities:
  [architecture-planning, edit-generation, plan-review, multi-file-coordination]
tools:
  - file_reader
  - file_writer
  - code_analyzer
  - project_navigator
handler: ./handler.js
instructions: |
  Use this skill when the user needs to make complex, multi-file changes. First phase: analyze
  the codebase and generate a structured plan (which files to modify, what changes, in what order).
  Second phase: translate the plan into precise file edits. The user can review and approve/modify
  the plan before execution. This improves accuracy by separating "what to do" from "how to do it".
examples:
  - input: "/architect-mode 'add user authentication with JWT'"
    output: "Plan: 1) Create auth middleware (src/main/auth/jwt-middleware.js) 2) Add login/register routes 3) Update database schema 4) Add frontend login page. Approve? [Y/n]"
  - input: "/architect-mode --plan-only 'refactor database layer to use repository pattern'"
    output: "Architecture Plan: 5 files to create, 8 files to modify. Estimated: 450 lines added, 120 lines modified."
  - input: "/architect-mode --execute plan-001"
    output: "Executing plan-001: 13/13 edits applied successfully. 0 conflicts."
input-schema:
  type: object
  properties:
    task:
      type: string
      description: High-level description of the architectural change
    plan-only:
      type: boolean
      description: Only generate plan, don't execute
    execute:
      type: string
      description: Execute a previously generated plan by ID
output-schema:
  type: object
  properties:
    plan:
      type: object
      description: Structured plan with phases, files, and edits
    edits:
      type: array
      description: List of file edits to apply
    status:
      type: string
      description: Current status (planning, awaiting-review, executing, completed)
model-hints:
  planning: [claude-opus-4-6, gpt-4-turbo]
  editing: [claude-sonnet-4-5-20250929, gpt-4o-mini]
cost: medium
os: [win32, darwin, linux]
author: ChainlessChain
license: MIT
homepage: https://github.com/nicekwell/chainlesschain
repository: https://github.com/nicekwell/chainlesschain
---

# Architect Mode 技能

## 描述

双阶段架构模式，将复杂的多文件编辑任务拆分为"规划"与"执行"两个独立阶段。通过分离推理（reasoning）和代码修改（editing），显著提升多文件变更的准确率和可控性。灵感来源于 Aider 的 architect mode 和 Claude Code 的 plan mode。

## 核心理念

传统 AI 编码助手在处理多文件变更时容易出现：

- 遗漏需要修改的文件
- 修改顺序导致中间状态不一致
- "迷失在上下文中"忘记原始目标

Architect Mode 解决这些问题的方式：

1. **Phase 1 (规划)**: 使用推理能力强的模型分析代码库，生成结构化变更计划
2. **Phase 2 (执行)**: 按照计划逐个文件生成精确的编辑指令

## 使用方法

```
/architect-mode <任务描述>              # 完整流程：规划 → 审核 → 执行
/architect-mode --plan-only <任务描述>  # 仅生成计划，不执行
/architect-mode --execute <plan-id>     # 执行已有计划
```

## 操作模式

### 默认模式（规划 + 执行）

```
/architect-mode 'add WebSocket support for real-time notifications'
```

流程：

1. 扫描代码库，提取与任务相关的文件
2. 生成结构化变更计划（分阶段、按依赖排序）
3. 输出计划摘要，等待用户审核
4. 用户确认后，逐个文件生成编辑指令
5. 输出执行结果和摘要

### 仅规划模式

```
/architect-mode --plan-only 'migrate from Express to Fastify'
```

只生成变更计划，不自动执行。适用于：

- 大型重构前的影响评估
- 团队讨论变更方案
- 多方案对比

### 执行已有计划

```
/architect-mode --execute plan-abc123
```

执行之前生成并保存的计划。支持断点续传。

## 计划结构

```json
{
  "id": "plan-abc123",
  "task": "add user authentication with JWT",
  "createdAt": "2026-02-17T10:30:00Z",
  "phases": [
    {
      "order": 1,
      "description": "Create authentication infrastructure",
      "files": [
        {
          "path": "src/main/auth/jwt-middleware.js",
          "action": "create",
          "reason": "JWT token verification middleware",
          "estimatedLines": 85
        },
        {
          "path": "src/main/database.js",
          "action": "modify",
          "reason": "Add users table schema",
          "estimatedLines": 15
        }
      ]
    },
    {
      "order": 2,
      "description": "Add API routes and frontend",
      "files": [
        {
          "path": "src/main/ipc/auth-ipc.js",
          "action": "create",
          "reason": "IPC handlers for login/register",
          "estimatedLines": 120
        }
      ]
    }
  ],
  "estimate": {
    "totalFiles": 6,
    "filesToCreate": 3,
    "filesToModify": 3,
    "filesToDelete": 0,
    "linesAdded": 450,
    "linesModified": 120,
    "linesDeleted": 0
  }
}
```

## 编辑指令格式

每个文件的编辑指令包含：

```json
{
  "file": "src/main/auth/jwt-middleware.js",
  "action": "create",
  "description": "JWT token verification middleware",
  "edits": [
    {
      "type": "insert",
      "after": 45,
      "content": "// new code to insert"
    },
    {
      "type": "replace",
      "startLine": 100,
      "endLine": 105,
      "content": "// replacement code"
    }
  ]
}
```

## 输出格式

### 计划阶段输出

```
Architecture Plan: plan-abc123
════════════════════════════════════════════

Task: add user authentication with JWT

Phase 1: Create authentication infrastructure (3 files)
  [CREATE] src/main/auth/jwt-middleware.js — JWT verification (~85 lines)
  [MODIFY] src/main/database.js — Add users table (+15 lines)
  [CREATE] src/main/auth/password-utils.js — Password hashing (~40 lines)

Phase 2: Add API routes and frontend (3 files)
  [CREATE] src/main/ipc/auth-ipc.js — IPC handlers (~120 lines)
  [MODIFY] src/renderer/router.js — Add auth routes (+8 lines)
  [CREATE] src/renderer/pages/LoginPage.vue — Login UI (~150 lines)

Estimate: 6 files (3 new, 3 modified), +418 lines, ~120 lines modified

Approve this plan? [Y/n/edit]
```

### 执行阶段输出

```
Executing plan-abc123...
  [1/6] Created src/main/auth/jwt-middleware.js (85 lines)
  [2/6] Modified src/main/database.js (+15 lines)
  [3/6] Created src/main/auth/password-utils.js (40 lines)
  [4/6] Created src/main/ipc/auth-ipc.js (120 lines)
  [5/6] Modified src/renderer/router.js (+8 lines)
  [6/6] Created src/renderer/pages/LoginPage.vue (150 lines)

Result: 6/6 edits applied successfully. 0 conflicts.
```

## 与其他技能的区别

| 特性 | architect-mode       | code-review  | refactor           |
| ---- | -------------------- | ------------ | ------------------ |
| 目标 | 多文件变更规划与执行 | 代码质量分析 | 代码异味检测与重构 |
| 模式 | 双阶段（规划+执行）  | 只读         | 单阶段执行         |
| 范围 | 跨模块、跨层级       | 单文件或目录 | 单文件或目录       |
| 审核 | 内置计划审核流程     | 无需         | Diff 预览          |
| 用途 | 新功能、大型重构     | 代码审查     | 小型重构           |

## 最佳实践

1. **任务描述越具体越好**: "add JWT auth with refresh tokens, bcrypt hashing, and rate limiting" 比 "add auth" 更好
2. **先 --plan-only**: 大型变更先生成计划，确认无误后再执行
3. **分阶段执行**: 对于超过 10 个文件的变更，建议分批执行
4. **结合 code-review**: 执行后运行 code-review 验证代码质量
5. **结合 test-generator**: 为新增代码自动生成测试
