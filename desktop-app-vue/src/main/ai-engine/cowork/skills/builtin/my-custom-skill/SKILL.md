---
name: my-custom-skill
display-name: My Custom Skill
description: A skill that does something useful
version: 1.0.0
category: general
experimental: true
user-invocable: false
tags: [my, custom, skill]
capabilities: [my-custom-skill-action]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [my-custom-skill-tool]
instructions: |
  A skill that does something useful
examples:
  - input: "example usage of my-custom-skill"
    action: default
author: ChainlessChain
license: MIT
---

# My Custom Skill

A skill that does something useful

## Usage

```
/my-custom-skill <action> [options]
```

## Actions

| Action    | Description               |
| --------- | ------------------------- |
| `default` | [Main action description] |

## Examples

```
/my-custom-skill [example]
```
