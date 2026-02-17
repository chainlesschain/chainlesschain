---
name: regex-helper
display-name: Regex Helper
description: Explain or generate regular expressions
version: 1.0.0
category: general
user-invocable: true
tags: [regex, pattern, string]
os: [android, win32, darwin, linux]
input-schema:
  - name: input
    type: string
    description: Regex pattern to explain or description to generate from
    required: true
execution-mode: local
---

# Regex Helper Skill

Explains existing regex patterns or generates new ones from descriptions.

## Usage

```
/regex-helper [regex pattern or description]
```

## Examples

```
/regex-helper ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$
```

```
/regex-helper match a valid IPv4 address
```
