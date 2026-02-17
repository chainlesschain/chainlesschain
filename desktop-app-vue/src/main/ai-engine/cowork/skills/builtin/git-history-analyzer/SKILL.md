---
name: git-history-analyzer
display-name: Git History Analyzer
description: Git历史分析 - 变更热点、贡献者模式、代码流失率和文件耦合检测
version: 1.0.0
category: analysis
user-invocable: true
tags: [git, history, hotspot, churn, coupling, contributors]
capabilities:
  [hotspot-detection, contributor-analysis, churn-analysis, coupling-detection]
tools:
  - git_diff
requires:
  bins: [git]
os: [win32, darwin, linux]
handler: ./handler.js
instructions: |
  Use this skill to analyze git history for development insights. For --hotspots mode,
  rank files by modification frequency to identify change hotspots (potential tech debt).
  For --contributors mode, analyze per-contributor statistics (commits, lines changed,
  active periods). For --churn mode, analyze code addition/deletion ratios for stability
  assessment. For --coupling mode, find files that are frequently modified together
  (temporal coupling). Always provide actionable recommendations based on the analysis.
examples:
  - input: "/git-history-analyzer --hotspots"
    output: "Top hotspots: 1) index.js (87 changes), 2) database.js (45 changes), 3) session-manager.js (38 changes). These files may benefit from refactoring."
  - input: "/git-history-analyzer --contributors"
    output: "3 contributors: Alice (234 commits, 12k lines), Bob (156 commits, 8k lines). Active hours: 09:00-18:00 UTC."
  - input: "/git-history-analyzer --churn"
    output: "High churn files: auth.js (added 500, deleted 480 = 96% churn), config.js (added 200, deleted 180). These indicate unstable code."
  - input: "/git-history-analyzer --coupling"
    output: "Coupled pairs: (database.js, migration.js) 85% co-change, (auth.js, session.js) 72% co-change. Consider merging or extracting shared logic."
input-schema:
  type: object
  properties:
    mode:
      type: string
      enum: [hotspots, contributors, churn, coupling]
      description: Analysis mode
output-schema:
  type: object
  properties:
    analysis: { type: object }
    recommendations: { type: array }
    totalCommits: { type: number }
model-hints:
  preferred: [claude-sonnet-4-5-20250929]
cost: free
author: ChainlessChain
license: MIT
homepage: https://github.com/nicekid1/ChainlessChain
repository: https://github.com/nicekid1/ChainlessChain
---

# Git History Analyzer 技能

## 描述

分析 Git 提交历史，识别变更热点、贡献者模式、代码流失率和文件耦合关系。灵感来自 code-maat 和 git-of-theseus。

## 使用方法

```
/git-history-analyzer [选项]
```

## 分析维度

### 变更热点 (--hotspots)

按文件修改频率排序，识别最常变更的文件

### 贡献者分析 (--contributors)

每人修改行数/文件数/活跃时段

### 代码流失 (--churn)

新增vs删除比率，文件稳定性评估

### 耦合检测 (--coupling)

经常一起修改的文件对
