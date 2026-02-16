---
name: commit-splitter
display-name: Commit Splitter
description: 智能提交拆分 - 将大量未提交变更按语义分组为原子性提交
version: 1.0.0
category: development
user-invocable: true
tags: [git, commit, split, atomic, semantic]
capabilities: [change-grouping, semantic-analysis, commit-ordering]
tools:
  - git_status
  - git_diff
  - file_reader
requires:
  bins: [git]
os: [win32, darwin, linux]
handler: ./handler.js
instructions: |
  Use this skill when the user has many uncommitted changes and wants to split them
  into atomic, well-organized commits. The skill analyzes file relationships based on
  directory proximity, file type, and semantic connections (e.g., test files with their
  source files). Each suggested commit group includes a conventional commit message.
  Always group related changes together: a feature file with its test, config changes
  in a separate chore commit, documentation updates in a docs commit.
examples:
  - input: "/commit-splitter --analyze"
    output: "Found 15 uncommitted files. Suggested 4 atomic commits: feat(api): add auth endpoint (3 files), test(api): add auth tests (2 files), docs: update API documentation (1 file), chore: update dependencies (2 files)"
  - input: "/commit-splitter --suggest"
    output: "Group 1 [feat(ui)]: LoginPage.vue, LoginForm.vue, auth-store.ts | Group 2 [test(ui)]: LoginPage.test.js | Group 3 [docs]: README.md"
  - input: "/commit-splitter --dry-run"
    output: "Would create 3 commits: feat(api) +142/-12, fix(db) +8/-3, docs +22/-0"
input-schema:
  type: object
  properties:
    mode:
      type: string
      enum: [analyze, suggest, dry-run]
      description: Analysis mode
output-schema:
  type: object
  properties:
    groups:
      type: array
      items:
        type: object
        properties:
          files: { type: array }
          suggestedMessage: { type: string }
          type: { type: string }
          scope: { type: string }
    totalFiles: { type: number }
    groupCount: { type: number }
model-hints:
  preferred: [claude-opus-4-6, gpt-4o]
cost: free
author: ChainlessChain
license: MIT
homepage: https://github.com/nicekid1/ChainlessChain
repository: https://github.com/nicekid1/ChainlessChain
---

# Commit Splitter 技能

## 描述

将大量未提交的变更按语义关系智能分组为原子性提交。分析文件之间的目录相邻性、类型关联性和语义关系，生成合理的提交分组和提交消息。

## 使用方法

```
/commit-splitter [选项]
```

## 选项

- `--analyze` - 分析未提交变更，显示文件分组概况
- `--suggest` - 建议提交分组，包含详细的文件列表和提交消息
- `--dry-run` - 预览所有提交组，显示增删行数统计

## 分组规则

| 规则     | 说明                                    |
| -------- | --------------------------------------- |
| 目录相邻 | 同目录下的文件倾向于属于同一功能        |
| 测试关联 | 测试文件与其源文件归为同一提交          |
| 配置聚合 | 配置/包管理文件归为 chore 提交          |
| 文档聚合 | 文档文件归为 docs 提交                  |
| 类型推断 | 基于变更内容推断 feat/fix/refactor 类型 |

## 输出示例

```
Commit Splitter Analysis
========================
Total uncommitted files: 12
Suggested commits: 4

Group 1: feat(auth) - add JWT authentication
  - src/main/auth/jwt-provider.js (+85)
  - src/main/auth/token-store.js (+42)
  - src/main/auth/auth-ipc.js (+30)

Group 2: test(auth) - add auth unit tests
  - tests/unit/auth/jwt-provider.test.js (+120)
  - tests/unit/auth/token-store.test.js (+65)

Group 3: docs - update authentication guide
  - docs/features/AUTH_GUIDE.md (+45)

Group 4: chore - update dependencies
  - package.json (+2/-1)
  - package-lock.json (+150/-80)
```
