---
name: lint-and-fix
display-name: Lint & Fix
description: 自动Lint修复技能 - 运行Linter、解析错误、AI自动修复循环
version: 1.0.0
category: development
user-invocable: true
tags: [lint, eslint, fix, auto-fix, code-quality, formatting]
capabilities:
  [
    linter-detection,
    error-parsing,
    auto-fix-loop,
    config-detection,
  ]
tools:
  - file_reader
  - file_writer
  - file_editor
  - command_executor
instructions: |
  Use this skill when the user wants to lint code and automatically fix any issues found.
  Detect the project's linter configuration (ESLint, Pylint, Clippy, etc.), run the linter,
  parse structured error output, and iteratively fix issues until the code is clean.
  This implements the lint-then-fix loop pattern from Aider. Maximum 5 iterations to
  prevent infinite loops.
examples:
  - input: "/lint-and-fix src/main/llm/"
    output: "ESLint detected. Found 12 issues (8 fixable). Auto-fixed 8, AI-fixed 3, 1 needs manual review."
  - input: "/lint-and-fix src/renderer/ --strict"
    output: "Strict mode: 45 issues found. Fixed 40 automatically. 5 require architectural changes."
  - input: "/lint-and-fix --check-only"
    output: "Lint report: 23 errors, 56 warnings across 15 files. No changes applied."
os: [win32, darwin, linux]
author: ChainlessChain
---

# 自动 Lint 修复技能

## 描述

自动检测项目的 Linter 配置，运行 Lint 检查，解析错误输出，然后 AI 自动修复问题。实现 Lint → 修复 → 重新 Lint 的循环，直到代码清洁。

## 使用方法

```
/lint-and-fix [目标路径] [选项]
```

## 选项

- `--check-only` - 仅检查，不修复
- `--strict` - 严格模式，包含 warnings
- `--max-iterations <n>` - 最大修复迭代次数 (默认: 5)
- `--linter <name>` - 指定 linter: eslint, prettier, pylint, clippy

## 支持的 Linter

| Linter | 语言 | 配置检测 |
| ------ | ---- | -------- |
| ESLint | JS/TS/Vue | .eslintrc.*, eslint.config.* |
| Prettier | JS/TS/CSS/HTML | .prettierrc.*, prettier.config.* |
| Pylint | Python | .pylintrc, pyproject.toml |
| Clippy | Rust | clippy.toml |
| Checkstyle | Java | checkstyle.xml |

## 执行流程

```
1. 检测 Linter 配置
        ↓
2. 运行 Linter (--fix 模式)
        ↓
3. 解析剩余错误
        ↓
4. AI 分析并修复
        ↓
5. 重新运行 Linter ←─── 还有错误? (最多5次迭代)
        ↓
6. 输出报告
```

## 输出格式

```
Lint & Fix Report
=================
Linter: ESLint 9.x
Config: eslint.config.js

Round 1: 12 issues found
  - Auto-fixed (--fix): 8
  - AI-fixed: 3
  - Remaining: 1

Round 2: 1 issue found
  - AI-fixed: 1
  - Remaining: 0

Result: ✅ All clean after 2 rounds
Files modified: 6
```

## 示例

修复整个项目:

```
/lint-and-fix src/
```

仅检查不修改:

```
/lint-and-fix src/main/ --check-only
```
