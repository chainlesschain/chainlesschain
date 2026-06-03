---
name: test-and-fix
display-name: Test & Fix
description: 自动测试修复技能 - 运行测试、解析失败、AI自动修复循环
version: 1.0.0
category: testing
user-invocable: true
tags: [test, fix, auto-repair, vitest, jest, pytest, junit, ci]
capabilities:
  [
    test-runner-detection,
    failure-parsing,
    auto-repair-loop,
    regression-detection,
  ]
tools:
  - file_reader
  - file_writer
  - file_editor
  - command_executor
instructions: |
  Use this skill when the user wants to run tests and automatically fix any failures.
  Detect the project's test runner (Vitest, Jest, pytest, JUnit), run the test suite,
  parse failure output including stack traces, and iteratively fix source code or test
  code until all tests pass. This implements the test-then-fix loop pattern from Aider.
  Maximum 5 iterations to prevent infinite loops. Distinguish between source bugs
  and test bugs.
examples:
  - input: "/test-and-fix tests/unit/"
    output: "Vitest detected. 157 tests: 152 passed, 5 failed. AI-fixed 4 source bugs, 1 test assertion updated. All green."
  - input: "/test-and-fix tests/unit/ai-engine/ --source-only"
    output: "Fix source code only (don't modify tests). Fixed 3 implementation bugs. 27/27 tests pass."
  - input: "/test-and-fix --affected-by src/main/llm/session-manager.js"
    output: "Found 12 tests related to session-manager. Ran them: 10 passed, 2 failed. Fixed 2 issues."
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
---

# 自动测试修复技能

## 描述

自动检测测试框架，运行测试套件，解析失败信息（包括堆栈跟踪），AI 分析失败原因并修复代码，重复直到所有测试通过。

## 使用方法

```
/test-and-fix [测试路径] [选项]
```

## 选项

- `--source-only` - 仅修复源代码，不修改测试文件
- `--test-only` - 仅修复测试代码（更新断言等）
- `--affected-by <file>` - 只运行受指定文件影响的测试
- `--max-iterations <n>` - 最大修复迭代次数 (默认: 5)
- `--runner <name>` - 指定测试运行器: vitest, jest, pytest, junit

## 支持的测试框架

| 框架   | 语言        | 配置检测                          |
| ------ | ----------- | --------------------------------- |
| Vitest | JS/TS       | vitest.config._, vite.config._    |
| Jest   | JS/TS       | jest.config.\*, package.json jest |
| Pytest | Python      | pytest.ini, pyproject.toml        |
| JUnit  | Java/Kotlin | build.gradle, pom.xml             |

## 执行流程

```
1. 检测测试框架和配置
        ↓
2. 运行测试套件
        ↓
3. 解析失败 (堆栈跟踪、断言错误、超时)
        ↓
4. AI 诊断失败原因:
   - 源代码 bug → 修复源码
   - 测试断言过时 → 更新测试
   - 环境问题 → 报告
        ↓
5. 应用修复
        ↓
6. 重新运行失败测试 ←─── 还有失败? (最多5次)
        ↓
7. 运行全套测试确认无回归
        ↓
8. 输出报告
```

## 输出格式

```
Test & Fix Report
=================
Runner: Vitest 3.x
Config: vitest.config.ts

Initial run: 157 tests
  ✅ 152 passed
  ❌ 5 failed

Round 1: Fixing 5 failures
  - src/main/llm/session-manager.js:45 → fixed null check
  - src/main/rag/bm25-search.js:120 → fixed index bounds
  - tests/unit/hooks.test.js:89 → updated expected value
  - 2 remaining

Round 2: Fixing 2 failures
  - src/main/utils/ipc-error-handler.js:67 → fixed async handling
  - Fixed

Final run: 157/157 passed ✅
Files modified: 3 source, 1 test
```

## 示例

修复所有失败测试:

```
/test-and-fix tests/unit/
```

只修复受影响的测试:

```
/test-and-fix --affected-by src/main/llm/context-engineering.js
```
