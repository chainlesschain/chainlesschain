---
name: explain-code
display-name: Explain Code
description: Explain code in plain language with examples
version: 1.0.0
category: learning
user-invocable: true
tags: [code, explain, learning, documentation]
capabilities: [code-analysis, explanation]
supported-file-types: [js, ts, py, java, go, rs, c, cpp, vue, jsx, tsx, sql, sh, bash]
os: [win32, darwin, linux]
---

# Explain Code Skill

Provides clear, beginner-friendly explanations of code snippets or files.

## Usage

```
/explain-code [file_path or code snippet]
```

## Options

- `--level <level>` - Detail level: brief, normal, detailed (default: normal)
- `--focus <area>` - Focus on: logic, performance, security, all

## What Gets Explained

1. **Overall Purpose**
   - What the code does
   - Why it might be needed

2. **Key Components**
   - Functions and their roles
   - Important variables
   - Data structures used

3. **Control Flow**
   - How data moves through the code
   - Conditional branches
   - Loops and iterations

4. **External Dependencies**
   - Libraries used
   - APIs called

## Examples

Explain a file:
```
/explain-code src/utils/crypto.js
```

Explain with detailed level:
```
/explain-code --level detailed
async function fetchData(url) {
  const response = await fetch(url);
  return response.json();
}
```

## Output Format

```markdown
## Overview
This code implements a data fetching utility...

## Line-by-Line Breakdown

### Line 1: Function Declaration
`async function fetchData(url)`
- `async` allows the function to use await
- `url` parameter expects a string URL

### Line 2: Fetch Call
`const response = await fetch(url)`
- `fetch()` makes an HTTP GET request
- `await` pauses until the request completes

### Line 3: Return JSON
`return response.json()`
- Parses the response body as JSON
- Also returns a Promise

## Summary
This is an async utility for fetching JSON data from APIs.
```
