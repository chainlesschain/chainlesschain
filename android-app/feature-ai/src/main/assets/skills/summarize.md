---
name: summarize
display-name: Summarize
description: Summarize text or documents concisely
version: 1.0.0
category: general
user-invocable: true
tags: [text, summarize, document]
os: [android, win32, darwin, linux]
handler: SummarizeHandler
input-schema:
  - name: text
    type: string
    description: The text to summarize
    required: true
  - name: maxLength
    type: string
    description: Summary length (short, medium, long)
    required: false
execution-mode: local
---

# Summarize Skill

Summarizes text, articles, or documents.

## Usage

```
/summarize [text to summarize]
```

## Options

- `--maxLength <length>` - Summary length: short, medium, long (default: medium)

## Examples

```
/summarize --maxLength short
The Android Jetpack Compose toolkit provides a modern declarative UI framework...
```
