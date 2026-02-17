---
name: memory-insights
display-name: Memory Insights
description: Knowledge base analytics and health monitoring - file statistics, health scoring, keyword extraction, activity trends, gap detection, and comprehensive reporting
version: 1.0.0
category: knowledge
user-invocable: true
tags: [memory, analytics, insights, knowledge, health, statistics, trends]
capabilities:
  [
    memory-overview,
    health-check,
    keyword-extraction,
    trend-analysis,
    gap-detection,
    report-generation,
  ]
tools:
  - memory_overview
  - memory_health
  - memory_keywords
  - memory_trends
  - memory_gaps
  - memory_report
instructions: |
  Use this skill when the user wants to understand the state of their knowledge base,
  check its health, discover keyword patterns, track activity trends, or identify
  knowledge gaps. For --overview, scan the memory directories and report file counts,
  sizes, and type distribution. For --health, compute a 0-100 health score based on
  staleness, empty files, and directory completeness. For --keywords, extract top
  keywords using word frequency analysis. For --trends, show weekly file activity
  over the last 30 days. For --gaps, identify topics mentioned but lacking dedicated
  files. For --report, generate a full combined analysis.
examples:
  - input: "/memory-insights --overview"
    output: "Memory Overview: 42 files, 156 KB total. Types: .md (35), .json (5), .txt (2). Last modified: 2026-02-17."
  - input: "/memory-insights --health"
    output: "Health Score: 78/100. Issues: 3 stale files (>30 days), 1 empty file, daily/ directory missing."
  - input: "/memory-insights --keywords --top 15"
    output: "Top 15 Keywords: session (45), memory (38), context (32), permission (28), agent (25), ..."
  - input: "/memory-insights --trends"
    output: "Activity Trends (last 30 days): Week 1: 5 created, 12 modified. Week 2: 3 created, 8 modified. ..."
  - input: "/memory-insights --gaps"
    output: "Potential Gaps: 'hooks' mentioned 12 times but no dedicated file. 'delegation' mentioned 8 times with sparse coverage."
input-schema:
  type: object
  properties:
    action:
      type: string
      enum: [overview, health, keywords, trends, gaps, report]
      description: Analysis action to perform
    top:
      type: number
      description: Number of top keywords to return (for --keywords)
    output:
      type: string
      description: Output file path (for --report)
output-schema:
  type: object
  properties:
    overview: { type: object }
    healthScore: { type: number }
    keywords: { type: array }
    trends: { type: array }
    gaps: { type: array }
model-hints:
  preferred: [claude-opus-4-6, gpt-4o]
cost: free
author: ChainlessChain
license: MIT
homepage: https://github.com/nicekid1/ChainlessChain
repository: https://github.com/nicekid1/ChainlessChain
dependencies: []
os: [win32, darwin, linux]
handler: ./handler.js
---

# Memory Insights Skill

Knowledge base analytics and health monitoring for the Permanent Memory system.

## Usage

```
/memory-insights [action] [options]
```

## Actions

| Action   | Command                      | Description                                             |
| -------- | ---------------------------- | ------------------------------------------------------- |
| Overview | `--overview`                 | File counts, total size, type distribution, dates       |
| Health   | `--health`                   | Health score (0-100) with issue breakdown               |
| Keywords | `--keywords [--top <n>]`     | Top keywords by frequency (stop-word filtered)          |
| Trends   | `--trends`                   | Weekly file creation/modification over last 30 days     |
| Gaps     | `--gaps`                     | Topics mentioned frequently but lacking dedicated files |
| Report   | `--report [--output <file>]` | Comprehensive report combining all analyses             |

## Health Score Criteria

- **Staleness** (-5 per file not modified in 30+ days, max -25)
- **Empty Files** (-10 per empty file, max -30)
- **Directory Completeness** (-10 per missing expected directory)
- **File Count** (-15 if fewer than 3 files)
- **Recent Activity** (+10 bonus if files modified in the last 7 days)

## Directories Scanned

- `.chainlesschain/memory/` - Long-term memory files (MEMORY.md, sections)
- `.chainlesschain/memory/daily/` - Daily note logs (YYYY-MM-DD.md)
