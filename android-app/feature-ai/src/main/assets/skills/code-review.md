---
name: code-review
display-name: Code Review
description: Review code for quality, patterns, and potential bugs
version: 1.0.0
category: code
user-invocable: true
tags: [code, review, quality]
supported-file-types: [kt, java, py, js, ts, go, rs, c, cpp]
os: [android, win32, darwin, linux]
handler: CodeReviewHandler
input-schema:
  - name: code
    type: string
    description: The code to review
    required: true
  - name: language
    type: string
    description: Programming language
    required: false
execution-mode: local
---

# Code Review Skill

Performs comprehensive code review on provided code snippets.

## Usage

```
/code-review [code snippet or description]
```

## What This Skill Analyzes

1. **Code Quality** - Naming, complexity, duplication
2. **Best Practices** - Error handling, input validation, security
3. **Style** - Formatting consistency, comments
4. **Performance** - Inefficiencies, memory, algorithm complexity

## Output Format

- Summary of findings
- Issues with severity (Critical/Warning/Info)
- Specific recommendations with code examples
- Overall quality score (1-10)

## Examples

```
/code-review
fun calculateTotal(items: List<Item>): Double {
    var total = 0.0
    for (item in items) total += item.price
    return total
}
```
