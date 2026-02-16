---
name: code-review
display-name: Code Review
description: Review code for issues, style, and best practices
version: 1.0.0
category: development
user-invocable: true
tags: [code, review, quality, development]
capabilities: [code-analysis, suggestions]
supported-file-types: [js, ts, py, java, go, rs, c, cpp, vue, jsx, tsx]
os: [win32, darwin, linux]
handler: ./handler.js
---

# Code Review Skill

Performs comprehensive code review on provided code snippets or files.

## Usage

```
/code-review [file_path or code snippet]
```

## What This Skill Analyzes

1. **Code Quality**
   - Variable naming conventions
   - Function/method complexity
   - Code duplication

2. **Best Practices**
   - Error handling
   - Input validation
   - Security considerations

3. **Style**
   - Formatting consistency
   - Comment quality
   - Documentation

4. **Performance**
   - Obvious inefficiencies
   - Memory usage patterns
   - Algorithm complexity

## Output Format

The review will include:

- Summary of findings
- List of issues with severity (critical/warning/info)
- Specific recommendations with code examples
- Overall code quality score (1-10)

## Examples

Review a specific file:

```
/code-review src/main/database.js
```

Review inline code:

```
/code-review
function foo(x) {
  return x * 2;
}
```
