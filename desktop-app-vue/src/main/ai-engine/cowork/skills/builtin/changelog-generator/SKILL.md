---
name: changelog-generator
display-name: Changelog Generator
description: 变更日志生成 - 从Git提交历史自动生成分类的Markdown格式Changelog
version: 1.0.0
category: development
user-invocable: true
tags: [changelog, git, release, commits, conventional]
capabilities: [commit-parsing, categorization, markdown-generation]
tools:
  - git_diff
requires:
  bins: [git]
os: [win32, darwin, linux]
handler: ./handler.js
instructions: |
  Use this skill to generate changelogs from git commit history. For --generate mode,
  parse all commits since the last tag, categorize them by conventional commit type
  (feat/fix/docs/refactor/test/chore/perf), and output formatted Markdown. For --since mode,
  generate changelog from a specific tag or date. For --unreleased mode, show only
  unreleased changes. For --format mode, choose output format (md or json). Always detect
  breaking changes and highlight them prominently.
examples:
  - input: "/changelog-generator --generate"
    output: "## v0.36.2\n### Features\n- (skills) Add prompt-enhancer skill\n- (ai) Add multi-model router\n### Bug Fixes\n- (auth) Fix SSO token refresh\n### Breaking Changes\n- None"
  - input: "/changelog-generator --since v0.35.0"
    output: "Changelog since v0.35.0: 45 commits (18 feat, 12 fix, 8 docs, 7 chore). Generated 120-line markdown."
  - input: "/changelog-generator --unreleased"
    output: "Unreleased changes: 5 features, 2 fixes since v0.36.1."
input-schema:
  type: object
  properties:
    mode:
      type: string
      enum: [generate, since, unreleased, format]
    since:
      type: string
      description: Tag or date to generate from
    format:
      type: string
      enum: [md, json]
output-schema:
  type: object
  properties:
    changelog: { type: string }
    stats: { type: object }
    commits: { type: array }
model-hints:
  preferred: [claude-sonnet-4-5-20250929]
cost: free
author: ChainlessChain
license: MIT
homepage: https://github.com/nicekid1/ChainlessChain
repository: https://github.com/nicekid1/ChainlessChain
---

# Changelog Generator 技能

## 描述

从 Git 提交历史自动生成分类的 Markdown 格式 Changelog。支持 Conventional Commits 规范，自动分组 feat/fix/docs 等类型，检测 Breaking Changes。

## 使用方法

```
/changelog-generator [选项]
```

## Conventional Commits 分类

| 类型     | 标题          | 描述      |
| -------- | ------------- | --------- |
| feat     | Features      | 新功能    |
| fix      | Bug Fixes     | 错误修复  |
| docs     | Documentation | 文档变更  |
| style    | Styles        | 代码格式  |
| refactor | Refactoring   | 代码重构  |
| perf     | Performance   | 性能优化  |
| test     | Tests         | 测试相关  |
| chore    | Chores        | 构建/工具 |
