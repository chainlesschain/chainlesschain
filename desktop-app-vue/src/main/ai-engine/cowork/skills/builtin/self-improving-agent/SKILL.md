---
name: self-improving-agent
display-name: Self-Improving Agent
description: 自动学习改进，记录错误和修正 - Auto-learn from mistakes, track errors and corrections, analyze patterns, and improve responses over time
version: 1.2.0
category: system
user-invocable: true
tags: [self-improving, learning, error-tracking, corrections, patterns, meta-learning]
capabilities: [error-recording, pattern-analysis, improvement-suggestions, history-tracking]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [self-improve, record-error, analyze-patterns, suggest-improvements]
instructions: |
  Use this skill when the user wants to track errors and corrections,
  analyze patterns of past mistakes, or get suggestions for improvement.
  The agent records execution history, errors with their corrections,
  and builds a knowledge base of learned improvements over time.
  Data is persisted to {userData}/.chainlesschain/self-improving/history.json.
examples:
  - input: "record-error 'TypeError: Cannot read property' fix: 'Added null check before access'"
    action: record-error
  - input: "analyze-patterns"
    action: analyze-patterns
  - input: "suggest-improvements"
    action: suggest-improvements
  - input: "show-history"
    action: show-history
  - input: "clear-history"
    action: clear-history
input-schema:
  type: string
  description: "Action followed by error details or correction notes"
output-schema:
  type: object
  properties:
    success: { type: boolean }
    action: { type: string }
    patterns: { type: array }
    suggestions: { type: array }
    message: { type: string }
model-hints:
  context-window: small
  capability: text
cost: low
author: ChainlessChain
license: MIT
---

# Self-Improving Agent

Auto-learn from mistakes, track errors and corrections, and improve over time.

## Usage

```
/self-improving-agent record-error <error_description> fix: <correction>
/self-improving-agent analyze-patterns
/self-improving-agent suggest-improvements
/self-improving-agent show-history [--limit N]
/self-improving-agent clear-history
```

## Actions

| Action | Description |
| --- | --- |
| `record-error` | Record an error with its correction for future learning |
| `analyze-patterns` | Analyze recorded errors for recurring patterns |
| `suggest-improvements` | Generate improvement suggestions based on history |
| `show-history` | Display recorded error/correction history |
| `clear-history` | Clear all recorded history |

## Examples

- Record a bug fix: `/self-improving-agent record-error "null pointer in user service" fix: "added optional chaining"`
- View patterns: `/self-improving-agent analyze-patterns`
- Get tips: `/self-improving-agent suggest-improvements`
