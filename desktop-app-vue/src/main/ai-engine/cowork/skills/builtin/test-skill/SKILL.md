---
name: test-skill
display-name: Test Skill
description: A test skill for unit testing
version: 1.0.0
category: development
user-invocable: true
tags: [test, skill]
capabilities: [test-skill-action]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [test-skill-tool]
instructions: |
  A test skill for unit testing
examples:
  - input: "example usage of test-skill"
    action: default
author: ChainlessChain
license: MIT
---

# Test Skill

A test skill for unit testing

## Usage

```
/test-skill <action> [options]
```

## Actions

| Action    | Description               |
| --------- | ------------------------- |
| `default` | [Main action description] |

## Examples

```
/test-skill [example]
```
