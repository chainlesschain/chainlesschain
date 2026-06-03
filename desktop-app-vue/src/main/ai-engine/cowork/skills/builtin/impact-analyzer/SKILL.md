---
name: impact-analyzer
display-name: Impact Analyzer
description: 变更影响分析 - 预测代码修改的爆炸半径，显示受影响的文件、测试和API端点
version: 1.0.0
category: analysis
user-invocable: true
tags: [impact, blast-radius, dependency, change, risk]
capabilities: [import-tracing, test-mapping, risk-scoring]
tools:
  - file_reader
  - code_analyzer
  - git_diff
requires:
  bins: [git]
os: [win32, darwin, linux]
handler: ./handler.js
instructions: |
  Use this skill when the user wants to understand the blast radius of a code change.
  Given a file, function name, or the current git diff, trace all reverse dependencies
  (files that import the target) transitively up to depth 5. Map source files to their
  test files using naming conventions (foo.js → foo.test.js, foo.spec.js, __tests__/foo.test.js).
  Assign a risk score: HIGH if many dependents and no tests cover the change, MEDIUM if
  some dependents and tests exist, LOW if the file is a leaf node. For IPC handler files,
  additionally list affected frontend stores and pages.
examples:
  - input: "/impact-analyzer --file src/main/database.js"
    output: "database.js has 18 direct dependents, 32 transitive dependents, 5 affected tests. Risk: HIGH — core module with wide blast radius."
  - input: "/impact-analyzer --diff"
    output: "Current diff touches 3 files. Combined blast radius: 12 dependents, 3 test files, 2 IPC handlers affected."
  - input: "/impact-analyzer --function SessionManager"
    output: "SessionManager is referenced in 8 files across llm/, ai-engine/, and ipc/ directories."
input-schema:
  type: object
  properties:
    mode:
      type: string
      enum: [file, function, diff]
      description: Analysis mode
    target:
      type: string
      description: File path or function name to analyze
output-schema:
  type: object
  properties:
    targetFile: { type: string }
    directDependents: { type: array }
    transitiveDependents: { type: array }
    affectedTests: { type: array }
    riskScore: { type: number }
    riskLevel: { type: string }
    recommendation: { type: string }
model-hints:
  preferred: [claude-opus-4-6, gpt-4o]
cost: free
author: ChainlessChain
license: MIT
homepage: https://github.com/nicekid1/ChainlessChain
repository: https://github.com/nicekid1/ChainlessChain
---

# Impact Analyzer 技能

## 描述

预测代码修改的爆炸半径（blast radius）。给定一个文件、函数名或当前 git diff，追踪所有直接和传递依赖方，映射受影响的测试文件，并给出风险评分。

## 使用方法

```
/impact-analyzer [选项]
```

## 选项

- `--file <path>` - 分析修改某个文件的影响范围
- `--function <name>` - 追踪函数/类的调用者
- `--diff` - 分析当前 git diff 的影响

## 分析维度

### 依赖追踪

- 构建反向导入图（谁 import/require 了目标文件）
- BFS 追踪传递依赖，最大深度 5 层
- 支持 `require()` 和 `import` 两种语法

### 测试映射

- `foo.js` → `foo.test.js` / `foo.spec.js`
- `foo.js` → `__tests__/foo.test.js`
- `src/main/x.js` → `tests/unit/x.test.js`

### 风险评分

| 等级   | 条件                         |
| ------ | ---------------------------- |
| HIGH   | 依赖方 > 10 个，或无测试覆盖 |
| MEDIUM | 依赖方 3-10 个，有测试覆盖   |
| LOW    | 依赖方 < 3 个（叶子节点）    |

### IPC 影响

- 检测 IPC handler 文件变更
- 列出受影响的前端 store 和 page

## 输出示例

```
Impact Analysis: src/main/llm/session-manager.js
=================================================
Direct dependents (6):
  → conversation-ipc.js
  → manus-optimizations.js
  → context-engineering.js
  → permanent-memory-manager.js
  → plan-mode/index.js
  → hooks/hook-middleware.js

Transitive dependents (8 additional):
  → index.js (main entry)
  → ai-engine/cowork/skills/index.js
  ...

Affected tests (3):
  → tests/unit/llm/session-manager.test.js
  → tests/unit/llm/context-engineering.test.js
  → tests/integration/conversation.test.js

Risk: HIGH (score: 8.5/10)
  Core module with 14 total dependents.

Recommendation: Write comprehensive tests before modifying.
  Ensure backward-compatible API changes.
```
