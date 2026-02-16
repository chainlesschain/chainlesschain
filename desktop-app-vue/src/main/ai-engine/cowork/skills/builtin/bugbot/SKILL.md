---
name: bugbot
display-name: BugBot
description: 主动式Bug检测器 - 扫描代码变更和diff，在问题到达生产前发现潜在Bug、竞态条件、空指针问题
version: 1.0.0
category: testing
user-invocable: true
tags:
  [bug, detection, proactive, diff, race-condition, null-pointer, logic-error]
capabilities:
  [
    diff-analysis,
    pattern-detection,
    race-condition-detection,
    null-safety-check,
  ]
tools:
  - file_reader
  - code_analyzer
  - git_operations
supported-file-types: [js, ts, py, java, go, vue, jsx, tsx, c, cpp]
instructions: |
  Use this skill when the user wants to proactively scan code for bugs before
  they reach production. BugBot detects 15+ bug patterns including null/undefined
  access, unhandled promises, race conditions, off-by-one errors, resource leaks,
  type coercion issues, infinite loops, unreachable code, missing error handling,
  array bounds issues, catastrophic backtracking, SQL injection, XSS, deadlocks,
  and missing switch breaks. Supports three modes: --scan (directory scan),
  --diff (git diff analysis), and --watch (recent changes listing). The --diff
  mode is especially useful in CI pipelines and pre-commit hooks.
examples:
  - input: "/bugbot --scan src/main/"
    output: "Full scan report with bugs categorized by severity (critical/high/medium/low)"
  - input: "/bugbot --diff"
    output: "Analysis of staged git changes, reporting only bugs in changed lines"
  - input: "/bugbot --diff HEAD~3"
    output: "Analyze the last 3 commits for potential bugs"
  - input: "/bugbot --watch"
    output: "List recently modified files and highlight files with high bug density"
input-schema:
  type: object
  properties:
    mode:
      type: string
      enum: [scan, diff, watch]
      description: "Detection mode: scan (directory), diff (git changes), watch (recent changes)"
      default: scan
    target:
      type: string
      description: "Target path for scan mode, or git ref for diff mode (e.g. HEAD~1)"
    severity-filter:
      type: string
      enum: [critical, high, medium, low, all]
      description: "Minimum severity level to report"
      default: all
  required: []
output-schema:
  type: object
  properties:
    bugs:
      type: array
      items:
        type: object
        properties:
          file: { type: string }
          line: { type: integer }
          severity: { type: string, enum: [critical, high, medium, low] }
          pattern: { type: string }
          message: { type: string }
          suggestion: { type: string }
    summary:
      type: object
      properties:
        total: { type: integer }
        bySeverity:
          type: object
          properties:
            critical: { type: integer }
            high: { type: integer }
            medium: { type: integer }
            low: { type: integer }
model-hints:
  min-context: 4096
  preferred-models: [claude-3-opus, claude-3-sonnet, gpt-4]
cost: low
os: [win32, darwin, linux]
author: ChainlessChain
license: MIT
handler: ./handler.js
---

# BugBot - 主动式Bug检测器

## 描述

在代码到达生产环境之前，主动扫描并发现潜在Bug。支持15+种Bug模式检测，包括空指针访问、未处理的Promise、竞态条件、资源泄漏、SQL注入、XSS等。

## 使用方法

```
/bugbot [--scan|--diff|--watch] [目标路径或git引用]
```

## 运行模式

| 模式    | 说明                       | 典型场景           |
| ------- | -------------------------- | ------------------ |
| --scan  | 扫描指定目录下的所有源文件 | 全量代码审查       |
| --diff  | 分析git diff，仅检查变更行 | 提交前检查、CI集成 |
| --watch | 列出近期修改文件并标记风险 | 日常监控           |

## 检测模式（15+种）

### Critical 级别

- **SQL注入**: 字符串拼接构建SQL查询
- **XSS**: 通过innerHTML注入未经转义内容
- **竞态条件**: 异步代码中的共享可变状态
- **死锁**: 嵌套锁获取

### High 级别

- **空指针/未定义访问**: 未加守卫的链式访问
- **Promise未处理**: Promise缺少catch或未await
- **资源泄漏**: 打开文件/连接后未关闭
- **无限循环**: 循环条件永远为真

### Medium 级别

- **数组越界**: 潜在的索引超出范围
- **类型隐式转换**: == 替代 === 造成意外行为
- **正则灾难性回溯**: 嵌套量词导致指数时间
- **缺少break的switch**: fall-through可能非预期

### Low 级别

- **Off-by-one**: 循环边界错误（< vs <=）
- **return后的不可达代码**: return/throw后的死代码
- **回调缺少错误处理**: 回调函数未处理error参数

## 输出格式

```json
{
  "bugs": [
    {
      "file": "src/main/database.js",
      "line": 42,
      "severity": "critical",
      "pattern": "sql-injection",
      "message": "String concatenation in SQL query",
      "suggestion": "Use parameterized queries instead"
    }
  ],
  "summary": {
    "total": 5,
    "bySeverity": { "critical": 1, "high": 2, "medium": 1, "low": 1 }
  }
}
```

## 示例

扫描整个项目:

```
/bugbot --scan src/main/
```

检查暂存区变更:

```
/bugbot --diff
```

检查最近3次提交:

```
/bugbot --diff HEAD~3
```

查看近期修改文件:

```
/bugbot --watch
```
