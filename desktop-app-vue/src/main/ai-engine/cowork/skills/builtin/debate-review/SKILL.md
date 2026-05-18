---
name: debate-review
display-name: Debate Review
description: Multi-agent debate code review with configurable perspectives (performance, security, maintainability)
version: 1.0.0
category: code-review
user-invocable: true
tags:
  [
    debate,
    review,
    code-review,
    multi-agent,
    security,
    performance,
    maintainability,
  ]
capabilities:
  [
    multi-perspective-review,
    consensus-voting,
    structured-feedback,
    decision-recording,
  ]
tools:
  - file_reader
  - code_reviewer
instructions: |
  Use this skill when the user wants a thorough code review from multiple perspectives.
  Spawns 3 reviewer agents (performance, security, maintainability) by default,
  each producing structured issues with severity ratings. Results are merged via
  consensus voting to produce APPROVE, NEEDS_WORK, or REJECT verdict.
  Usage: /debate-review <file-or-diff> [--perspectives perf,security,maintain]
examples:
  - input: "/debate-review src/main/index.js"
    output: "3 reviewers analyzed index.js: APPROVE (consensus: 0.85)"
  - input: "/debate-review src/main/auth/sso-manager.js --perspectives security,performance"
    output: "2 reviewers analyzed sso-manager.js: NEEDS_WORK (2 critical, 5 warnings)"
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
---

# Debate Review

## Description

Multi-agent debate code review that spawns multiple specialized reviewer agents, each analyzing code from a different perspective. Results are aggregated via consensus voting.

## Usage

```
/debate-review <file-or-diff> [--perspectives perf,security,maintain]
```

## Perspectives

| Perspective     | Focus Areas                                                   |
| --------------- | ------------------------------------------------------------- |
| performance     | Time/space complexity, memory leaks, I/O bottlenecks, caching |
| security        | Input validation, injection, OWASP Top 10, data exposure      |
| maintainability | Readability, DRY, SRP, error handling, test implications      |

## Output Format

```
Debate Review Report
====================
Target: src/main/auth/sso-manager.js
Perspectives: performance, security, maintainability

| Reviewer        | Vote       | Critical | Warning | Info |
| --------------- | ---------- | -------- | ------- | ---- |
| performance     | APPROVE    | 0        | 1       | 2    |
| security        | NEEDS_WORK | 1        | 3       | 0    |
| maintainability | APPROVE    | 0        | 0       | 4    |

Verdict: NEEDS_WORK (consensus: 0.70)
```

## Verdict Scale

- **APPROVE** - Average score >= 0.7, no critical issues
- **NEEDS_WORK** - Average score 0.4-0.7, issues to address
- **REJECT** - Average score < 0.4, critical issues found
