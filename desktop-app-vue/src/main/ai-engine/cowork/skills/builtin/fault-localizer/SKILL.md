---
name: fault-localizer
display-name: Fault Localizer
description: 自动故障定位 - 给定错误堆栈或失败测试，通过频谱分析和AST导航定位根因代码
version: 1.0.0
category: debugging
user-invocable: true
tags: [debug, fault, localization, stack-trace, root-cause, spectrum]
capabilities:
  [stack-trace-parsing, code-navigation, suspiciousness-ranking, fix-suggestion]
tools:
  - file_reader
  - code_analyzer
  - project_navigator
supported-file-types: [js, ts, py, java, go, vue, jsx, tsx]
instructions: |
  Use this skill when the user provides an error stack trace, failing test output,
  or error message and needs help locating the root cause. The skill parses stack
  traces from Node.js, Python, and Java, reads the source files for each frame,
  analyzes function complexity and error handling, checks git recency, and produces
  a suspiciousness ranking to identify the most likely root-cause location.
  Supports three modes: --trace (parse raw stack trace), --test (analyze failing
  test output), and --error (parse a simple error message with context).
examples:
  - input: "/fault-localizer --trace \"TypeError: Cannot read properties of undefined (reading 'id')\n    at processUser (src/main/user.js:42:15)\n    at handler (src/main/api.js:18:10)\""
    output: "Ranked suspicious locations with src/main/user.js:42 at top (score 0.95), plus fix suggestion to add null check"
  - input: "/fault-localizer --test \"FAIL src/tests/auth.test.js\n  ● login flow › should reject invalid token\n    Expected: 401\n    Received: 500\""
    output: "Analysis pointing to auth middleware as likely root cause based on error type mismatch"
  - input: '/fault-localizer --error "ECONNREFUSED 127.0.0.1:5432"'
    output: "Diagnosis: PostgreSQL connection refused - database not running or wrong port"
input-schema:
  type: object
  properties:
    mode:
      type: string
      enum: [trace, test, error]
      description: "Analysis mode: trace (stack trace), test (failing test output), error (error message)"
      default: trace
    input:
      type: string
      description: "The error stack trace, test output, or error message to analyze"
    context-lines:
      type: integer
      description: "Number of source context lines to include around each frame"
      default: 5
  required: [input]
output-schema:
  type: object
  properties:
    errorType:
      type: string
      description: "Classified error type (TypeError, ConnectionError, AssertionError, etc.)"
    errorMessage:
      type: string
      description: "The extracted error message"
    frames:
      type: array
      items:
        type: object
        properties:
          file: { type: string }
          line: { type: integer }
          column: { type: integer }
          function: { type: string }
          sourceContext: { type: string }
    suspiciousLocations:
      type: array
      items:
        type: object
        properties:
          file: { type: string }
          line: { type: integer }
          function: { type: string }
          score: { type: number, minimum: 0, maximum: 1 }
          reason: { type: string }
    suggestedFix:
      type: string
      description: "Suggested fix based on error pattern analysis"
model-hints:
  min-context: 8192
  preferred-models: [claude-3-opus, claude-3-sonnet, gpt-4]
cost: low
os: [win32, darwin, linux]
author: ChainlessChain
license: MIT
handler: ./handler.js
---

# Fault Localizer - 自动故障定位

## 描述

给定错误堆栈或失败测试输出，自动解析并定位根因代码。通过频谱分析（suspiciousness scoring）和源代码导航，快速缩小故障范围。

## 使用方法

```
/fault-localizer [--trace|--test|--error] "错误信息或堆栈"
```

## 运行模式

| 模式    | 说明                           | 输入类型                |
| ------- | ------------------------------ | ----------------------- |
| --trace | 解析完整的错误堆栈跟踪         | Node.js/Python/Java堆栈 |
| --test  | 分析失败的测试输出             | Jest/Vitest/Pytest输出  |
| --error | 解析简单的错误消息并推断上下文 | 错误消息字符串          |

## 分析流程

1. **堆栈解析**: 从堆栈跟踪中提取文件路径、行号、函数名
2. **源代码读取**: 读取每个栈帧对应的源文件，提取上下文代码
3. **函数分析**: 分析函数复杂度、是否有错误处理、参数验证
4. **Git历史**: 检查文件最近修改时间，近期修改的代码更可能是根因
5. **可疑度排名**: 综合评分，按可能性从高到低排序

## 可疑度评分因素

| 因素         | 权重 | 说明                            |
| ------------ | ---- | ------------------------------- |
| 抛出点距离   | 0.35 | 越接近error throw点，可疑度越高 |
| 函数复杂度   | 0.20 | 复杂函数更容易出bug             |
| 错误处理缺失 | 0.20 | 缺少try/catch的函数更可疑       |
| 近期修改     | 0.15 | 最近修改过的文件更可能引入bug   |
| 参数验证     | 0.10 | 缺少输入验证的函数更可疑        |

## 输出格式

```json
{
  "errorType": "TypeError",
  "errorMessage": "Cannot read properties of undefined (reading 'id')",
  "frames": [
    {
      "file": "src/main/user.js",
      "line": 42,
      "column": 15,
      "function": "processUser"
    }
  ],
  "suspiciousLocations": [
    {
      "file": "src/main/user.js",
      "line": 42,
      "function": "processUser",
      "score": 0.95,
      "reason": "Closest to error throw point, deep property access without null guard"
    }
  ],
  "suggestedFix": "Add null check: if (!user?.id) return null;"
}
```

## 示例

解析Node.js堆栈:

```
/fault-localizer --trace "TypeError: Cannot read properties of undefined (reading 'id')
    at processUser (src/main/user.js:42:15)
    at handler (src/main/api.js:18:10)"
```

分析失败测试:

```
/fault-localizer --test "FAIL src/tests/auth.test.js
  ● login flow › should reject invalid token
    Expected: 401
    Received: 500"
```

诊断错误消息:

```
/fault-localizer --error "ECONNREFUSED 127.0.0.1:5432"
```
