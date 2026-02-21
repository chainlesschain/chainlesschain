---
name: verification-loop
display-name: Verification Loop
description: 6-stage automated verification pipeline producing READY/NOT READY verdict
version: 1.0.0
category: quality
user-invocable: true
tags:
  [
    verification,
    build,
    typecheck,
    lint,
    test,
    security,
    diff-review,
    ci,
    quality,
  ]
capabilities:
  [
    build-verification,
    type-checking,
    lint-checking,
    test-execution,
    security-scanning,
    diff-review,
  ]
tools:
  - command_executor
  - file_reader
  - code_analyzer
instructions: |
  Use this skill when the user wants to verify code readiness before commit, merge, or deploy.
  Runs a 6-stage verification pipeline: Build → TypeCheck → Lint → Test → Security → DiffReview.
  Each stage produces a PASS/FAIL result. The final verdict is READY (all pass) or NOT READY
  (with failure details). Automatically detects project type (Node.js, Python, Java) and adapts
  commands accordingly. Can skip stages with --skip flag.
examples:
  - input: "/verification-loop"
    output: "6/6 stages passed. Verdict: READY"
  - input: "/verification-loop src/ --skip typecheck"
    output: "5/5 stages passed (typecheck skipped). Verdict: READY"
  - input: "/verification-loop --stages build,test,security"
    output: "3/3 stages passed. Verdict: READY"
model-hints: sonnet
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
---

# Verification Loop

## Description

6-stage automated verification pipeline that produces a READY/NOT READY verdict. Inspired by the everything-claude-code verification loop pattern.

## Usage

```
/verification-loop [path] [options]
```

## Options

- `--skip <stages>` - Comma-separated stages to skip (e.g. `--skip typecheck,security`)
- `--stages <stages>` - Run only specified stages (e.g. `--stages build,test`)
- `--verbose` - Show full output from each stage

## Verification Stages

| Stage      | Description                       | Tool                |
| ---------- | --------------------------------- | ------------------- |
| Build      | Compile/bundle the project        | npm run build / mvn |
| TypeCheck  | Run static type checking          | tsc --noEmit        |
| Lint       | Run linter for code style issues  | eslint / flake8     |
| Test       | Execute test suite                | vitest / jest       |
| Security   | Scan for secrets and OWASP issues | security-audit      |
| DiffReview | AI review of uncommitted git diff | LLM analysis        |

## Execution Flow

```
1. Detect project type (Node.js / Python / Java)
       ↓
2. Build stage → PASS/FAIL
       ↓
3. TypeCheck stage → PASS/FAIL
       ↓
4. Lint stage → PASS/FAIL
       ↓
5. Test stage → PASS/FAIL
       ↓
6. Security stage → PASS/FAIL
       ↓
7. DiffReview stage → PASS/FAIL
       ↓
8. Aggregate results → READY / NOT READY
```

## Output Format

```
Verification Loop Report
========================
Project: desktop-app-vue (Node.js)

| Stage      | Status | Duration | Details          |
| ---------- | ------ | -------- | ---------------- |
| Build      | PASS   | 12.3s    | Clean build      |
| TypeCheck  | PASS   | 4.1s     | 0 errors         |
| Lint       | PASS   | 2.8s     | 0 warnings       |
| Test       | PASS   | 8.5s     | 157/157 passed   |
| Security   | PASS   | 1.2s     | 0 findings       |
| DiffReview | PASS   | 3.0s     | No issues found  |

Verdict: READY
```
