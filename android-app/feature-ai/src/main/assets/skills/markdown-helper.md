---
name: markdown-helper
display-name: Markdown Helper
description: Markdown formatting and conversion assistance
version: 1.0.0
category: documentation
user-invocable: true
tags: [markdown, format, document]
os: [android, win32, darwin, linux]
input-schema:
  - name: input
    type: string
    description: Text to convert or markdown to improve
    required: true
execution-mode: local
---

# Markdown Helper Skill

Assists with Markdown formatting, conversion, and generation.

## Usage

```
/markdown-helper [text or markdown]
```

## Capabilities

- Format text as Markdown
- Generate tables from data
- Create documentation templates
- Fix Markdown syntax

## Examples

```
/markdown-helper Create a comparison table for React vs Vue vs Angular
```
