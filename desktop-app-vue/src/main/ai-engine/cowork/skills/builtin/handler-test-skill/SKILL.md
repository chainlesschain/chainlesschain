---
name: handler-test-skill
display-name: Handler Test Skill
description: A test skill
version: 1.0.0
category: development
user-invocable: true
tags: [handler, test, skill]
capabilities: [handler-test-skill-action]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [handler-test-skill-tool]
instructions: |
  A test skill
examples:
  - input: "example usage of handler-test-skill"
    action: default
author: ChainlessChain
license: MIT
---

# Handler Test Skill

A test skill

## Usage

```
/handler-test-skill <action> [options]
```

## Actions

| Action    | Description               |
| --------- | ------------------------- |
| `default` | [Main action description] |

## Examples

```
/handler-test-skill [example]
```
